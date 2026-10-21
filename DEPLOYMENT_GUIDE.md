# ShiftFlow Studio: Production Deployment & Operations Guide

## 1. Quick Start via Docker Compose (Recommended)

ShiftFlow Studio is fully containerized with production-ready multi-stage Docker builds for both the FastAPI backend and Vite/React frontend, reverse-proxied via Nginx.

### Prerequisites
- Docker Engine $\ge 24.0$
- Docker Compose v2 $\ge 2.20$

### 1-Step Spin-Up
```bash
# 1. Unzip the release archive
unzip shiftflow_enterprise.zip -d shiftflow-enterprise/
cd shiftflow-enterprise/

# 2. Copy the environment configuration
cp .env.example .env

# 3. Build and launch containers
docker compose up -d --build

# 4. Access the services
# Frontend App: http://localhost:3000
# Backend API & Swagger Docs: http://localhost:8000/docs
# Healthcheck: http://localhost:8000/health
```

---

## 2. Local Manual Development Setup

### Backend (Python 3.11+ / FastAPI)
```bash
cd backend/

# Create and activate virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies (add requirements-dev.txt to run the tests)
pip install -r requirements.txt -r requirements-dev.txt

# Run automated test suite
python run_all_tests.py

# Launch development server with hot reload. Login is on by default; for local work only,
# SHIFTFLOW_AUTH_DISABLED=1 skips it. Otherwise set SHIFTFLOW_SESSION_SECRET (see section 3).
SHIFTFLOW_AUTH_DISABLED=1 uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### Frontend (Node 18+ / Vite / React / TypeScript)
```bash
cd frontend/

# Install npm dependencies from the lockfile
npm ci

# Run development server
npm run dev

# Build production bundle
npm run build
```

---

## 3. Environment Variables Reference (`.env`)

Accounts and data: every signed-in user only sees their own facilities, staff, audit records and rosters. Two accounts can both use the facility id `FAC-OMAHA-01` without ever seeing each other's rows.

**Upgrading an existing database:** data saved before per-user accounts has no owner, so no account can see it. Assign it once to the account that should own it: `python -m app.claim_legacy_data EMAIL` from `backend/` (or `docker compose exec backend python -m app.claim_legacy_data EMAIL`). Running it again moves nothing.

| Variable | Default Value | Description |
| :--- | :--- | :--- |
| `SHIFTFLOW_SESSION_SECRET` | none (required) | Signs login session cookies. Random, at least 32 characters, kept private. The backend refuses to start without it, and every protected request returns 503 if it is somehow missing. |
| `SHIFTFLOW_ALLOW_SIGNUP` | `true` | Set to `false` to close public sign-up; create accounts with `python -m app.create_user EMAIL` from `backend/` (or `docker compose exec backend python -m app.create_user EMAIL`). |
| `SHIFTFLOW_COOKIE_SECURE` | `true` | The session cookie is https-only. Set to `false` only for a plain-http address you control. |
| `SHIFTFLOW_AUTH_DISABLED` | unset | Local development only: `1` runs the backend with no login and unscoped data. Never set it on a reachable server. |
| `SHIFTFLOW_CORS_ORIGINS` | `http://localhost:5173,http://localhost:3000` | Comma-separated origins allowed to call the API from a browser |
| `SHIFTFLOW_DB_PATH` | `data/shiftflow.db` | SQLite file. In Docker it sits on the `shiftflow-data` volume. Must point at a persistent disk — see section 5. |
| `SHIFTFLOW_ENV` | unset (reported as `development`) | The environment name `/health` reports. `APP_ENV` is accepted as a fallback because `docker-compose.yml` already passes it. |
| `BACKEND_PORT` | `8000` | Host port for the backend container |
| `FRONTEND_PORT` | `5173` | Host port for the frontend container (nginx on port 80 inside) |

Every variable above is read by the code. This table previously ran on into a
second, malformed table listing `ENVIRONMENT`, `PORT`, `CORS_ORIGINS`,
`SOLVER_TIME_LIMIT_SECONDS`, `LOG_LEVEL` and `SECRET_KEY` — **none of which any
code reads**. In particular there is no `SECRET_KEY` and no JWT anywhere in this
application; session cookies are signed with `SHIFTFLOW_SESSION_SECRET`, and
setting `SECRET_KEY` protects nothing. There is also no solver time limit: the
solver runs to completion. Those rows are removed rather than left to be
configured in the belief that they do something.

