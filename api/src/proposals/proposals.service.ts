import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type { Proposal, ProposalEvent } from '../generated/prisma/client.js';
import { ProposalStatus, Role } from '../generated/prisma/enums.js';
import { Clock } from '../common/clock.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { dayInGeneva, formatDay, parseDay } from './domain/calendar.js';
import {
  ConcurrentUpdateError,
  DateAlreadyTakenError,
  DuplicateWordError,
  ForbiddenActionError,
  InvalidScheduleDateError,
  ProposalNotFoundError,
  RejectionReasonRequiredError,
} from './domain/errors.js';
import { validateWord } from './domain/word-policy.js';
import { resolveTransition } from './domain/workflow.js';
import type { Actor, ProposalAction } from './domain/workflow.js';

/** Arbitrary key for the Postgres advisory lock that serializes the daily job. */
const PUBLICATION_LOCK_KEY = 4_242_001;
const REJECTION_REASON_MAX = 280;

/**
 * Most recent publication first; words published by the same catch-up run
 * share a timestamp, so the later calendar day wins.
 */
const LIVE_ORDER: Prisma.ProposalOrderByWithRelationInput[] = [
  { publishedAt: { sort: 'desc', nulls: 'last' } },
  { scheduledFor: { sort: 'desc', nulls: 'last' } },
];

export type SubmitInput = {
  word: string;
  proposerName?: string | null;
  proposerId?: string | null;
};

type Tx = Prisma.TransactionClient;

type TransitionOptions = {
  /** Version the caller last saw; omitted for system actions. */
  expectedVersion?: number;
  comment?: string | null;
  data?: Prisma.ProposalUncheckedUpdateManyInput;
};

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002';

