import { ConfigService } from '@nestjs/config';
import { Role, ProposalStatus } from '../src/generated/prisma/enums.js';
import { Clock } from '../src/common/clock.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  ConcurrentUpdateError,
  DateAlreadyTakenError,
  DuplicateWordError,
  ForbiddenTransitionError,
  InvalidScheduleDateError,
  InvalidTransitionError,
  RejectionReasonRequiredError,
  SelfReviewError,
} from '../src/proposals/domain/errors.js';
import type { Actor } from '../src/proposals/domain/workflow.js';
import { ProposalsService } from '../src/proposals/proposals.service.js';

class FixedClock extends Clock {
  constructor(public current: Date) {
    super();
  }
  now(): Date {
    return this.current;
  }
}

describe('ProposalsService (real Postgres)', () => {
  let prisma: PrismaService;
  let clock: FixedClock;
  let service: ProposalsService;
  let reviewer: Actor;
  let otherReviewer: Actor;
  let admin: Actor;

  const user = async (email: string, role: Role): Promise<Actor> => {
    const row = await prisma.user.create({
      data: { email, displayName: email, role, passwordHash: 'unused' },
    });
    return { kind: 'user', id: row.id, role };
  };
  const idOf = (actor: Actor) => (actor.kind === 'user' ? actor.id : null);

  /** Moves the clock to 10:00 in Geneva on the given day (UTC+2 in October). */
  const setDay = (day: string) => {
    clock.current = new Date(`${day}T08:00:00Z`);
  };

  beforeAll(() => {
    prisma = new PrismaService(
      new ConfigService({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    clock = new FixedClock(new Date());
    service = new ProposalsService(prisma, clock);
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE proposal_events, proposals, users CASCADE',
    );
    setDay('2026-10-06');
    reviewer = await user('reviewer@atipik.test', Role.REVIEWER);
    otherReviewer = await user('reviewer2@atipik.test', Role.REVIEWER);
    admin = await user('admin@atipik.test', Role.ADMIN);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('submission', () => {
    it('stores the proposal and opens its audit trail', async () => {
      const proposal = await service.submit({
        word: ' Carouge ',
        proposerName: 'Léa',
      });

      expect(proposal).toMatchObject({
        word: 'Carouge',
        normalizedWord: 'carouge',
        status: ProposalStatus.SUBMITTED,
        version: 0,
      });
      const history = await service.history(proposal.id);
      expect(history.map((e) => [e.fromStatus, e.toStatus])).toEqual([
        [null, ProposalStatus.SUBMITTED],
      ]);
    });

    it('refuses a word proposed before, whatever its spelling', async () => {
      await service.submit({ word: 'vue.js' });
      await expect(service.submit({ word: '  VUE.js' })).rejects.toThrow(
        DuplicateWordError,
      );
    });

    it('lets the database settle two identical submissions sent at once', async () => {
      const results = await Promise.allSettled([
        service.submit({ word: 'nestjs' }),
        service.submit({ word: 'NestJS' }),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const failure = results.find(
        (r) => r.status === 'rejected',
      ) as PromiseRejectedResult;
      expect(failure.reason).toBeInstanceOf(DuplicateWordError);
      expect(await prisma.proposal.count()).toBe(1);
    });
  });

  describe('review', () => {
    it('approves, records the reviewer and bumps the version', async () => {
      const { id } = await service.submit({ word: 'genève' });
      const approved = await service.approve(id, reviewer, 0, 'Joli');

      expect(approved).toMatchObject({
        status: ProposalStatus.APPROVED,
        reviewerId: idOf(reviewer),
        version: 1,
      });
      const [, event] = await service.history(id);
      expect(event).toMatchObject({
        actorId: idOf(reviewer),
        toStatus: ProposalStatus.APPROVED,
        comment: 'Joli',
      });
    });

    it('requires a reason to reject and keeps it', async () => {
      const { id } = await service.submit({ word: 'bof' });
      await expect(service.reject(id, reviewer, 0, '   ')).rejects.toThrow(
        RejectionReasonRequiredError,
      );

      const rejected = await service.reject(id, reviewer, 0, 'Hors sujet');
      expect(rejected).toMatchObject({
        status: ProposalStatus.REJECTED,
        rejectionReason: 'Hors sujet',
      });
      await expect(service.approve(id, otherReviewer, 1)).rejects.toThrow(
        InvalidTransitionError,
      );
    });

    it('forbids reviewing your own proposal', async () => {
      const { id } = await service.submit({
        word: 'swiss',
        proposerId: idOf(reviewer),
      });

      await expect(service.approve(id, reviewer, 0)).rejects.toThrow(
        SelfReviewError,
      );
      await expect(
        service.approve(id, otherReviewer, 0),
      ).resolves.toMatchObject({ status: ProposalStatus.APPROVED });
    });

    it('rejects a decision taken on a stale version', async () => {
      const { id } = await service.submit({ word: 'lac' });
      await expect(service.approve(id, reviewer, 3)).rejects.toThrow(
        ConcurrentUpdateError,
      );
    });

    it('lets only one of two simultaneous reviewers win', async () => {
      const { id } = await service.submit({ word: 'salève' });
      const results = await Promise.allSettled([
        service.approve(id, reviewer, 0),
        service.reject(id, otherReviewer, 0, 'Trop local'),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const failure = results.find(
        (r) => r.status === 'rejected',
      ) as PromiseRejectedResult;
      // Depending on timing the loser sees either the bumped version or the new status.
      expect([ConcurrentUpdateError, InvalidTransitionError]).toContainEqual(
        failure.reason.constructor,
      );
      expect(await service.history(id)).toHaveLength(2);
    });
  });

  describe('scheduling', () => {
    const approvedWord = async (word: string) => {
      const { id } = await service.submit({ word });
      return service.approve(id, reviewer, 0);
    };

    it('is reserved to admins and starts tomorrow', async () => {
      const { id, version } = await approvedWord('jet-deau');

      await expect(
        service.schedule(id, reviewer, version, '2026-10-07'),
      ).rejects.toThrow(ForbiddenTransitionError);
      await expect(
        service.schedule(id, admin, version, '2026-10-06'),
      ).rejects.toThrow(InvalidScheduleDateError);
      await expect(
        service.schedule(id, admin, version, '2026-02-30'),
      ).rejects.toThrow(InvalidScheduleDateError);

      const scheduled = await service.schedule(
        id,
        admin,
        version,
        '2026-10-07',
      );
      expect(scheduled.status).toBe(ProposalStatus.SCHEDULED);
      expect(scheduled.scheduledFor?.toISOString()).toBe(
        '2026-10-07T00:00:00.000Z',
      );
    });

    it('allows one word per day', async () => {
      const first = await approvedWord('fondue');
      const second = await approvedWord('raclette');
      await service.schedule(first.id, admin, first.version, '2026-10-08');

      await expect(
        service.schedule(second.id, admin, second.version, '2026-10-08'),
      ).rejects.toThrow(DateAlreadyTakenError);
      // The failed attempt left the proposal untouched.
      expect(
        await prisma.proposal.findUniqueOrThrow({ where: { id: second.id } }),
      ).toMatchObject({
        status: ProposalStatus.APPROVED,
        version: second.version,
      });
      expect(await service.takenDays(new Date('2026-10-01'))).toEqual([
        '2026-10-08',
      ]);
    });

    it('can free a day again', async () => {
      const { id, version } = await approvedWord('bise');
      const scheduled = await service.schedule(
        id,
        admin,
        version,
        '2026-10-09',
      );
      const back = await service.unschedule(id, admin, scheduled.version);

      expect(back).toMatchObject({
        status: ProposalStatus.APPROVED,
        scheduledFor: null,
      });
      expect(await service.takenDays(new Date('2026-10-01'))).toEqual([]);
    });
  });

  describe('daily publication', () => {
    const scheduledWord = async (word: string, day: string) => {
      const { id } = await service.submit({ word });
      const approved = await service.approve(id, reviewer, 0);
      return service.schedule(id, admin, approved.version, day);
    };

    it('shows nothing until the first scheduled day', async () => {
      await scheduledWord('demain', '2026-10-07');

      expect(await service.publishDueWords()).toBeNull();
      expect(await service.current()).toBeNull();
    });

    it('publishes the word of the day and archives the previous one', async () => {
      const monday = await scheduledWord('lundi', '2026-10-07');
      const tuesday = await scheduledWord('mardi', '2026-10-08');

      setDay('2026-10-07');
      expect((await service.publishDueWords())?.id).toBe(monday.id);

      setDay('2026-10-08');
      expect((await service.publishDueWords())?.id).toBe(tuesday.id);
      expect((await service.current())?.word).toBe('mardi');

      const archived = await prisma.proposal.findUniqueOrThrow({
        where: { id: monday.id },
      });
      expect(archived).toMatchObject({ status: ProposalStatus.ARCHIVED });
      expect(archived.archivedAt).not.toBeNull();

      const trail = (await service.history(monday.id)).map((e) => e.toStatus);
      expect(trail).toEqual([
        ProposalStatus.SUBMITTED,
        ProposalStatus.APPROVED,
        ProposalStatus.SCHEDULED,
        ProposalStatus.PUBLISHED,
        ProposalStatus.ARCHIVED,
      ]);
    });

    it('lets an archived word be proposed again, but not a rejected one', async () => {
      const first = await scheduledWord('fondue', '2026-10-07');
      await scheduledWord('raclette', '2026-10-08');
      setDay('2026-10-07');
      await service.publishDueWords();
      // Still live today: proposing it again is a duplicate.
      await expect(service.submit({ word: 'Fondue' })).rejects.toThrow(
        DuplicateWordError,
      );

      setDay('2026-10-08');
      await service.publishDueWords();
      expect(
        await prisma.proposal.findUniqueOrThrow({ where: { id: first.id } }),
      ).toMatchObject({ status: ProposalStatus.ARCHIVED, activeWord: null });
      const again = await service.submit({ word: 'Fondue' });
      expect(again).toMatchObject({
        status: ProposalStatus.SUBMITTED,
        activeWord: 'fondue',
      });

      const { id } = await service.submit({ word: 'bof' });
      await service.reject(id, reviewer, 0, 'Hors sujet');
      await expect(service.submit({ word: 'bof' })).rejects.toThrow(
        DuplicateWordError,
      );
    });

    it('catches up after missed runs and keeps only the latest word live', async () => {
      await scheduledWord('un', '2026-10-07');
      await scheduledWord('deux', '2026-10-08');
      const third = await scheduledWord('trois', '2026-10-09');

      setDay('2026-10-10');
      expect((await service.publishDueWords())?.id).toBe(third.id);
      expect(
        await prisma.proposal.count({
          where: { status: ProposalStatus.PUBLISHED },
        }),
      ).toBe(1);
      expect(
        await prisma.proposal.count({
          where: { status: ProposalStatus.ARCHIVED },
        }),
      ).toBe(2);
    });

    it('is idempotent, even when two instances run it at the same time', async () => {
      const today = await scheduledWord('aujourdhui', '2026-10-07');
      setDay('2026-10-07');

      const [a, b] = await Promise.all([
        service.publishDueWords(),
        service.publishDueWords(),
      ]);
      expect(a?.id).toBe(today.id);
      expect(b?.id).toBe(today.id);
      // The advisory lock prevents a second PUBLISHED event.
      const published = (await service.history(today.id)).filter(
        (e) => e.toStatus === ProposalStatus.PUBLISHED,
      );
      expect(published).toHaveLength(1);
    });
  });
});