`SHIFTFLOW_API_KEY` and `VITE_API_KEY` were also documented here as required.
The API-key scheme has been removed in favour of per-user login and neither
variable is read any more, so both rows are gone.

---

## 4. Production Cloud Deployment (AWS ECS / Railway / Render)

### Architecture
- **Web Tier**: Nginx serving static pre-rendered React assets with client-side routing fallback (`try_files $uri /index.html;`) and caching headers (`Cache-Control "public, max-age=31536000, immutable"`).
- **Application Tier**: Uvicorn serves FastAPI as a single process in the provided image.
- **Data Tier**: one SQLite file at `SHIFTFLOW_DB_PATH`. Read section 5 before choosing where to run this.

---

## 5. Data durability — read this before deploying

### The situation

Everything ShiftFlow stores — facilities, staff records, separation audits, roster
snapshots **and user accounts** — lives in a single SQLite file at `SHIFTFLOW_DB_PATH`.
That is fine on a host with a persistent disk and no good on a host without one.

On a serverless platform the default path is `/tmp/shiftflow.db` (see
`backend/app/database.py`). On those platforms `/tmp` is **local to one function instance
and is discarded on a cold start**. Two consequences:

1. **Records are lost without warning.** A schedule saved on Monday may simply not be
   there on Tuesday. No error is raised; the row is gone.
2. **Login does not work reliably.** The session cookie is self-contained and signed, but
   `app/auth.py` re-checks on every request that the user still exists in the database.
   An account created on instance A does not exist on instance B, so that user's valid
   cookie is rejected there and they appear signed out — or their sign-up appears to have
   vanished.

The backend now logs a warning at startup when its database path is under `/tmp`, and
`GET /health/readiness` reports `checks.database.durable: false` and the path in use.
Neither of those makes the data durable; they stop the problem being silent.

### What is and is not claimed

- Separation audits and roster snapshots are **append-only**: no code path updates or
  deletes them, and `delete_employee` refuses while an audit exists. That is a real
  property of the code.
- They are **not** guaranteed to be retained for any period. ShiftFlow has no retention
  mechanism, no backups and no archival. Earlier versions of this guide, the README and
  the GTM material described "3-year FLSA retention" and "immutable" audit storage as
  product features. They are not: retention is entirely a property of the disk you point
  `SHIFTFLOW_DB_PATH` at, and whatever backups you run against it. If a statutory
  recordkeeping obligation applies to you, it is met by your backup and retention policy
  for that disk, not by this application.

### The options, and what each one costs

This is an architecture decision and it has not been made. The three real choices:

**A. PostgreSQL, keep serverless.** Replace SQLite with a managed Postgres instance and
keep deploying the backend as serverless functions.
*Cost:* the largest code change — `app/database.py` is written against `sqlite3` directly
(raw SQL, `sqlite3.Row`, `PRAGMA foreign_keys`), so the connection handling, the
`CREATE TABLE IF NOT EXISTS` bootstrap and the `PRAGMA table_info` migration step all
need rewriting, plus a connection pooler such as PgBouncer because serverless instances
open many short-lived connections. A hosting bill that was zero becomes non-zero.
*Buys:* durability and correct multi-instance login, and it is the only option that
scales past one machine.

**B. Stop deploying the backend serverless.** Run the backend on a host with a persistent
volume (Fly.io, Render, Railway, a VM, or the provided `docker-compose.yml`, which already
mounts `shiftflow-data:/app/data`) and keep SQLite. Remove the `backend` service from
`vercel.json` and point the frontend's `/api` rewrite at that host.
*Cost:* a long-running process to operate and pay for. One machine only: SQLite does not
share a file across hosts. Backups become your job.
*Buys:* durability and correct login with **no application code change at all**, because
`docker-compose.yml` is already set up this way.

**C. Keep it as it is, and stop claiming durability.** Treat the serverless deployment as
a demo, say so in the product, and do not store anything anyone needs back.
*Cost:* it is not a product anyone can run a shift on.
*Buys:* nothing beyond what is already working.

**Recommendation for whoever owns this decision:** B is the honest minimum and costs no
code. A is the right answer if ShiftFlow is meant to be multi-tenant SaaS, which the
per-user accounts and per-user data scoping in `app/deps.py` and
`ShiftFlowRepository(owner_id=...)` imply it is. C is only defensible if the deployment is
relabelled a demo.

`vercel.json` has deliberately **not** been changed here, because changing it is making
that decision. It still deploys the backend as a serverless service, with the
consequences described above.
