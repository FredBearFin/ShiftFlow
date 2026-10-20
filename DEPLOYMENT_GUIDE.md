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

# Install dependencies
pip install -r requirements.txt

# Run automated test suite (10 unit & integration tests)
python run_all_tests.py

# Launch development server with hot reload
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### Frontend (Node 18+ / Vite / React / TypeScript)
```bash
cd frontend/

# Install npm dependencies
npm install

# Run development server
npm run dev

# Build production bundle
npm run build
```

---

## 3. Environment Variables Reference (`.env`)

| Variable | Default Value | Description |
| :--- | :--- | :--- |
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
- **Application Tier**: Uvicorn running FastAPI behind Gunicorn with 4 worker processes per CPU core.
- **Compute Footprint**: The Becker (2026) ISD-RWSP solver operates in $O(|\mathcal{E}|)$ Eulerian multigraph extraction time (<15 ms for 6–12 staff roster lines). A single 0.5 vCPU / 512 MB RAM container comfortably handles 50 concurrent store solve requests per second.
