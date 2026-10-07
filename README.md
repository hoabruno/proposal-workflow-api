# proposal-workflow-api

Word-of-the-day API with a role-based review workflow: four-eyes approval,
optimistic locking, audit trail and a daily publication job. Built with
Nest.js, Prisma and PostgreSQL.

Visitors propose a word, reviewers approve or reject it, an admin schedules
approved words on the calendar, and a daily job publishes the **word of the
day**, which an animated page then spells out.

The code lives in [`api/`](api/).

## Proposal workflow

```
SUBMITTED ──approve──► APPROVED ──schedule──► SCHEDULED ──publish──► PUBLISHED ──archive──► ARCHIVED
    │                      ▲                      │
    └──reject──► REJECTED  └──────unschedule──────┘
```

The transitions table in
[`api/src/proposals/domain/workflow.ts`](api/src/proposals/domain/workflow.ts)
is the single source of truth. Business rules:

- **Roles.** Reviewers and admins approve or reject; only admins schedule;
  only the daily job publishes and archives.
- **Four-eyes rule.** Nobody reviews a word they proposed themselves.
- **One word per day.** Enforced by a unique `scheduled_for` column; days are
  calendar days in Geneva (`Europe/Zurich`), and planning starts tomorrow.
- **Each word once.** The normalized word (trimmed, lowercased, NFC) is
  unique, so concurrent identical submissions are settled by the database.
  Words are 2 to 12 characters, letters (French accents included), digits,
  `.` and `-`, and pass a small blocklist.
- **Rejections need a reason**, kept on the proposal and in the audit trail.
- **Optimistic locking.** Every transition must quote the version the user
  saw; if someone else acted first, the request fails with
  `CONCURRENT_UPDATE` instead of overwriting their decision.
- **Audit trail.** Every status change appends a `proposal_events` row in the
  same transaction as the change.
- **Daily job.** Publishes due words, keeps the latest live and archives the
  rest. It catches up after missed runs, is idempotent, and takes a Postgres
  advisory lock so two instances cannot publish twice.

Domain errors carry stable codes (`SELF_REVIEW`, `DATE_ALREADY_TAKEN`, ...)
meant to be mapped to HTTP status codes and to user-facing messages.

## HTTP API

All routes live under `/api`; interactive documentation at `/api/docs`
(OpenAPI JSON at `/api/docs-json`).

| Method | Route                 | Description                                                         |
| ------ | --------------------- | ------------------------------------------------------------------- |
| POST   | `/api/proposals`      | Propose a word. Anonymous, limited to 3 per hour per visitor.       |
| GET    | `/api/words/current`  | Word of the day, or `null` before the first publication.            |
| GET    | `/api/words/stream`   | Server-Sent Events: `word` on connect and on every change, `ping` every 25 s. |
| GET    | `/api/health`         | Liveness with a database round trip.                                |

Errors always have the shape `{ "code": "...", "message": "..." }` (plus
`reason` for `INVALID_WORD`): `422` invalid word, `409` duplicate or
conflicting update, `403` forbidden transition, `429` rate limited, `400`
malformed payload (`VALIDATION_FAILED`).

The daily job runs at 00:00:30 in Geneva and once at boot, so a server that
was down at midnight catches up as soon as it starts.

## Code map

| Path                                  | Role                                                        |
| ------------------------------------- | ----------------------------------------------------------- |
| `api/prisma/schema.prisma`            | Data model: users, proposals, append-only proposal events   |
| `api/src/proposals/domain/`           | Pure domain logic: workflow, word policy, Geneva calendar   |
| `api/src/proposals/proposals.service.ts` | Transactions, optimistic locking, daily publication job  |
| `api/src/words/`                      | Word of the day, live feed (SSE) and the scheduled job      |
| `api/src/common/api-exception.filter.ts` | Domain error codes to HTTP statuses                      |
| `api/test/proposals.e2e-spec.ts`      | Service tests against a real PostgreSQL                     |
| `api/test/http.e2e-spec.ts`           | HTTP tests: validation, rate limit, SSE, OpenAPI            |

## Running locally

Requirements: Node.js 22+ and **npm 11+** (npm 9 and 10 crash on this
dependency tree; `npx npm@11 install` works if your system npm is older).
Docker is not needed: local development and tests use
[embedded-postgres](https://github.com/leinelissen/embedded-postgres), a real
PostgreSQL 18 started from `node_modules`.

```bash
cd api
npm install                      # also generates the Prisma client
cp .env.example .env
npm run db:dev                   # terminal 1: Postgres on localhost:54329
npx prisma migrate deploy        # terminal 2: apply migrations
npm run start:dev                # http://localhost:3000/api/health
```

## Tests

```bash
npm test             # unit tests: workflow, word policy, Geneva calendar
npm run test:e2e     # service and HTTP tests against a throwaway Postgres (port 54330)
npm run lint
```

The e2e suite starts its own database, applies the real migrations and
covers concurrency on purpose: simultaneous identical submissions, two
reviewers acting on the same proposal, and two instances running the daily
job at once.

## Roadmap

- Authentication and reviewer/admin endpoints, OpenAPI documentation.
- Vue 3 back-office for reviewers and admins.
- Docker image, CI and deployment.

## Notes

- `npm audit` reports two advisories (`deepmerge-ts`, `mysql2`) pulled in by
  the Prisma CLI, which `@prisma/client` lists as a peer dependency. They
  only affect the CLI (config merging and an unused MySQL driver), never the
  code that serves requests.
- Prisma 7 talks to Postgres through the `@prisma/adapter-pg` driver adapter;
  the generated client lives in `api/src/generated` and is not committed.
