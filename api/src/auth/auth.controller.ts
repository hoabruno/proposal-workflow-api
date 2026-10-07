import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength } from 'class-validator';
import type { CookieOptions, Response } from 'express';
import { Role } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Actor } from '../proposals/domain/workflow.js';
import { AuthService } from './auth.service.js';
import { CurrentActor, SESSION_COOKIE, SessionGuard } from './session.guard.js';

export const SESSION_HOURS = 8;

class LoginDto {
  @ApiProperty({ example: 'reviewer@example.com' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  // Internal accounts may live on domains without a TLD (tests, intranets).
  @IsEmail({ require_tld: false })
  email: string;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  password: string;
}

export class Me {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  displayName: string;

  @ApiProperty({ enum: Role })
  role: Role;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** HttpOnly so scripts cannot read it, SameSite=Strict so other sites cannot send it. */
  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'strict',
      secure: this.config.get('COOKIE_SECURE') !== 'false',
      path: '/api',
      maxAge: SESSION_HOURS * 3_600_000,
    };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Sign in; sets an HttpOnly session cookie' })
  @ApiOkResponse({ type: Me })
  @ApiUnauthorizedResponse({ description: 'INVALID_CREDENTIALS' })
  async login(
    @Body() body: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Me> {
    const { user, token } = await this.auth.login(body.email, body.password);
    response.cookie(SESSION_COOKIE, token, this.cookieOptions());
    return { id: user.id, displayName: user.displayName, role: user.role };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Sign out' })
  logout(@Res({ passthrough: true }) response: Response): void {
    const { maxAge: _maxAge, ...options } = this.cookieOptions();
    response.clearCookie(SESSION_COOKIE, options);
  }

  @Get('me')
  @UseGuards(SessionGuard)
  @ApiOperation({ summary: 'Signed-in user' })
  @ApiOkResponse({ type: Me })
  @ApiUnauthorizedResponse({ description: 'UNAUTHENTICATED' })
  async me(@CurrentActor() actor: Actor & { kind: 'user' }): Promise<Me> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: actor.id },
    });
    return { id: user.id, displayName: user.displayName, role: user.role };
  }
}
