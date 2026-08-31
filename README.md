
<p align="center">
  <img src="assets/logo.png" alt="Project Logo" width="240"/>
</p>

A screenless AI tutor that helps students learn, stay focused, and build confidence.

## Quick start





**Backend**:

Copy `backend/.env.example` to `backend/.env`.

Required: `GEMINI_API_KEY` and `FIRESTORE_PROJECT` (your GCP project id).

```bash
cp backend/.env.example backend/.env   # add GEMINI_API_KEY and FIRESTORE_PROJECT
```

```bash
cd backend
uv pip install -r requirements.txt
uv run python main.py
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



