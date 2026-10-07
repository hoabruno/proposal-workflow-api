import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { Clock } from '../src/common/clock.js';
import { Role } from '../src/generated/prisma/enums.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import type { Actor } from '../src/proposals/domain/workflow.js';
import { ProposalsService } from '../src/proposals/proposals.service.js';
import { PublicationJob } from '../src/words/publication.job.js';

class FixedClock extends Clock {
  current = new Date('2026-10-06T08:00:00Z');
  now(): Date {
    return this.current;
  }
}

/** Every test gets its own visitor address so rate limits do not leak between tests. */
let visitor = 0;
const nextIp = () => `203.0.113.${++visitor}`;

describe('HTTP API', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let prisma: PrismaService;
  let proposals: ProposalsService;
  let job: PublicationJob;
  const clock = new FixedClock();

  const post = (body: object, ip = nextIp()) =>
    request(app.getHttpServer())
      .post('/api/proposals')
      .set('X-Forwarded-For', ip)
      .send(body);

  /** Runs a submitted word through review and scheduling, then publishes it on its day. */
  const publish = async (word: string, day: string) => {
    const reviewer = await prisma.user.create({
      data: {
        email: `${word}-r@test`,
        displayName: 'r',
        role: Role.REVIEWER,
        passwordHash: 'x',
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: `${word}-a@test`,
        displayName: 'a',
        role: Role.ADMIN,
        passwordHash: 'x',
      },
    });
    const asReviewer: Actor = {
      kind: 'user',
      id: reviewer.id,
      role: Role.REVIEWER,
    };
    const asAdmin: Actor = { kind: 'user', id: admin.id, role: Role.ADMIN };
    const { id } = await proposals.submit({ word, proposerName: 'Léa' });
    const approved = await proposals.approve(id, asReviewer, 0);
    await proposals.schedule(id, asAdmin, approved.version, day);
    clock.current = new Date(`${day}T08:00:00Z`);
    return job.run();
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Clock)
      .useValue(clock)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({
      logger: false,
    });
    configureApp(app);
    await app.listen(0);
    baseUrl = await app.getUrl();
    prisma = app.get(PrismaService);
    proposals = app.get(ProposalsService);
    job = app.get(PublicationJob);
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE proposal_events, proposals, users CASCADE',
    );
    clock.current = new Date('2026-10-06T08:00:00Z');
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports health with a database round trip', async () => {
    await request(app.getHttpServer())
      .get('/api/health')
      .expect(200, { status: 'ok' });
  });

  describe('POST /api/proposals', () => {
    it('accepts a word and returns a minimal receipt', async () => {
      const response = await post({
        word: ' Carouge ',
        proposerName: ' Léa ',
      }).expect(201);

      expect(response.body).toEqual({
        id: expect.any(String),
        word: 'carouge',
        status: 'SUBMITTED',
      });
      const stored = await prisma.proposal.findUniqueOrThrow({
        where: { id: response.body.id },
      });
      expect(stored.proposerName).toBe('Léa');
    });

    it('explains why a word is refused', async () => {
      const response = await post({ word: 'deux mots' }).expect(422);
      expect(response.body).toMatchObject({
        code: 'INVALID_WORD',
        reason: 'characters',
      });
    });

    it('refuses a word proposed before', async () => {
      await post({ word: 'nestjs' }).expect(201);
      const response = await post({ word: 'NestJS' }).expect(409);
      expect(response.body.code).toBe('DUPLICATE_WORD');
    });

    it('validates the payload shape', async () => {
      expect((await post({}).expect(400)).body.code).toBe('VALIDATION_FAILED');
      expect(
        (await post({ word: 'ok', admin: true }).expect(400)).body.code,
      ).toBe('VALIDATION_FAILED');
      expect((await post({ word: 42 }).expect(400)).body.code).toBe(
        'VALIDATION_FAILED',
      );
    });

    it('limits each visitor to three submissions per hour', async () => {
      const ip = nextIp();
      for (const word of ['un', 'deux', 'trois']) {
        await post({ word }, ip).expect(201);
      }
      const blocked = await post({ word: 'quatre' }, ip).expect(429);
      expect(blocked.body.code).toBe('TOO_MANY_REQUESTS');
      // Another visitor is unaffected.
      await post({ word: 'cinq' }).expect(201);
    });
  });

  describe('GET /api/words/current', () => {
    it('is empty until a word is published', async () => {
      await request(app.getHttpServer())
        .get('/api/words/current')
        .expect(200, { word: null, proposerName: null, day: null });
    });

    it('returns the published word of the day', async () => {
      await publish('genève', '2026-10-07');
      await request(app.getHttpServer()).get('/api/words/current').expect(200, {
        word: 'genève',
        proposerName: 'Léa',
        day: '2026-10-07',
      });
    });
  });

  describe('GET /api/words/stream', () => {
    it('sends the current word, then pushes the next one live', async () => {
      const controller = new AbortController();
      try {
        const response = await fetch(`${baseUrl}/api/words/stream`, {
          signal: controller.signal,
        });
        expect(response.headers.get('content-type')).toContain(
          'text/event-stream',
        );

        const reader = response
          .body!.pipeThrough(new TextDecoderStream())
          .getReader();
        let buffer = '';
        /** Reads SSE blocks ("field: value" lines, blank-line separated) until a "word" event. */
        const nextWordEvent = async (): Promise<unknown> => {
          for (;;) {
            const end = buffer.indexOf('\n\n');
            if (end !== -1) {
              const block = buffer.slice(0, end);
              buffer = buffer.slice(end + 2);
              const fields = Object.fromEntries(
                block
                  .split('\n')
                  .filter((line) => line.includes(': '))
                  .map((line) => [
                    line.slice(0, line.indexOf(': ')),
                    line.slice(line.indexOf(': ') + 2),
                  ]),
              );
              if (fields.event === 'word') return JSON.parse(fields.data);
              continue;
            }
            const { value, done } = await reader.read();
            if (done) throw new Error('stream closed');
            buffer += value;
          }
        };

        expect(await nextWordEvent()).toEqual({
          word: null,
          proposerName: null,
          day: null,
        });

        await publish('salève', '2026-10-07');
        expect(await nextWordEvent()).toMatchObject({
          word: 'salève',
          day: '2026-10-07',
        });
      } finally {
        // Always close the stream, otherwise app.close() waits for it forever.
        controller.abort();
      }
    });
  });

  it('serves the OpenAPI document', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);
    expect(Object.keys(response.body.paths)).toEqual(
      expect.arrayContaining([
        '/api/proposals',
        '/api/words/current',
        '/api/words/stream',
      ]),
    );
  });
});
