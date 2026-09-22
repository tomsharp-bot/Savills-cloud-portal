# Savills Cloud Portal

Role-based Mark Up / stock-condition survey progress tracker for Tom Sharp’s team.

Intended domain: **savillscloudportal.co.uk**

Excel stays an import/export feed — Postgres is the live store.

HHSRS Reporter (Carly’s scoring app) is a **separate desktop product**. This portal now hosts a multi-user **HHSRS Reporter** at `/HHSRSreporter` for office staff, fed by the public site form.

A public **HHSRS site reporting** form lives on this same app at **root paths** (not under `/projectprogress`):

- Landing: `/HHSRS-site-form`
- New issue / review / submit: `/HHSRS-site-form/new` and following steps
- Admin Reporter (signed-in admin): `/HHSRSreporter` (alias `/HHSRSreporting`)
- Admin read-only intake list: `/projectprogress/hhsrs-submissions`

Open the form in a phone browser at `https://savillscloudportal.co.uk/HHSRS-site-form` (or `http://localhost:3000/HHSRS-site-form` locally). No login for surveyors in v1. Photos store on disk under `uploads/hhsrs-site-form/{submissionId}/` until Spaces is wired. Up to **4 photos**, **each photo up to 40MB** (JPEG, PNG, WebP, HEIC/HEIF). The browser compresses JPEG/PNG/WebP before upload when it can.

## What this app does

- Cookie-session login (`admin` | `surveyor` | `client`). Client/surveyor with no Personnel project ticks stay on login (admins always enter).
- Self-service **Change password** (header link for every signed-in role). Chosen passwords are hashed only — not stored in plaintext.
- **Personnel** (surveyors, clients, admins). Admins can reset a temporary password, copy it, and see the last admin-issued temp until the user sets their own.
- Projects on **Current / Upcoming / Archive** boards (archive board shows the 5 most recent; **See Full Archive** lists all)
- Create/Edit **Project Target** as a count or percent — shown on Summary
- Survey-type ticks drive **Summary** KPI columns
- Stock tabs **Dwellings / Blocks / Garages** (Site Comments, Omit Asset, External, “X of Y Assets Displayed”)
- **Data Loader**: visit Excel/CSV, Asset Status rules, Visit Log, Auto-route D/B/G
- **Upload or refresh stocklist** (first upload loads the full list; Auto splits Dwellings / Blocks / Garages from Archetype, Survey Design, Asset Type, Survey Type or similar; later files add/remove mid-job)
- **Export stocklist** XLSX (same grid columns) and admin **Clear entire stocklist** (two-step confirm)
- **External-only list** (persist UPRN set, re-apply on admin login)
- **Documents** (local disk now; Spaces later)
- **Completions** view/download stubs
- **HHSRS site reporting** (public phone form at `/HHSRS-site-form`; admin Reporter at `/HHSRSreporter`; intake list under the portal)
- **Admin landing** at `/admin` after login (HHSRS Reporter at `/HHSRSreporter`, Project Progress, Personnel, Photos / Photo Storage, Projects Programme, Reference Documents). Existing admin tiles stay; Reference Documents is an extra tile.
- **Surveyor landing** at `/surveyor` after login, with two tiles only: Project Progress and Reference Documents. Clients still land on `/projects`.
- **Reference Documents** at `/reference-documents` for every admin and every surveyor (not clients). Six categories in three columns. Admins drag-and-drop or browse to upload, and can delete. Surveyors open PDF and images in the portal and can download; they do not see upload or delete. Word and Excel can be downloaded. Files go to DigitalOcean Spaces (`cloud-portal-vault`) when `SPACES_ENDPOINT`, `SPACES_KEY`, and `SPACES_SECRET` are set; otherwise they are stored on the server under `uploads/reference-documents/` (that disk does not survive an App Platform redeploy).
- **Photo Storage** (admin) at `/photos` — project tiles, Photos Pool, Photo Folders, Create Photos Extract, Client Access → Completions. Demo / coloured placeholder thumbs until DigitalOcean Spaces (`cloud-portal-vault`, LON1) credentials are set.
- **Projects Programme** (admin) at `/projects-programme` — surveyor × week board. With `BASE_PATH=/projectprogress` the live URL is `https://savillscloudportal.co.uk/projectprogress/projects-programme` (hub: `https://savillscloudportal.co.uk/projectprogress/admin`). Bottom tables read Project Progress: current, upcoming, and the 5 most recently archived. Survey-type text starts from each project's survey-type ticks and is stored on edit. The grid itself is one shared board in Postgres.

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

Open http://localhost:3000 (portal) and http://localhost:3000/HHSRS-site-form (site reporting form).

Leave `BASE_PATH` empty (or `/`) locally so portal routes stay at `/login`, `/projects`, etc. To preview the production prefix: `BASE_PATH=/projectprogress npm run dev` — portal at http://localhost:3000/projectprogress, HHSRS form still at http://localhost:3000/HHSRS-site-form.

