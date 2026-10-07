import { ProposalStatus, Role } from '../../generated/prisma/enums.js';
import {
  ForbiddenTransitionError,
  InvalidTransitionError,
  SelfReviewError,
} from './errors.js';
import { availableActions, resolveTransition } from './workflow.js';
import type { Actor, ProposalAction } from './workflow.js';

const reviewer: Actor = { kind: 'user', id: 'reviewer-1', role: Role.REVIEWER };
const admin: Actor = { kind: 'user', id: 'admin-1', role: Role.ADMIN };
const system: Actor = { kind: 'system' };

const proposal = (
  status: ProposalStatus,
  proposerId: string | null = null,
) => ({ status, proposerId });

describe('resolveTransition', () => {
  it.each<[ProposalStatus, ProposalAction, Actor, ProposalStatus]>([
    [ProposalStatus.SUBMITTED, 'approve', reviewer, ProposalStatus.APPROVED],
    [ProposalStatus.SUBMITTED, 'reject', reviewer, ProposalStatus.REJECTED],
    [ProposalStatus.SUBMITTED, 'approve', admin, ProposalStatus.APPROVED],
    [ProposalStatus.APPROVED, 'schedule', admin, ProposalStatus.SCHEDULED],
    [ProposalStatus.SCHEDULED, 'unschedule', admin, ProposalStatus.APPROVED],
    [ProposalStatus.SCHEDULED, 'publish', system, ProposalStatus.PUBLISHED],
    [ProposalStatus.PUBLISHED, 'archive', system, ProposalStatus.ARCHIVED],
  ])('%s --%s--> %s', (from, action, actor, to) => {
    expect(resolveTransition(proposal(from), action, actor)).toBe(to);
  });

  it.each<[ProposalStatus, ProposalAction]>([
    [ProposalStatus.REJECTED, 'approve'],
    [ProposalStatus.APPROVED, 'approve'],
    [ProposalStatus.SUBMITTED, 'schedule'],
    [ProposalStatus.ARCHIVED, 'publish'],
    [ProposalStatus.PUBLISHED, 'reject'],
  ])('refuses %s --%s', (from, action) => {
    expect(() => resolveTransition(proposal(from), action, admin)).toThrow(
      InvalidTransitionError,
    );
  });

  it('keeps scheduling to admins', () => {
    expect(() =>
      resolveTransition(
        proposal(ProposalStatus.APPROVED),
        'schedule',
        reviewer,
      ),
    ).toThrow(ForbiddenTransitionError);
  });

  it('keeps publication to the daily job', () => {
    expect(() =>
      resolveTransition(proposal(ProposalStatus.SCHEDULED), 'publish', admin),
    ).toThrow(ForbiddenTransitionError);
  });

  it('enforces the four-eyes rule on review decisions', () => {
    const own = proposal(
      ProposalStatus.SUBMITTED,
      reviewer.kind === 'user' ? reviewer.id : null,
    );
    expect(() => resolveTransition(own, 'approve', reviewer)).toThrow(
      SelfReviewError,
    );
    expect(() => resolveTransition(own, 'reject', reviewer)).toThrow(
      SelfReviewError,
    );
    expect(resolveTransition(own, 'approve', admin)).toBe(
      ProposalStatus.APPROVED,
    );
  });

  it('checks the state before the role', () => {
    expect(() =>
      resolveTransition(
        proposal(ProposalStatus.ARCHIVED),
        'schedule',
        reviewer,
      ),
    ).toThrow(InvalidTransitionError);
  });
});

describe('availableActions', () => {
  it('lists what each actor can do next', () => {
    expect(
      availableActions(proposal(ProposalStatus.SUBMITTED), reviewer),
    ).toEqual(['approve', 'reject']);
    expect(
      availableActions(proposal(ProposalStatus.APPROVED), reviewer),
    ).toEqual([]);
    expect(availableActions(proposal(ProposalStatus.APPROVED), admin)).toEqual([
      'schedule',
    ]);
    expect(
      availableActions(proposal(ProposalStatus.SCHEDULED), system),
    ).toEqual(['publish']);
  });
});
