import { BadRequestException, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { ApiExceptionFilter } from './common/api-exception.filter.js';

/** Shared by main.ts and the e2e tests so both run the exact same pipeline. */
export function configureApp(app: NestExpressApplication): void {
  // Traefik routes atipik.middlewa.re/api/* to this service.
  app.setGlobalPrefix('api');
  // One proxy hop (Traefik): req.ip is the visitor, used for rate limiting.
  app.set('trust proxy', 1);
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) =>
        new BadRequestException({
          code: 'VALIDATION_FAILED',
          message: errors
            .flatMap((e) => Object.values(e.constraints ?? {}))
            .join('; '),
        }),
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('proposal-workflow-api')
      .setDescription(
        'Word of the day: proposals, review workflow and live feed.',
      )
      .setVersion('1.0')
      .addCookieAuth('session')
      .build(),
  );
  SwaggerModule.setup('api/docs', app, document);
}
