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
| `SHIFTFLOW_ENABLE_API_DOCS` | `false` | The interactive API docs (`/docs`, `/redoc`) and raw schema (`/openapi.json`) are off by default - set to `true` to turn them back on, e.g. for local development. |
| `SHIFTFLOW_CORS_ORIGINS` | `http://localhost:5173,http://localhost:3000` | Comma-separated origins allowed to call the API from a browser |
| `SHIFTFLOW_DB_PATH` | `data/shiftflow.db` | SQLite file. In Docker it sits on the `shiftflow-data` volume. |
| `BACKEND_PORT` | `8000` | Host port for the backend container |
| `FRONTEND_PORT` | `5173` | Host port for the frontend container (nginx on port 80 inside) |

--- | :--- | :--- |
| `ENVIRONMENT` | `production` | Runtime mode (`development`, `staging`, `production`) |
| `PORT` | `8000` | FastAPI server listening port |
| `FRONTEND_PORT` | `3000` | Nginx web server listening port |
| `CORS_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | Allowed cross-origin resource sharing origins |
| `SOLVER_TIME_LIMIT_SECONDS` | `10` | Hard timeout constraint on ISD-RWSP solver execution |
| `LOG_LEVEL` | `INFO` | Structured logging verbosity (`DEBUG`, `INFO`, `WARNING`, `ERROR`) |
| `SECRET_KEY` | `shiftflow-super-secret-key-change-in-prod` | Session and cryptographic JWT signing key |

---

## 4. Production Cloud Deployment (AWS ECS / Railway / Render)

### Architecture
- **Web Tier**: Nginx serving static pre-rendered React assets with client-side routing fallback (`try_files $uri /index.html;`) and caching headers (`Cache-Control "public, max-age=31536000, immutable"`).
- **Application Tier**: Uvicorn serves FastAPI as a single process in the provided image.
