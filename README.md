# Savills Cloud Portal

Role-based Mark Up / stock-condition survey progress tracker for Tom Sharp’s team.

Intended domain: **savillscloudportal.co.uk**

This repo is the first **live multi-user slice** of the agreed HTML mock. Excel stays an import/export feed — Postgres is the live store.

HHSRS Reporter is a **separate product**. Do not merge it here.

## What this slice does

- Cookie-session login (`admin` | `surveyor` | `client`)
- Projects on **Current / Upcoming / Archive** boards (create / copy / edit / delete for admins)
- Survey-type ticks drive which **Summary** KPI columns show
- **Personnel** (surveyors, clients, admins) with project ticks and freeze
- Stock tabs **Dwellings / Blocks / Garages** with recipe column order, Site Comments, Omit Asset, External, “X of Y Assets Displayed”
- **Completions** list with view/download stubs (clients land here)
- **Data Loader**: Excel/CSV parse (Asset Visits or Data sheet), Asset Status rules, cumulative Visit Log, Auto-route to D/B/G

## Stack

- Node.js 20+, Express, TypeScript, EJS (mock CSS)
- Prisma + PostgreSQL
- `xlsx` (SheetJS) for visit uploads
- Docker Compose for local Postgres

```
src/            Express app, routes, Asset Status / loader logic
views/          Server-rendered pages matching the mock
public/         CSS + small UI JS
prisma/         Schema, migration, seed
```

## Local setup

```bash
cp .env.example .env
npm install
docker compose up -d
npx prisma migrate deploy
npm run seed
npm run dev
```

Open http://localhost:3000

If you already have Postgres on port 5432 (no Docker), create a database and set `DATABASE_URL` to match `.env.example`.

### Demo logins

| Role     | Username  | Password           |
|----------|-----------|--------------------|
| Admin    | `phil.m`  | `PhilMoon2468`     |
| Surveyor | `peter.m` | `PeterMay2468`     |
| Surveyor | `alex.s`  | `AlexSurveyor2468` |
| Client   | `client.j`| `ClientJones2468`  |

Role rules (locked):

- **Admin** — all boards including Upcoming, Personnel, Data Loader, Omit Asset
- **Surveyor** — Current + Archive if ticked; **not** Upcoming; Site Comments editable only
- **Client** — ticked projects only; Completions view/download; no Personnel, no Upcoming, no loader

## Tests

```bash
npm test
```

Covers Asset Status mapping from Access Type and Auto-route (Garage → Garages, Block → Blocks, else Dwellings).

## DigitalOcean (next — not in this slice)

Tom already has a London account (Managed Postgres + Spaces vault). When you are ready:

1. **App Platform** — create an app from this GitHub repo, Node buildpack, London.
   - Build: `npm ci && npx prisma generate && npm run build`
   - Run: `npx prisma migrate deploy && npm start`
2. **Env vars** (never commit real values):
   - `DATABASE_URL` — Managed Postgres connection string (`hhsrs-db` or a dedicated portal DB — confirm in the DO panel)
   - `SESSION_SECRET` — long random string
   - `NODE_ENV=production`
   - Spaces placeholders: `SPACES_BUCKET=cloud-portal-vault`, `SPACES_REGION=lon1`, plus `SPACES_ENDPOINT` / `SPACES_KEY` / `SPACES_SECRET`
3. **Spaces** — private bucket **`cloud-portal-vault`** (LON1). Office → Archive folder layout. Do **not** use retired `hhsrs-photos`.
4. **Domain** — point `savillscloudportal.co.uk` at the App Platform app and enable HTTPS. Out of scope here.

## Explicit TODOs (out of this slice)

- Full DigitalOcean deploy (steps above only)
- Spaces photo store beyond env placeholders
- External-only XLOOKUP file on Spaces (stock `external` column + UI note exist)
- Mid-job stocklist refresh (stub `POST /projects/:id/stock-refresh`)
- Domain DNS / HTTPS
- HHSRS Reporter (keep separate)
- Excel polish: two-row headers, huge workbooks, quarantine-only edge cases

## Product vocabulary

- Key: **UPRN**
- **Asset Status** from visit **Access Type**: No Visit (default) → No Access / Appt Made Not Kept / Access Refused / Void / Full Survey
- Survey-type ticks: Condition Only, Condition + EPC, Blocks, Garages, Commercial Units, Other, Validations
