import { DomainError } from '../proposals/domain/errors.js';

export class InvalidCredentialsError extends DomainError {
  readonly code = 'INVALID_CREDENTIALS';

  constructor() {
    super('Invalid email or password');
  }
}

export class UnauthenticatedError extends DomainError {
  readonly code = 'UNAUTHENTICATED';

  constructor() {
    super('Sign in required');
  }
}
