/**
 * Domain errors carry a stable machine-readable code; the HTTP layer maps
 * them to status codes and the back-office maps codes to French messages.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidTransitionError extends DomainError {
  readonly code = 'INVALID_TRANSITION';

  constructor(action: string, status: string) {
    super(`Cannot ${action} a proposal in status ${status}`);
  }
}

export class ForbiddenTransitionError extends DomainError {
  readonly code = 'FORBIDDEN_TRANSITION';

  constructor(action: string, actor: string) {
    super(`${actor} is not allowed to ${action} a proposal`);
  }
}

export class SelfReviewError extends DomainError {
  readonly code = 'SELF_REVIEW';

  constructor() {
    super('A proposal cannot be reviewed by the person who submitted it');
  }
}

export class InvalidWordError extends DomainError {
  readonly code = 'INVALID_WORD';

  constructor(readonly reason: 'length' | 'characters' | 'blocked') {
    super(`Word rejected: ${reason}`);
  }
}

export class DuplicateWordError extends DomainError {
  readonly code = 'DUPLICATE_WORD';

  constructor() {
    super('This word is already pending, upcoming, live or rejected');
  }
}

export class RejectionReasonRequiredError extends DomainError {
  readonly code = 'REJECTION_REASON_REQUIRED';

  constructor() {
    super('A rejection needs a reason');
  }
}

export class InvalidScheduleDateError extends DomainError {
  readonly code = 'INVALID_SCHEDULE_DATE';

  constructor() {
    super('A word can only be scheduled from tomorrow onwards');
  }
}

export class DateAlreadyTakenError extends DomainError {
  readonly code = 'DATE_ALREADY_TAKEN';

  constructor(readonly date: string) {
    super(`Another word is already scheduled on ${date}`);
  }
}

export class ConcurrentUpdateError extends DomainError {
  readonly code = 'CONCURRENT_UPDATE';

  constructor() {
    super('The proposal was changed by someone else; reload and try again');
  }
}

export class ProposalNotFoundError extends DomainError {
  readonly code = 'PROPOSAL_NOT_FOUND';

  constructor(id: string) {
    super(`Proposal ${id} not found`);
  }
}
