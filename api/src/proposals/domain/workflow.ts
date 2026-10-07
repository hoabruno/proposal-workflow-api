import { ProposalStatus, Role } from '../../generated/prisma/enums.js';
import {
  ForbiddenTransitionError,
  InvalidTransitionError,
  SelfReviewError,
} from './errors.js';

export type ProposalAction =
  | 'approve'
  | 'reject'
  | 'schedule'
  | 'unschedule'
  | 'publish'
  | 'publishNow'
  | 'archive';

/** Who performs an action: a signed-in user, or the daily publication job. */
export type Actor =
  { kind: 'user'; id: string; role: Role } | { kind: 'system' };

type Transition = {
  from: ProposalStatus;
  to: ProposalStatus;
  /** Roles allowed to trigger it; 'system' means only the scheduler may. */
  allowed: readonly (Role | 'system')[];
};

/** Single source of truth for the proposal lifecycle. */
export const TRANSITIONS: Readonly<Record<ProposalAction, Transition>> = {
  approve: {
    from: ProposalStatus.SUBMITTED,
    to: ProposalStatus.APPROVED,
    allowed: [Role.REVIEWER, Role.ADMIN],
  },
  reject: {
    from: ProposalStatus.SUBMITTED,
    to: ProposalStatus.REJECTED,
    allowed: [Role.REVIEWER, Role.ADMIN],
  },
  schedule: {
    from: ProposalStatus.APPROVED,
    to: ProposalStatus.SCHEDULED,
    allowed: [Role.ADMIN],
  },
  unschedule: {
    from: ProposalStatus.SCHEDULED,
    to: ProposalStatus.APPROVED,
    allowed: [Role.ADMIN],
  },
  publish: {
    from: ProposalStatus.SCHEDULED,
    to: ProposalStatus.PUBLISHED,
    allowed: ['system'],
  },
  /** Skips the calendar: lets an admin show the workflow live during a demo. */
  publishNow: {
    from: ProposalStatus.APPROVED,
    to: ProposalStatus.PUBLISHED,
    allowed: [Role.ADMIN],
  },
  archive: {
    from: ProposalStatus.PUBLISHED,
    to: ProposalStatus.ARCHIVED,
    allowed: ['system'],
  },
};

/** Review decisions are subject to the four-eyes rule. */
const REVIEW_ACTIONS: ReadonlySet<ProposalAction> = new Set([
  'approve',
  'reject',
]);

export type ProposalSnapshot = {
  status: ProposalStatus;
  proposerId: string | null;
};

/**
 * Checks that `actor` may apply `action` to a proposal in its current state
 * and returns the target status. Throws a domain error otherwise.
 */
export function resolveTransition(
  proposal: ProposalSnapshot,
  action: ProposalAction,
  actor: Actor,
): ProposalStatus {
  const transition = TRANSITIONS[action];
  if (proposal.status !== transition.from) {
    throw new InvalidTransitionError(action, proposal.status);
  }
  const actorKey = actor.kind === 'system' ? 'system' : actor.role;
  if (!transition.allowed.includes(actorKey)) {
    throw new ForbiddenTransitionError(action, actorKey);
  }
  if (
    actor.kind === 'user' &&
    REVIEW_ACTIONS.has(action) &&
    proposal.proposerId !== null &&
    proposal.proposerId === actor.id
  ) {
    throw new SelfReviewError();
  }
  return transition.to;
}

/** Actions currently available to `actor`, used by the back-office to show buttons. */
export function availableActions(
  proposal: ProposalSnapshot,
  actor: Actor,
): ProposalAction[] {
  return (Object.keys(TRANSITIONS) as ProposalAction[]).filter((action) => {
    try {
      resolveTransition(proposal, action, actor);
      return true;
    } catch {
      return false;
    }
  });
}
