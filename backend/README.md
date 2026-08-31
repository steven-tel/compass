# Compass backend

Python FastAPI service: Gemini Live tutoring, Firestore sessions, exercise detection.

The image contains **application code only**. Pass API keys and Google credentials at runtime.

## Local

From the **repo root**:

```bash
uv pip install -r backend/requirements.txt
uv run python backend/main.py
```

Or `cd backend && uv run python main.py`. Listens on `http://0.0.0.0:8000` (or `$PORT`).

Env file: `backend/.env` (see `backend/.env.example`). Do not commit it.

## Build

```bash
docker build -t compass-backend ./backend
```

## Run

```bash
docker run --rm -p 8000:8000 --env-file backend/.env -e PORT=8000 compass-backend
```

Firestore uses Application Default Credentials. To mount a key file instead of baking it in:

```bash
docker run --rm -p 8000:8000 --env-file backend/.env \
  -e PORT=8000 \
  -e GOOGLE_APPLICATION_CREDENTIALS=/secrets/gcp.json \
  -v "$GOOGLE_APPLICATION_CREDENTIALS:/secrets/gcp.json:ro" \
  compass-backend
```

## Environment

| Name | Secret? | Required | Notes |
| --- | --- | --- | --- |
| `GEMINI_API_KEY` | yes | yes | Runtime only |
| `PORT` | no | no | Cloud Run sets this. Image default `8080` |
| `MODEL` | no | no | Live model id |
| `EXERCISE_DETECTOR_MODEL` | no | no | Post-session analysis |
| `FIRESTORE_PROJECT` | no | yes | GCP project id. Set in `backend/.env`, not in code |
| `FIRESTORE_DATABASE` | no | no | Default `compas-database` |
| `GOOGLE_APPLICATION_CREDENTIALS` | path | no | Only if you mount a key |
| `TWILIO_ACCOUNT_SID` | yes | no | Phone integration |
| `TWILIO_AUTH_TOKEN` | yes | no | Phone integration |
| `TWILIO_APP_HOST` | no | no | Public host Twilio calls back |

## Cloud Run

```bash
gcloud run deploy compass-backend \
  --source ./backend \
  --region us-central1 \
  --set-secrets GEMINI_API_KEY=GEMINI_API_KEY:latest \
  --set-env-vars FIRESTORE_PROJECT=YOUR_PROJECT,FIRESTORE_DATABASE=compas-database \
  --allow-unauthenticated \
  --timeout 3600
```

Give the Cloud Run service account Firestore access. Do not put a JSON key in the image.

API: `/api`. Live WebSocket: `/ws`.