If Postgres is already on port 5432, create a database and point `DATABASE_URL` at it.

### Demo logins (seeded)

| Role     | Username   | Password           |
|----------|------------|--------------------|
| Admin    | `phil.m`   | `PhilMoon2468`     |
| Surveyor | `peter.m`  | `PeterMay2468`     |
| Surveyor | `alex.s`   | `AlexSurveyor2468` |
| Client   | `client.j` | `ClientJones2468`  |

Do **not** weaken these in production seed. After go-live, users change their own password via **Change password** in the header. Admins can issue a new random temporary password from **Personnel**.

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
5. Health check path: **`/health`** (JSON `{"ok":true,...}` — HTTP 200 when the process is up). This stays at the **container root** even when `BASE_PATH` is set. `${BASE_PATH}/health` also works.

### 3. Environment variables Tom must set

Set these in **App Settings → App-Level / web component Environment Variables**. Mark secrets as encrypted.

| Variable | Required | Example / notes |
|----------|----------|-----------------|
| `DATABASE_URL` | **Yes** | Real `postgresql://` / `postgres://` URI from **Managed Database → Connection Details**. Do **not** paste a literal `${db.DATABASE_URL}` placeholder. If the value is a placeholder or missing a scheme, the app will try `DB_HOST`/`PGHOST`, `DB_PORT`/`PGPORT`, `DB_USER`/`PGUSER`, `DB_PASSWORD`/`PGPASSWORD`, `DB_NAME`/`PGDATABASE` (sslmode=require) and otherwise exit 1 before Prisma connects. |
| `SESSION_SECRET` | **Yes** | Long random string (not the local example). |
| `NODE_ENV` | **Yes** | `production` |
| `BASE_PATH` | **Yes (production)** | `/projectprogress` — serves the portal at `https://savillscloudportal.co.uk/projectprogress` (and `/projectprogress/login`, etc.). Local default is empty / `/`. Alias: `APP_BASE_PATH`. |
| `PORT` | No | App Platform sets this. Default in code is `3000`. |
| `SPACES_BUCKET` | No | `cloud-portal-vault` |
| `SPACES_REGION` | No | `lon1` |
| `SPACES_ENDPOINT` | No | Spaces endpoint, e.g. `https://lon1.digitaloceanspaces.com`. Required together with key and secret before Reference Documents (and later Photo Storage) use the bucket instead of local disk. |
| `SPACES_KEY` | No | Spaces access key — **leave empty until needed**. Do not commit it. |
| `SPACES_SECRET` | No | Spaces secret — **leave empty until needed**. Do not commit it. |

Never commit real keys. The spec file only declares the names.

### 4. First deploy

1. Deploy. Run command heals `DATABASE_URL` if needed, then applies **`prisma migrate deploy`** (schema only — **does not seed**).
2. Seed **once**, not on every deploy. After the first successful deploy, open the app’s **console** (or a one-off job) and run:
   ```bash
   npm run seed
   ```
   That creates demo users/projects. **Do not** add `npm run seed` to the Run command.
3. Expected URL: `https://savills-cloud-portal-<hash>.ondigitalocean.app/projectprogress` once `BASE_PATH=/projectprogress` is set (App Platform shows the exact host). Root `/` on the app redirects to `/projectprogress`. Later point **savillscloudportal.co.uk** at this app and enable HTTPS — users open `https://savillscloudportal.co.uk/projectprogress`.

### Setting `BASE_PATH` on DigitalOcean App Platform

Tom’s assistant should set this on the **web** component (or app-level env):

1. App Platform → the **savills-cloud-portal** app → **Settings** → **App-Level Environment Variables** (or the **web** component’s Environment Variables).
2. **Add variable**
   - **Name:** `BASE_PATH`
   - **Value:** `/projectprogress`
   - **Scope:** Run time (not a secret).
3. Save and let the app redeploy (or trigger **Deploy**).
4. Confirm:
   - `https://<app-host>/health` → JSON `{"ok":true,...}` (DigitalOcean health check — keep this path).
   - `https://<app-host>/projectprogress` → login or projects.
   - `https://<app-host>/HHSRS-site-form` → Savills HHSRS Site Reporting (public; not under `/projectprogress`).
   - `https://<app-host>/` → short “Savills Cloud Portal” link / redirect to `/projectprogress`.

`.do/app.yaml` already declares `BASE_PATH=/projectprogress`. If the live app was created before that line existed, add the variable in the UI — importing the spec later will also set it.

### 5. After go-live

- Spaces bucket **`cloud-portal-vault`** (LON1) for Photo Storage / External XLOOKUP — Photo Storage UI is live with demo placeholders until `SPACES_*` env vars are set.
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
