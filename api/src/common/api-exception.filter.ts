import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
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
 * clients switch on a stable code rather than parsing messages. Unexpected
 * errors are logged and answered with a generic body that leaks nothing.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ApiError');

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const [status, body] = this.describe(exception);
    // A stream (SSE) may already have sent its headers: just close it.
    if (response.headersSent) {
      response.end();
      return;
    }
    response.status(status).json(body);
  }

  private describe(exception: unknown): [HttpStatus, ApiErrorBody] {
    if (exception instanceof DomainError) {
      const body: ApiErrorBody = {
        code: exception.code,
        message: exception.message,
      };
      if ('reason' in exception && typeof exception.reason === 'string') {
        body.reason = exception.reason;
      }
      return [STATUS_BY_CODE[exception.code] ?? HttpStatus.BAD_REQUEST, body];
    }

    if (exception instanceof ThrottlerException) {
      return [
        HttpStatus.TOO_MANY_REQUESTS,
        {
          code: 'TOO_MANY_REQUESTS',
          message: 'Too many requests, try again later',
        },
      ];
    }

    // Framework errors (invalid UUID, unknown route, malformed JSON...), and
    // errors raised with an explicit { code, message } such as VALIDATION_FAILED.
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      if (
        typeof payload === 'object' &&
        payload !== null &&
        'code' in payload
      ) {
        const { code, message } = payload as {
          code: unknown;
          message: unknown;
        };
        return [status, { code: String(code), message: String(message) }];
      }
      const message =
        typeof payload === 'object' && payload !== null && 'message' in payload
          ? [(payload as { message: unknown }).message].flat().join('; ')
          : exception.message;
      return [status, { code: HttpStatus[status] ?? 'HTTP_ERROR', message }];
    }

    this.logger.error(
      'Unexpected error',
      exception instanceof Error ? exception.stack : String(exception),
    );
    return [
      HttpStatus.INTERNAL_SERVER_ERROR,
      { code: 'INTERNAL_ERROR', message: 'Something went wrong' },
    ];
  }
}
