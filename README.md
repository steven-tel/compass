# Compass

Mobile AI math tutor. The repo is two apps:

```
backend/     FastAPI + Gemini Live + Firestore
frontend/    Next.js UI
```

Secrets stay in `.env` (not committed) and are never copied into Docker images.

## Quick start

```bash
cp .env.example .env   # add GEMINI_API_KEY and FIRESTORE_PROJECT
```

**Backend** (from the repo root):

```bash
uv pip install -r backend/requirements.txt
uv run python backend/main.py
```

**Frontend:**

```bash
cd frontend
npm install
npm run dev -- --hostname 0.0.0.0 --experimental-https
```

- UI: https://localhost:3000
- API: http://localhost:8000

## Docker

```bash
docker compose up --build
```

Images and env vars: [backend/README.md](backend/README.md) and [frontend/README.md](frontend/README.md).

## Configuration

Copy `.env.example` to `.env` in the **repo root**. Compose and the backend both read it.

Required in `.env`: `GEMINI_API_KEY` and `FIRESTORE_PROJECT` (your GCP project id). The project id is not stored in code.

Never commit `.env`, Google key JSON, or `frontend/certificates/`.
