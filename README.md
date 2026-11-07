# EVSaathi — Phase 4 EV Ecosystem

**Brand:** EVSaathi (locked)  
**Promise:** Know your real range before you go.  
**Scope:** Community for verified owners, reputation, multi-brand garage depth, uncertainty-gated battery health, subscription entitlements (stub payments), partnership/operator registry polish, fleet + business analytics stubs. Still never invents LIVE SOC/availability/partners. AI never issues actuators.

## Phase 4 Must / Should

| ID | Feature | Status |
|----|---------|--------|
| P4-M01 | EV community (spaces, posts, photos, vehicle rooms) | Done |
| P4-M02 | Reputation (ties Phase 2 verified reports) | Done |
| P4-M03 | Multi-brand catalog depth + garage switch UX | Done |
| P4-M04 | Battery health with uncertainty gates | Done |
| P4-M05 | Community moderation tooling | Done |
| P4-S01 | Subscription entitlements (stub payments) | Done |
| P4-S02 | Partnership / operator registry polish | Done |
| P4-S03 | Fleet org stub | Done |
| P4-S04 | Business analytics stub + CSV | Done |

## What’s real vs stub

| Data | Status |
|------|--------|
| Auth OTP | Secure **stub** — demo code `123456` |
| Vehicle specs | Expanded multi-brand seed catalog |
| Community | Owner posts + moderation; crowdsource ≠ LIVE |
| Reputation | Derived from moderated reports + useful votes |
| Battery health | **Gated** — no numeric SOH without history |
| Subscriptions / fleet | Entitlements + org stub — payment provider **stub** |
| Partnerships | Prospect/demo registry — `live_claim` always false |
| LIVE OEM / operator availability / scraping / AI actuators | **Forbidden** |

## Monorepo

```
apps/api          Express + Prisma API (`/v1/*`) — SQLite by default
apps/mobile       Expo (React Native) + web — EVSaathi UI
packages/shared   Math + telemetry + AI ACL + reputation + health + Vitest
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
3. Profile → Community · Garage · Subscriptions · Fleet
4. Admin HTML: `GET /v1/admin/community` (bearer)

### Key Phase 4 APIs

- `GET /v1/community/spaces` · `POST /v1/community/posts`
- `GET /v1/me/reputation`
- `GET /v1/garage` · `POST /v1/garage/:id/activate`
- `GET /v1/vehicles/:id/battery-health`
- `GET /v1/subscriptions/plans` · `POST /v1/me/subscription/checkout`
- `GET /v1/fleet/orgs` · `GET /v1/fleet/orgs/:id/analytics`
- `GET /v1/partnerships/programs` · `GET /v1/admin/operators`

## Tests

```bash
pnpm --filter @evsaathi/shared test
pnpm --filter @evsaathi/api test
```

## Environment

| Var | Default | Notes |
|-----|---------|-------|
| `DATABASE_URL` | `file:./dev.db` | SQLite |
| `JWT_SECRET` | dev secret | Rotate in prod |
| `PORT` | `4000` | API |
| `FCM_SERVER_KEY` | unset | Optional push |

## Prior phases

Phases 1–3 remain on the stack: MVP → charging intelligence → integrations/AI. Phase 4 builds on `cursor/phase-3-integrations-ai`.
