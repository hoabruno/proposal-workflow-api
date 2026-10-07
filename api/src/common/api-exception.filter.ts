import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Response } from 'express';
import { DomainError } from '../proposals/domain/errors.js';

/** HTTP status for each domain error code; anything unlisted is a 400. */
const STATUS_BY_CODE: Record<string, HttpStatus> = {
  INVALID_WORD: HttpStatus.UNPROCESSABLE_ENTITY,
  REJECTION_REASON_REQUIRED: HttpStatus.UNPROCESSABLE_ENTITY,
  INVALID_SCHEDULE_DATE: HttpStatus.UNPROCESSABLE_ENTITY,
  DUPLICATE_WORD: HttpStatus.CONFLICT,
  DATE_ALREADY_TAKEN: HttpStatus.CONFLICT,
  INVALID_TRANSITION: HttpStatus.CONFLICT,
  CONCURRENT_UPDATE: HttpStatus.CONFLICT,
  FORBIDDEN_TRANSITION: HttpStatus.FORBIDDEN,
  SELF_REVIEW: HttpStatus.FORBIDDEN,
  FORBIDDEN_ACTION: HttpStatus.FORBIDDEN,
  PROPOSAL_NOT_FOUND: HttpStatus.NOT_FOUND,
  INVALID_CREDENTIALS: HttpStatus.UNAUTHORIZED,
  UNAUTHENTICATED: HttpStatus.UNAUTHORIZED,
};

export type ApiErrorBody = { code: string; message: string; reason?: string };

/**
 * Every error the API returns has the same shape, `{ code, message }`, so
 * clients switch on a stable code rather than parsing messages.
 */
@Catch(DomainError, ThrottlerException)
export class ApiExceptionFilter implements ExceptionFilter {
  catch(
    exception: DomainError | ThrottlerException,
    host: ArgumentsHost,
  ): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof ThrottlerException) {
      response.status(HttpStatus.TOO_MANY_REQUESTS).json({
        code: 'TOO_MANY_REQUESTS',
        message: 'Too many requests, try again later',
      } satisfies ApiErrorBody);
      return;
    }

    const body: ApiErrorBody = {
      code: exception.code,
      message: exception.message,
    };
    if ('reason' in exception && typeof exception.reason === 'string') {
      body.reason = exception.reason;
    }
    response
      .status(STATUS_BY_CODE[exception.code] ?? HttpStatus.BAD_REQUEST)
      .json(body);
  }
}
