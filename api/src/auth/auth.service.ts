import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  InvalidCredentialsError,
  UnauthenticatedError,
} from './auth.errors.js';
import { hashPassword, verifyPassword } from './password.js';

type SessionClaims = { sub: string };

@Injectable()
export class AuthService {
  /** Compared against when the email is unknown, so both cases take the same time. */
  private readonly decoy = hashPassword('decoy-password');

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(
    email: string,
    password: string,
  ): Promise<{ user: User; token: string }> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    const valid = await verifyPassword(
      password,
      user?.passwordHash ?? (await this.decoy),
    );
    if (!user || !valid) throw new InvalidCredentialsError();
    const token = await this.jwt.signAsync({
      sub: user.id,
    } satisfies SessionClaims);
    return { user, token };
  }

  /**
   * Resolves a session token to its user. The user is reloaded on every
   * request, so a deleted account or a role change takes effect immediately.
   */
  async userFromToken(token: string | undefined): Promise<User> {
    if (!token) throw new UnauthenticatedError();
    let claims: SessionClaims;
    try {
      claims = await this.jwt.verifyAsync<SessionClaims>(token);
    } catch {
      throw new UnauthenticatedError();
    }
    const user = await this.prisma.user.findUnique({
      where: { id: claims.sub },
    });
    if (!user) throw new UnauthenticatedError();
    return user;
  }
}
