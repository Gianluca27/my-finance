# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

MyFinance — personal finance management (PFM) app: web + mobile clients backed by a shared Express/Prisma API. UI copy, code comments, and commit history are in Spanish; keep new user-facing strings and comments in Spanish for consistency.

## Monorepo layout

npm workspaces, no shared build tool (each package builds independently):

- `packages/shared` — `@myfinance/shared`: TypeScript types (`types.ts`) + `ApiClient` HTTP wrapper (`api.ts`), consumed as **TS source directly** (no compiled output — its `build`/`typecheck` scripts just run `tsc --noEmit`). Both `apps/web` and `apps/mobile` import from here; changing a route's request/response shape means updating types here first, then the API route, then both clients.
- `apps/api` — Express + TypeScript + Prisma + PostgreSQL.
- `apps/web` — React + TypeScript (Vite) + Recharts.
- `apps/mobile` — React Native (Expo).

## Commands

Run from repo root (workspace-aware via `-w`):

```bash
npm install                    # installs all workspaces
docker compose up -d           # Postgres on :5432 for local dev
npm run db:migrate             # prisma migrate dev (apps/api)
npm run db:seed                # demo user: demo@myfinance.app / demo1234
npm run dev:api                # API on :4000
npm run dev:web                # web on :5173, proxies /api -> :4000 (see apps/web/vite.config.ts)
npm run typecheck              # shared + api + web, in that order
npm run build                  # shared -> api -> build order matters: shared has no emitted JS,
                                # but api/web still need it type-checked first
```

Single-workspace equivalents: `npm run <script> -w @myfinance/api` (or `@myfinance/web`, `@myfinance/shared`). Inside `apps/api`, `db:migrate` is `prisma migrate dev`, `db:deploy` is the no-prompt production form (`prisma migrate deploy`, used by Railway on every deploy — see `DEPLOY.md`).

Mobile app is a separate workspace, not part of root `npm install`/scripts:

```bash
cd apps/mobile && npm install && npm start
```

**No test suite exists in this repo currently** (no test runner configured, no `*.test.*`/`*.spec.*` files). Don't assume Jest/Vitest conventions — check before adding tests.

## Architecture

### API request flow

`apps/api/src/app.ts` wires one router per resource (`routes/*.ts`) behind `requireAuth` (`middleware/auth.ts`, JWT bearer token, populates `req.auth.userId`). Every resource is scoped to the authenticated user — routes filter Prisma queries by `userId` directly, there is no separate authorization layer.

Prisma returns `Decimal` for money fields and `Date` objects; routes pass responses through `serialize()` (`lib/serialize.ts`) to recursively convert `Decimal -> number` and `Date -> ISO string` before sending JSON, so the wire format matches the plain types in `packages/shared/src/types.ts`. When adding a new route or field, run new Prisma results through `serialize()` rather than hand-rolling conversion.

### Shared types/client as the contract

`packages/shared` is the single source of truth for request/response shapes and is imported unbuilt by both frontends. There's no OpenAPI spec or codegen — `ApiClient` methods in `packages/shared/src/api.ts` are the manually-maintained mirror of the Express routes. A route change is three edits: `packages/shared/src/types.ts` (+ `api.ts` method signature if the endpoint shape changed) -> `apps/api/src/routes/*.ts` -> callers in `apps/web`/`apps/mobile`.

`apps/web/src/api.ts` and `apps/mobile/src/api.ts` each instantiate their own `ApiClient` with platform-specific token storage (`localStorage` vs `AsyncStorage`) and `onUnauthorized` handling — the client class itself is platform-agnostic (plain `fetch`).

### Recurring expenses & notifications

`RecurringExpense.nextDueDate` advances each time `POST /api/recurring/:id/pay` is called (creates a `Transaction` + moves the date forward per `frequency`/`dueDay`/`dueMonth`). A daily cron (`config.remindersCron`, `src/jobs/reminders.ts`) also auto-advances past-due dates and sends reminders via `services/notifications.ts` (SendGrid email + Firebase push) when `reminderDaysBefore` days remain, gated by `lastRemindedFor` to avoid duplicate sends per due date.

Budget threshold alerts fire inline in `services/budgetAlerts.ts` when a transaction is created against a budgeted category, gated by `lastAlertMonth` (max one alert per budget per month).

Both email (`SENDGRID_API_KEY`) and push (`FIREBASE_SERVICE_ACCOUNT_JSON`) are optional — each service checks its own config in `config.ts` and no-ops with a log warning if unset, rather than throwing.

### Auth

JWT-based, no sessions/refresh tokens. `signToken`/`requireAuth` in `middleware/auth.ts`. Token accepted via `Authorization: Bearer` header or a `?token=` query param (the latter exists specifically so `<a href>` report download links — CSV/PDF, unauthenticated by browsers' native navigation — can still hit protected routes).

### Deployment topology

Two independently deployed services connected only over HTTP (see `DEPLOY.md` for full walkthrough): Railway hosts Postgres + `apps/api` (root directory must be repo root, not `apps/api`, so npm workspace linking resolves `@myfinance/shared`); Vercel hosts `apps/web` as a static SPA build (needs the `vercel.json` rewrite for client-side routing). `CORS_ORIGIN` in the API and `VITE_API_URL` in the web build must point at each other; `config.ts` splits `CORS_ORIGIN` on commas to support multiple origins.
