import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { hashPassword } from '../src/auth/password.js';
import { Clock } from '../src/common/clock.js';
import { Role } from '../src/generated/prisma/enums.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

class FixedClock extends Clock {
  current = new Date('2026-10-06T08:00:00Z');
  now(): Date {
    return this.current;
  }
}

const PASSWORD = 'correct horse battery staple';
let visitor = 0;
const nextIp = () => `198.51.100.${++visitor}`;

describe('Back-office API', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let passwordHash: string;
  const clock = new FixedClock();

  const server = () => app.getHttpServer();
  /** A browser-like client: keeps the session cookie between requests. */
  const signIn = async (email: string): Promise<TestAgent> => {
    const agent = request.agent(server()).set('X-Forwarded-For', nextIp());
    await agent
      .post('/api/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return agent;
  };
  const submit = async (word: string) =>
    (
      await request(server())
        .post('/api/proposals')
        .set('X-Forwarded-For', nextIp())
        .send({ word })
        .expect(201)
    ).body.id as string;
  const find = async (agent: TestAgent, id: string) =>
    (
      (await agent.get('/api/proposals').expect(200)).body as { id: string }[]
    ).find((p) => p.id === id);

  beforeAll(async () => {
    passwordHash = await hashPassword(PASSWORD);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Clock)
      .useValue(clock)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({
      logger: false,
    });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE proposal_events, proposals, users CASCADE',
    );
    await prisma.user.createMany({
      data: [
        {
          email: 'reviewer@test',
          displayName: 'Rita',
          role: Role.REVIEWER,
          passwordHash,
        },
        {
          email: 'admin@test',
          displayName: 'Bruno',
          role: Role.ADMIN,
          passwordHash,
        },
      ],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('authentication', () => {
    it('refuses wrong credentials without telling which part is wrong', async () => {
      const wrongPassword = await request(server())
        .post('/api/auth/login')
        .set('X-Forwarded-For', nextIp())
        .send({ email: 'admin@test', password: 'nope' })
        .expect(401);
      const unknownEmail = await request(server())
        .post('/api/auth/login')
        .set('X-Forwarded-For', nextIp())
        .send({ email: 'ghost@test', password: PASSWORD })
        .expect(401);
      expect(wrongPassword.body).toEqual(unknownEmail.body);
      expect(wrongPassword.body.code).toBe('INVALID_CREDENTIALS');
    });

    it('sets a locked-down session cookie and knows who is signed in', async () => {
      const response = await request(server())
        .post('/api/auth/login')
        .set('X-Forwarded-For', nextIp())
        .send({ email: ' Admin@Test ', password: PASSWORD })
        .expect(200);

      expect(response.body).toMatchObject({
        displayName: 'Bruno',
        role: 'ADMIN',
      });
      const cookie = response.headers['set-cookie'][0];
      expect(cookie).toMatch(/^session=/);
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/SameSite=Strict/);
      expect(cookie).toMatch(/Path=\/api/);

      const agent = await signIn('admin@test');
      await agent.get('/api/auth/me').expect(200);
      await agent.post('/api/auth/logout').expect(204);
      expect((await agent.get('/api/auth/me').expect(401)).body.code).toBe(
        'UNAUTHENTICATED',
      );
    });

    it('keeps the back-office closed to anonymous visitors and forged tokens', async () => {
      expect(
        (await request(server()).get('/api/proposals').expect(401)).body.code,
      ).toBe('UNAUTHENTICATED');
      await request(server())
        .get('/api/proposals')
        .set('Cookie', 'session=forged.token.value')
        .expect(401);
    });

    it('limits login attempts', async () => {
      const ip = nextIp();
      for (let i = 0; i < 5; i++) {
        await request(server())
          .post('/api/auth/login')
          .set('X-Forwarded-For', ip)
          .send({ email: 'admin@test', password: 'guess' })
          .expect(401);
      }
      await request(server())
        .post('/api/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ email: 'admin@test', password: PASSWORD })
        .expect(429);
    });
  });

  describe('review workflow over HTTP', () => {
    it('tells each role which actions are available', async () => {
      const id = await submit('carouge');
      const reviewer = await signIn('reviewer@test');
      const admin = await signIn('admin@test');

      expect((await find(reviewer, id))!).toMatchObject({
        status: 'SUBMITTED',
        version: 0,
        actions: ['approve', 'reject'],
      });

      const approved = await reviewer
        .post(`/api/proposals/${id}/approve`)
        .send({ version: 0 })
        .expect(200);
      expect(approved.body).toMatchObject({
        status: 'APPROVED',
        version: 1,
        actions: [],
      });
      expect((await find(admin, id))!).toMatchObject({
        actions: ['schedule', 'publishNow'],
      });
    });

    it('maps workflow refusals to HTTP errors', async () => {
      const id = await submit('lac');
      const reviewer = await signIn('reviewer@test');

      await reviewer
        .post(`/api/proposals/${id}/reject`)
        .send({ version: 0 })
        .expect(400);
      expect(
        (
          await reviewer
            .post(`/api/proposals/${id}/reject`)
            .send({ version: 0, reason: '  ' })
            .expect(422)
        ).body.code,
      ).toBe('REJECTION_REASON_REQUIRED');
      expect(
        (
          await reviewer
            .post(`/api/proposals/${id}/approve`)
            .send({ version: 7 })
            .expect(409)
        ).body.code,
      ).toBe('CONCURRENT_UPDATE');
      await reviewer
        .post(`/api/proposals/${id}/approve`)
        .send({ version: 0 })
        .expect(200);
      expect(
        (
          await reviewer
            .post(`/api/proposals/${id}/schedule`)
            .send({ version: 1, day: '2026-10-07' })
            .expect(403)
        ).body.code,
      ).toBe('FORBIDDEN_TRANSITION');
      await reviewer
        .post('/api/proposals/not-a-uuid/approve')
        .send({ version: 0 })
        .expect(400);
    });

    it('lets an admin schedule, and publish on the spot for a live demo', async () => {
      const first = await submit('fondue');
      const second = await submit('raclette');
      const reviewer = await signIn('reviewer@test');
      const admin = await signIn('admin@test');
      await reviewer
        .post(`/api/proposals/${first}/approve`)
        .send({ version: 0 })
        .expect(200);
      await reviewer
        .post(`/api/proposals/${second}/approve`)
        .send({ version: 0 })
        .expect(200);

      const scheduled = await admin
        .post(`/api/proposals/${first}/schedule`)
        .send({ version: 1, day: '2026-10-09' })
        .expect(200);
      expect(scheduled.body).toMatchObject({
        status: 'SCHEDULED',
        scheduledFor: '2026-10-09',
        actions: ['unschedule'],
      });

      await admin
        .post(`/api/proposals/${second}/publish-now`)
        .send({ version: 1 })
        .expect(200);
      await request(server()).get('/api/words/current').expect(200, {
        word: 'raclette',
        proposerName: null,
        day: '2026-10-06',
      });

      // A second immediate publication replaces and archives the first one.
      const third = await submit('bise');
      await reviewer
        .post(`/api/proposals/${third}/approve`)
        .send({ version: 0 })
        .expect(200);
      await admin
        .post(`/api/proposals/${third}/publish-now`)
        .send({ version: 1 })
        .expect(200);
      expect(
        (await request(server()).get('/api/words/current').expect(200)).body
          .word,
      ).toBe('bise');
      expect(
        (
          await admin.get('/api/proposals?status=ARCHIVED').expect(200)
        ).body.map((p: { word: string }) => p.word),
      ).toEqual(['raclette']);

      const history = (
        await admin.get(`/api/proposals/${second}/history`).expect(200)
      ).body;
      expect(
        history.map((e: { toStatus: string; actorName: string | null }) => [
          e.toStatus,
          e.actorName,
        ]),
      ).toEqual([
        ['SUBMITTED', null],
        ['APPROVED', 'Rita'],
        ['PUBLISHED', 'Bruno'],
        ['ARCHIVED', null],
      ]);
    });
  });
});
