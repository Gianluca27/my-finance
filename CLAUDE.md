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

Tests: `npm test` (root) runs Vitest in `apps/api` only. Coverage is deliberately narrow — pure functions with no DB or network (`lib/investments.test.ts`, `services/providers/data912.test.ts`). There's no test runner in `apps/web`/`apps/mobile` and no integration/route tests; don't assume they exist. `apps/api/tsconfig.json` excludes `src/**/*.test.ts` so `tsc` never emits them to `dist/`.

## Architecture

### API request flow

`apps/api/src/app.ts` wires one router per resource (`routes/*.ts`) behind `requireAuth` (`middleware/auth.ts`, JWT bearer token, populates `req.auth.userId`). Every resource is scoped to the authenticated user — routes filter Prisma queries by `userId` directly, there is no separate authorization layer.

Prisma returns `Decimal` for money fields and `Date` objects; routes pass responses through `serialize()` (`lib/serialize.ts`) to recursively convert `Decimal -> number` and `Date -> ISO string` before sending JSON, so the wire format matches the plain types in `packages/shared/src/types.ts`. When adding a new route or field, run new Prisma results through `serialize()` rather than hand-rolling conversion.

### Shared types/client as the contract

`packages/shared` is the single source of truth for request/response shapes and is imported unbuilt by both frontends. There's no OpenAPI spec or codegen — `ApiClient` methods in `packages/shared/src/api.ts` are the manually-maintained mirror of the Express routes. A route change is three edits: `packages/shared/src/types.ts` (+ `api.ts` method signature if the endpoint shape changed) -> `apps/api/src/routes/*.ts` -> callers in `apps/web`/`apps/mobile`.

`apps/web/src/api.ts` and `apps/mobile/src/api.ts` each instantiate their own `ApiClient` with platform-specific token storage (`localStorage` vs `AsyncStorage`) and `onUnauthorized` handling — the client class itself is platform-agnostic (plain `fetch`).

### Investment price providers

`services/providers/` holds one adapter per price source behind the `PriceProvider` interface (`types.ts`), resolved through a registry (`index.ts`) — the cron (`jobs/prices.ts`) and `routes/investments.ts` never name a provider directly, they dispatch on the `Investment.providerSource` column.

- **`twelveData.ts`** — US stocks/ETFs + crypto. Needs `TWELVE_DATA_API_KEY`; the free plan meters market endpoints (8 credits/min), so `fetchPrices` chunks and sleeps. Also owns the official USD rate.
- **`data912.ts`** — Argentine market (`stocks`, `cedears`, `bonds`, `notes`, `corp`) + implied MEP/CCL. Public, no key, on unless `DATA912_ENABLED=false`. One request returns a whole market, so the five live lists are cached in memory and both search and price are `Map` lookups. Only `stocks`/`cedears`/`bonds` have an OHLC endpoint — `notes`/`corp` return `[]` from `fetchDailyCloses` and their charts fill up from the daily cron instead.

Both are optional and fail independently: each block of `runPricesJob` has its own try/catch, and a missing provider degrades that asset class to manual pricing rather than throwing.

Two invariants that are easy to break:

- **`Investment.priceFactor`** is the number of nominals one quoted price covers: `1` everywhere except Argentine fixed income (`bonds`/`notes`/`corp`), which quotes per 100 VN. `investmentMetrics()` divides only the *monetary* outputs (`investedCost`, `currentValue`) by it — `avgCost` stays in quoted-price space so it remains comparable with `currentPrice`, and the factor cancels out of `pnlPercent`. The server derives it from `providerMarket` for linked assets and never trusts the client's value.
- **Currency of a data912 symbol is a suggestion, not data.** The same instrument trades in pesos and dollars under different tickers (`AL30` / `AL30D` / `AL30C`), but a peso ticker can itself end in `D` (`YPFD` is YPF Clase D; `AMD`, `C`, `HSBC` are CEDEARs). `suggestCurrency()` only calls a symbol USD when its base species exists *and* the price ratio looks like a MEP/CCL — see its doc comment before touching it.

`ExchangeRate` rows for `USD` (Twelve Data), `USDMEP` and `USDCCL` (data912) are cron-owned and rejected by `assertRateEditable`.

### Recurring expenses & notifications

`RecurringExpense.nextDueDate` advances each time `POST /api/recurring/:id/pay` is called (creates a `Transaction` + moves the date forward per `frequency`/`dueDay`/`dueMonth`). A daily cron (`config.remindersCron`, `src/jobs/reminders.ts`) also auto-advances past-due dates and sends reminders via `services/notifications.ts` (SendGrid email + Firebase push) when `reminderDaysBefore` days remain, gated by `lastRemindedFor` to avoid duplicate sends per due date.

Budget threshold alerts fire inline in `services/budgetAlerts.ts` when a transaction is created against a budgeted category, gated by `lastAlertMonth` (max one alert per budget per month).

Both email (`SENDGRID_API_KEY`) and push (`FIREBASE_SERVICE_ACCOUNT_JSON`) are optional — each service checks its own config in `config.ts` and no-ops with a log warning if unset, rather than throwing.

### Auth

JWT-based, no sessions/refresh tokens. `signToken`/`requireAuth` in `middleware/auth.ts`. Token accepted via `Authorization: Bearer` header or a `?token=` query param (the latter exists specifically so `<a href>` report download links — CSV/PDF, unauthenticated by browsers' native navigation — can still hit protected routes).

### Deployment topology

Two independently deployed services connected only over HTTP (see `DEPLOY.md` for full walkthrough): Railway hosts Postgres + `apps/api` (root directory must be repo root, not `apps/api`, so npm workspace linking resolves `@myfinance/shared`); Vercel hosts `apps/web` as a static SPA build (needs the `vercel.json` rewrite for client-side routing). `CORS_ORIGIN` in the API and `VITE_API_URL` in the web build must point at each other; `config.ts` splits `CORS_ORIGIN` on commas to support multiple origins.
