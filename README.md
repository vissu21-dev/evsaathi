# EVSaathi — Phase 1 Functional MVP

**Brand:** EVSaathi (locked)  
**Promise:** Know your real range before you go.  
**Scope:** Indian EV companion that works **without OEM telematics**. Never invents live SOC, charger availability, prices, or battery health.

## What’s real vs demo

| Data | Status |
|------|--------|
| Auth OTP | Secure **stub** — demo code `123456` (SMS provider not wired) |
| Vehicle specs | Seed catalog (XEV 9S Pack 3 79 kWh + others); user overrides supported |
| SOC / sessions / costs | **Manual** user entry persisted in DB |
| Range / trip / charge cost | **Estimated** with documented assumptions + unit tests |
| Stations | **Demo-labeled** seeded metro catalog (no licensed CPO API keys) |
| OEM / live availability / reliability score / AI / community | **Not in Phase 1** |

## Monorepo

```
apps/api          Express + Prisma API (`/v1/*`) — SQLite by default
apps/mobile       Expo (React Native) + web — EVSaathi UI
packages/shared   Shared math (range, cost, trip energy) + Vitest
docker-compose.yml  Optional Postgres 16
```

Architecture docs target NestJS long-term; Phase 1 ships a lean Express API matching the OpenAPI-oriented routes in `docs/api-specification.md`.

## Prerequisites

- Node.js 20+
- pnpm 10+
- (Optional) Docker for Postgres

## Quick start

```bash
cd /agent/evsaathi
pnpm install
pnpm --filter @evsaathi/shared build
pnpm --filter @evsaathi/api db:migrate
pnpm --filter @evsaathi/api db:seed

# Terminal 1 — API (http://127.0.0.1:4000)
pnpm dev:api

# Terminal 2 — Expo web (http://127.0.0.1:8081)
pnpm --filter @evsaathi/mobile install   # first time
pnpm dev:mobile
```

### Demo login

1. Open the Expo web app.
2. Phone: `9876543210` (or `+919876543210`).
3. Request OTP → enter `123456`.
4. Pick **Mahindra XEV 9S Pack 3**, save vehicle.
5. Update SOC, explore Charging (demo stations), Trips, Analytics.

### API smoke

```bash
curl -s http://127.0.0.1:4000/v1/health
curl -s -X POST http://127.0.0.1:4000/v1/auth/otp/request \
  -H 'content-type: application/json' \
  -d '{"phone_e164":"+919876543210"}'
```

## Tests

```bash
pnpm --filter @evsaathi/shared test
pnpm --filter @evsaathi/api test
```

Covers range, charge cost, trip energy, charge time, and usable-kWh resolution (never silently equates stated≠usable).

## Postgres (optional)

```bash
docker compose up -d
# Then switch apps/api/prisma/schema.prisma provider to postgresql
# DATABASE_URL=postgresql://evsaathi:evsaathi@localhost:5432/evsaathi
pnpm db:migrate && pnpm db:seed
```

Default Phase 1 path uses **SQLite** (`apps/api/prisma/dev.db`) so the demo runs without Docker.

## Environment

| Var | Default | Notes |
|-----|---------|-------|
| `DATABASE_URL` | `file:./dev.db` | Prisma |
| `JWT_SECRET` | dev secret | Change for any shared deploy |
| `DEMO_OTP` | `123456` | OTP stub |
| `PORT` | `4000` | API |
| `EXPO_PUBLIC_API_URL` | `http://127.0.0.1:4000/v1` | Mobile/web |

## Design

Night-road teal/amber per project design system. Original EVSaathi brand — **not** a Me4U clone. Provenance chips: MANUAL / EST. / DEMO / SYNCED / LIVE (LIVE unused in Phase 1).
