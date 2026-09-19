# Savills Cloud Portal

Role-based Mark Up / stock-condition survey progress tracker for Tom Sharp’s team.

Intended domain: **savillscloudportal.co.uk**

Excel stays an import/export feed — Postgres is the live store.

HHSRS Reporter is a **separate product**. Do not merge it here.

## What this app does

- Cookie-session login (`admin` | `surveyor` | `client`). Client/surveyor with no Personnel project ticks stay on login (admins always enter).
- Projects on **Current / Upcoming / Archive** boards (archive board shows the 5 most recent; **See Full Archive** lists all)
- Create/Edit **Project Target** as a count or percent — shown on Summary
- Survey-type ticks drive **Summary** KPI columns
- **Personnel** (surveyors, clients, admins)
- Stock tabs **Dwellings / Blocks / Garages** (Site Comments, Omit Asset, External, “X of Y Assets Displayed”)
- **Data Loader**: visit Excel/CSV, Asset Status rules, Visit Log, Auto-route D/B/G
- **Upload or refresh stocklist** (first upload on an empty project loads the full list; later files add/remove mid-job)
- **Export stocklist** XLSX (same grid columns) and admin **Clear entire stocklist** (two-step confirm)
- **External-only list** (persist UPRN set, re-apply on admin login)
- **Documents** (local disk now; Spaces later)
- **Completions** view/download stubs

## Local setup

```bash
cp .env.example .env
# For local work you can set NODE_ENV=development in .env
npm install
docker compose up -d
npm run prisma:migrate
npm run seed
npm run dev
```

Open http://localhost:3000

If Postgres is already on port 5432, create a database and point `DATABASE_URL` at it.

### Demo logins (seeded)

| Role     | Username   | Password           |
|----------|------------|--------------------|
| Admin    | `phil.m`   | `PhilMoon2468`     |
| Surveyor | `peter.m`  | `PeterMay2468`     |
| Surveyor | `alex.s`   | `AlexSurveyor2468` |
| Client   | `client.j` | `ClientJones2468`  |

Do **not** weaken these in production seed. Change them only via Personnel after go-live if needed.

### Tests

```bash
npm test
npm run build
```

---

## Deploy on DigitalOcean

App Platform spec lives at **`.do/app.yaml`**. Region: **London (`lon`)**. Do not put real secrets in git.

### 1. Managed Postgres (London)

1. In DigitalOcean → **Databases**, use the existing London Postgres (`hhsrs-db` or a dedicated portal DB — confirm in the panel).
2. Create a database (e.g. `savills_cloud_portal`) if you are not sharing the HHSRS schema.
3. Copy the connection string. You will paste it as `DATABASE_URL`.
4. Trusted sources: allow the App Platform app (or temporarily “allow all” until the app exists, then lock down).

### 2. Create the App from GitHub

1. **Apps** → **Create App** → GitHub → `tomsharp-bot/Savills-cloud-portal`, branch **`main`**, London.
2. Or import `.do/app.yaml` if the panel offers a spec file.
3. Confirm commands:
   - **Build:** `npm ci && npx prisma generate && npm run build`
   - **Run:** `node scripts/ensure-database-url.js npx prisma migrate deploy && npm start`
     (`npm start` also runs the same healer before the Node process.)
     If App Platform still has the old run command, change it in the UI to the line above.
4. HTTP port **3000** (the app also honours `PORT` from App Platform and binds `0.0.0.0`).
5. Health check path: **`/health`** (JSON `{"ok":true,...}` — HTTP 200 when the process is up).

### 3. Environment variables Tom must set

Set these in **App Settings → App-Level / web component Environment Variables**. Mark secrets as encrypted.

| Variable | Required | Example / notes |
|----------|----------|-----------------|
| `DATABASE_URL` | **Yes** | Real `postgresql://` / `postgres://` URI from **Managed Database → Connection Details**. Do **not** paste a literal `${db.DATABASE_URL}` placeholder. If the value is a placeholder or missing a scheme, the app will try `DB_HOST`/`PGHOST`, `DB_PORT`/`PGPORT`, `DB_USER`/`PGUSER`, `DB_PASSWORD`/`PGPASSWORD`, `DB_NAME`/`PGDATABASE` (sslmode=require) and otherwise exit 1 before Prisma connects. |
| `SESSION_SECRET` | **Yes** | Long random string (not the local example). |
| `NODE_ENV` | **Yes** | `production` |
| `PORT` | No | App Platform sets this. Default in code is `3000`. |
| `SPACES_BUCKET` | No | `cloud-portal-vault` |
| `SPACES_REGION` | No | `lon1` |
| `SPACES_ENDPOINT` | No | Spaces endpoint host, when you wire files |
| `SPACES_KEY` | No | Spaces access key — **leave empty until needed** |
| `SPACES_SECRET` | No | Spaces secret — **leave empty until needed** |

Never commit real keys. The spec file only declares the names.

### 4. First deploy

1. Deploy. Run command heals `DATABASE_URL` if needed, then applies **`prisma migrate deploy`** (schema only — **does not seed**).
2. Seed **once**, not on every deploy. After the first successful deploy, open the app’s **console** (or a one-off job) and run:
   ```bash
   npm run seed
   ```
   That creates demo users/projects. **Do not** add `npm run seed` to the Run command.
3. Expected URL: `https://savills-cloud-portal-<hash>.ondigitalocean.app` (App Platform shows the exact host). Later point **savillscloudportal.co.uk** at this app and enable HTTPS.

### 5. After go-live

- Spaces bucket **`cloud-portal-vault`** (LON1) for photos / External XLOOKUP file — not wired yet (local `uploads/projects/{id}/` + DB UPRN set).
- Domain DNS / HTTPS still a Tom + DO console step.

---

## Stack

- Node.js 20+, Express, TypeScript, EJS
- Prisma + PostgreSQL
- Docker Compose for local Postgres

```
src/            Express app, Asset Status / loader / refresh (dbUrl.ts heals DATABASE_URL)
scripts/        ensure-database-url.js — run before Prisma migrate / start
views/          Server-rendered pages (mock CSS)
public/         CSS + UI JS
prisma/         Schema, migrations, seed
.do/app.yaml    App Platform spec
uploads/        Local documents (gitignored contents)
```

## Product vocabulary

- Key: **UPRN**
- **Asset Status** from visit **Access Type**: No Visit (default) → No Access / Appt Made Not Kept / Access Refused / Void / Full Survey (plus Ext-Only from the External list)
- Survey-type ticks: Condition Only, Condition + EPC, Blocks, Garages, Commercial Units, Other, Validations
