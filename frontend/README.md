# Compass frontend

Next.js UI. Proxies `/api` and `/ws` to the backend via `BACKEND_URL`.

This image has **no Gemini key and no Google credentials**. Those belong on the backend.

## Local

```bash
cd frontend
npm install
npm run dev -- --hostname 0.0.0.0 --experimental-https
```

Open https://localhost:3000. `--experimental-https` is needed for camera/mic on a phone.

Do not commit `certificates/` (created by Next.js).

## Build

```bash
docker build -t compass-frontend \
  --build-arg BACKEND_URL=http://backend:8000 \
  ./frontend
```

`BACKEND_URL` is applied at **build** time (rewrites). Rebuild if the API URL changes.

Direct browser WebSocket to the API (typical on Cloud Run):

```bash
docker build -t compass-frontend \
  --build-arg BACKEND_URL=https://YOUR_BACKEND.run.app \
  --build-arg NEXT_PUBLIC_WS_URL=wss://YOUR_BACKEND.run.app/ws \
  ./frontend
```

```bash
docker run --rm -p 3000:3000 compass-frontend
```

## Environment

| Name | When | Secret? | Notes |
| --- | --- | --- | --- |
| `BACKEND_URL` | build | no | Backend origin |
| `NEXT_PUBLIC_WS_URL` | build | no | Optional. Default: `wss://<this-host>/ws` |
| `PORT` | run | no | Cloud Run sets this. Image default `3000` |

Never set `GEMINI_API_KEY` here.

## Cloud Run

Deploy the backend first, then:

```bash
gcloud run deploy compass-frontend \
  --source ./frontend \
  --region us-central1 \
  --set-build-env-vars BACKEND_URL=https://YOUR_BACKEND.run.app,NEXT_PUBLIC_WS_URL=wss://YOUR_BACKEND.run.app/ws \
  --allow-unauthenticated
```
