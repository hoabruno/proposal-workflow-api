import {
  CanActivate,
  ExecutionContext,
  Injectable,
  createParamDecorator,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Actor } from '../proposals/domain/workflow.js';
import { AuthService } from './auth.service.js';

export const SESSION_COOKIE = 'session';

type AuthenticatedRequest = Request & { actor?: Actor & { kind: 'user' } };

/**
 * Requires a valid session cookie and exposes the signed-in user as an Actor.
 * Role checks are left to the workflow, which knows what each role may do.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = await this.auth.userFromToken(
      request.cookies?.[SESSION_COOKIE],
    );
    request.actor = { kind: 'user', id: user.id, role: user.role };
    return true;
  }
}

/** The Actor set by SessionGuard. */
export const CurrentActor = createParamDecorator(
  (_: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().actor!,
);
