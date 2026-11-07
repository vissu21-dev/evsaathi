# EVSaathi — Phase 3 Integrations + AI

**Brand:** EVSaathi (locked)  
**Promise:** Know your real range before you go.  
**Scope:** Indian EV companion with **adapter framework**, **consent UX**, **demo OEM/operator stubs**, **explainable AI**, and **graceful manual fallback**. Never invents LIVE SOC/availability. AI never issues vehicle/charger actuators.

## Phase 3 Must

| ID | Feature | Status |
|----|---------|--------|
| P3-M01 | Telemetry ingest model + adapter interfaces | Done |
| P3-M02 | Demo OEM stub + consent UX (not LIVE) | Done |
| P3-M03 | Demo operator adapter (directory + session sync) | Done |
| P3-M04 | Freshness labels wired to adapter observations | Done |
| P3-M05 | Session intelligence only when adapter provides it | Done |
| P3-M06 | AI assistant + hard deny actuators | Done |
| P3-M07 | Advanced analytics on richer telemetry | Done |
| P3-M08 | Graceful degradation → manual | Done |
| P3-M09 | Admin API health / consent audit / circuit breakers | Done |

## What’s real vs demo

| Data | Status |
|------|--------|
| Auth OTP | Secure **stub** — demo code `123456` |
| Vehicle specs | Seed catalog (XEV 9S Pack 3 79 kWh + others) |
| SOC / sessions / costs | Manual, import, or **demo adapter** (labeled SYNCED) |
| OEM / operator adapters | **Demo/simulated stubs** — never LIVE |
| Reliability | Crowdsource (Phase 2) — ≠ operator telemetry |
| AI assistant | Deterministic tool broker; actuators hard-denied |
| LIVE availability / ME4U scrape / AI remote control | **Forbidden** |

## Monorepo

```
apps/api          Express + Prisma API (`/v1/*`) — SQLite by default
apps/mobile       Expo (React Native) + web — EVSaathi UI
packages/shared   Math + telemetry + AI ACL + Vitest
```

## Quick start

```bash
pnpm install
pnpm --filter @evsaathi/shared build
pnpm --filter @evsaathi/api db:migrate
pnpm --filter @evsaathi/api db:seed

pnpm dev:api          # :4000
pnpm dev:mobile       # Expo web :8081
```

### Demo login

1. Phone: `9876543210` → OTP `123456`
2. Admin: `9900000099` → OTP `123456`
3. Profile → Integrations (consent + demo OEM sync) · AI assistant
4. Admin HTML: `GET /v1/admin/integrations` (bearer)

### Key Phase 3 APIs

- `GET /v1/integrations/adapters`
- `POST /v1/integrations/consents`
- `POST /v1/vehicles/:id/integrations/oem/sync`
- `GET /v1/vehicles/:id/integrations/sessions/live`
- `GET /v1/vehicles/:id/analytics/advanced`
- `POST /v1/ai/assistant`
- `GET /v1/admin/integrations/health`

## Tests

```bash
pnpm --filter @evsaathi/shared test
pnpm --filter @evsaathi/api test
```

## Environment

| Var | Default | Notes |
|-----|---------|-------|
| `DATABASE_URL` | `file:./dev.db` | SQLite |
| `JWT_SECRET` | see `.env.example` | Dev only |
| `FCM_SERVER_KEY` | unset | Optional push |
| `PORT` | `4000` | API |

## Honesty rules

1. Demo/simulated adapters are never labeled **LIVE**.
2. Manual path always works when OEM/operator is down (circuit breaker → degrade).
3. AI tool ACL denies remote start/stop, unlock, climate, OBD write, etc.
4. No scraping private OEM endpoints; no ME4U reverse engineering.