@Injectable()
export class ProposalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async submit(input: SubmitInput): Promise<Proposal> {
    const normalizedWord = validateWord(input.word);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const proposal = await tx.proposal.create({
          data: {
            word: input.word.trim(),
            normalizedWord,
            activeWord: normalizedWord,
            proposerName: input.proposerName?.trim() || null,
            proposerId: input.proposerId ?? null,
          },
        });
        await this.recordEvent(
          tx,
          proposal.id,
          input.proposerId ?? null,
          null,
          ProposalStatus.SUBMITTED,
        );
        return proposal;
      });
    } catch (error) {
      // The unique index on active_word settles races between two identical
      // submissions; archived words no longer hold it, so they may come back.
      if (isUniqueViolation(error)) throw new DuplicateWordError();
      throw error;
    }
  }

  approve(
    id: string,
    actor: Actor,
    expectedVersion: number,
    comment?: string,
  ): Promise<Proposal> {
    return this.transition(id, 'approve', actor, { expectedVersion, comment });
  }

  async reject(
    id: string,
    actor: Actor,
    expectedVersion: number,
    reason: string,
  ): Promise<Proposal> {
    const trimmed = reason?.trim() ?? '';
    if (!trimmed) throw new RejectionReasonRequiredError();
    const rejectionReason = trimmed.slice(0, REJECTION_REASON_MAX);
    return this.transition(id, 'reject', actor, {
      expectedVersion,
      comment: rejectionReason,
      data: { rejectionReason },
    });
  }

  async schedule(
    id: string,
    actor: Actor,
    expectedVersion: number,
    day: string,
  ): Promise<Proposal> {
    const date = parseDay(day);
    // Today is already live (or about to be), so planning starts tomorrow.
    if (!date || day <= dayInGeneva(this.clock.now()))
      throw new InvalidScheduleDateError();
    try {
      return await this.transition(id, 'schedule', actor, {
        expectedVersion,
        comment: day,
        data: { scheduledFor: date },
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new DateAlreadyTakenError(day);
      throw error;
    }
  }

  unschedule(
    id: string,
    actor: Actor,
    expectedVersion: number,
  ): Promise<Proposal> {
    return this.transition(id, 'unschedule', actor, {
      expectedVersion,
      data: { scheduledFor: null },
    });
  }

  /**
   * Daily job: publishes every scheduled word whose day has come, keeps the
   * most recent one live and archives the others. Idempotent, and safe to run
   * from several instances thanks to a transaction-scoped advisory lock.
   */
  async publishDueWords(): Promise<Proposal | null> {
    const system: Actor = { kind: 'system' };
    const now = this.clock.now();
    const today = parseDay(dayInGeneva(now))!;

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PUBLICATION_LOCK_KEY})`;

      const due = await tx.proposal.findMany({
        where: {
          status: ProposalStatus.SCHEDULED,
          scheduledFor: { lte: today },
        },
        orderBy: { scheduledFor: 'asc' },
      });
      for (const proposal of due) {
        await this.applyTransition(tx, proposal, 'publish', system, {
          data: { publishedAt: now },
        });
      }
      return this.keepLatestLive(tx, now);
    });
  }

  /**
   * Admin shortcut for live demos: publishes an approved word right away,
   * bypassing the calendar, and archives the word it replaces.
   */
  async publishNow(
    id: string,
    actor: Actor,
    expectedVersion: number,
  ): Promise<Proposal> {
    const now = this.clock.now();
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PUBLICATION_LOCK_KEY})`;
      const proposal = await this.findOrThrow(tx, id);
      const published = await this.applyTransition(
        tx,
        proposal,
        'publishNow',
        actor,
        { expectedVersion, data: { publishedAt: now } },
      );
      // Explicit, so two publications within the same millisecond stay unambiguous.
      await this.keepLatestLive(tx, now, published.id);
      return published;
    });
  }

  /**
   * Admin-only clean slate before a demo: deletes every proposal and its
   * audit trail (accounts are kept). Takes the publication lock so it never
   * interleaves with the daily job. Returns how many proposals were deleted.
   */
  async resetAll(actor: Actor): Promise<number> {
    if (actor.kind !== 'user' || actor.role !== Role.ADMIN) {
      throw new ForbiddenActionError('reset all words');
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PUBLICATION_LOCK_KEY})`;
      // Events go with their proposal (ON DELETE CASCADE).
      const { count } = await tx.proposal.deleteMany();
      return count;
    });
  }

  /** The word on screen today, or null when nothing is published (the front then shows "atipik"). */
  current(): Promise<Proposal | null> {
    return this.prisma.proposal.findFirst({
      where: { status: ProposalStatus.PUBLISHED },
      orderBy: LIVE_ORDER,
    });
  }

  /**
   * Archives every published word but one, which it returns: `keepId` when
   * given (a word just published by hand), otherwise the most recent one.
   */
  private async keepLatestLive(
    tx: Tx,
    now: Date,
    keepId?: string,
  ): Promise<Proposal | null> {
    const live = await tx.proposal.findMany({
      where: { status: ProposalStatus.PUBLISHED },
      orderBy: LIVE_ORDER,
    });
    const current = keepId ? live.find((p) => p.id === keepId) : live[0];
    for (const proposal of live) {
      if (proposal === current) continue;
      await this.applyTransition(
        tx,
        proposal,
        'archive',
        { kind: 'system' },
        // Freeing active_word lets the word be proposed again later.
        { data: { archivedAt: now, activeWord: null } },
      );
    }
    return current ?? null;
  }

  list(status?: ProposalStatus): Promise<Proposal[]> {
    return this.prisma.proposal.findMany({
      where: status ? { status } : undefined,
      orderBy: [{ scheduledFor: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /** Audit trail of a proposal, with the name of whoever acted (null for the system or a visitor). */
  async history(
    id: string,
  ): Promise<(ProposalEvent & { actor: { displayName: string } | null })[]> {
    await this.findOrThrow(this.prisma, id);
    return this.prisma.proposalEvent.findMany({
      where: { proposalId: id },
      include: { actor: { select: { displayName: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Scheduled days from `from` onwards, for the back-office calendar. */
  async takenDays(from: Date): Promise<string[]> {
    const rows = await this.prisma.proposal.findMany({
      where: { scheduledFor: { gte: from } },
      select: { scheduledFor: true },
      orderBy: { scheduledFor: 'asc' },
    });
    return rows.map((row) => formatDay(row.scheduledFor!));
  }

  private transition(
    id: string,
    action: ProposalAction,
    actor: Actor,
    options: TransitionOptions,
  ): Promise<Proposal> {
    return this.prisma.$transaction(async (tx) => {
      const proposal = await this.findOrThrow(tx, id);
      return this.applyTransition(tx, proposal, action, actor, options);
    });
  }

  /**
   * Validates the transition against the workflow, then updates the row only
   * if its version is still the expected one (optimistic locking) and appends
   * the audit event in the same transaction.
   */
  private async applyTransition(
    tx: Tx,
    proposal: Proposal,
    action: ProposalAction,
    actor: Actor,
    {
      expectedVersion = proposal.version,
      comment = null,
      data = {},
    }: TransitionOptions,
  ): Promise<Proposal> {
    const to = resolveTransition(proposal, action, actor);
    const actorId = actor.kind === 'user' ? actor.id : null;
    const reviewer =
      action === 'approve' || action === 'reject'
        ? { reviewerId: actorId }
        : {};

    const { count } = await tx.proposal.updateMany({
      where: { id: proposal.id, version: expectedVersion },
      data: { ...data, ...reviewer, status: to, version: { increment: 1 } },
    });
    if (count === 0) throw new ConcurrentUpdateError();

    await this.recordEvent(
      tx,
      proposal.id,
      actorId,
      proposal.status,
      to,
      comment,
    );
    return tx.proposal.findUniqueOrThrow({ where: { id: proposal.id } });
  }

  private recordEvent(
    tx: Tx,
    proposalId: string,
    actorId: string | null,
    fromStatus: ProposalStatus | null,
    toStatus: ProposalStatus,
    comment: string | null = null,
  ) {
    return tx.proposalEvent.create({
      data: { proposalId, actorId, fromStatus, toStatus, comment },
    });
  }

  private async findOrThrow(db: Tx, id: string): Promise<Proposal> {
    const proposal = await db.proposal.findUnique({ where: { id } });
    if (!proposal) throw new ProposalNotFoundError(id);
    return proposal;
  }
}
