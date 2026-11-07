# EVSaathi — Phase 2 Charging Intelligence

**Brand:** EVSaathi (locked)  
**Promise:** Know your real range before you go.  
**Scope:** Indian EV companion that works **without OEM telematics**. Crowdsource reliability ≠ operator telemetry. Never invents live SOC, charger availability, prices, or battery health.

## Phase 2 Must

| ID | Feature | Status |
|----|---------|--------|
| P2-M01 | Reliability 0–100 + confidence + last verified | Done (documented weights, crowdsource) |
| P2-M02 | Owner reports + photos + anti-spam rate limits | Done |
| P2-M03 | Verification timestamp UX | Done |
| P2-M04 | Alternative chargers on trip/failure | Done |
| P2-M05 | Trip strategies Fastest / Lowest cost / Most reliable | Done |
| P2-M06 | Session analytics (manual dense series) | Done |
| P2-M07 | History-weighted range prediction | Done |
| P2-M08 | Notifications (in-app inbox; FCM if `FCM_SERVER_KEY`) | Done |
| P2-M09 | Admin failure triage + reliability quarantine | Done (API + minimal HTML) |

## What’s real vs demo

| Data | Status |
|------|--------|
| Auth OTP | Secure **stub** — demo code `123456` |
| Vehicle specs | Seed catalog (XEV 9S Pack 3 79 kWh + others) |
| SOC / sessions / costs | **Manual** user entry |
| Reliability | **Crowdsource** formula — never labeled as operator live |
| Stations | **Demo-labeled** seeded metro catalog |
| Notifications | In-app inbox by default; FCM only if key present |
| OEM / LIVE availability / AI / community | **Not in Phase 2** |

## Monorepo

```
apps/api          Express + Prisma API (`/v1/*`) — SQLite by default
apps/mobile       Expo (React Native) + web — EVSaathi UI
packages/shared   Shared math (range, reliability, trip strategy) + Vitest
docker-compose.yml  Optional Postgres 16
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

1. Phone: `9876543210` (or `+919876543210`) → OTP `123456`
2. Admin triage: phone `9900000099` (`+919900000099`) → OTP `123456` (role=admin)
3. Explore Charging → station detail (score, reports, alternatives), Trips (strategies), Profile → Notifications

### Admin triage

```bash
# After admin login, use bearer token:
curl -s http://127.0.0.1:4000/v1/admin/failure-reports -H "Authorization: Bearer $TOKEN"
# Minimal HTML: GET /v1/admin/triage (same auth)
```

## Tests

```bash
pnpm --filter @evsaathi/shared test
pnpm --filter @evsaathi/api test
```

Covers range, cost, trip energy, **reliability scoring**, **trip strategy selection**, history-weighted efficiency.

## Environment

| Var | Default | Notes |
|-----|---------|-------|
| `DATABASE_URL` | `file:./dev.db` | Prisma |
| `JWT_SECRET` | dev secret | Change for shared deploy |
| `DEMO_OTP` | `123456` | OTP stub |
| `PORT` | `4000` | API |
| `FCM_SERVER_KEY` | unset | When set, push channel + inbox; otherwise inbox only |
| `EXPO_PUBLIC_API_URL` | `http://127.0.0.1:4000/v1` | Mobile/web |

## Reliability formula (summary)

Weights (redistributed when operator feed / reviews absent): success 0.25, failure 0.20, power_truth 0.10, availability 0.15, operator 0.10, freshness 0.10, access_review 0.10. Confidence gate ≥25 to show score; low crowd samples (`<3`) cap score at 75. See shared `computeReliabilityScore` and project `docs/database-schema.md` §6.
