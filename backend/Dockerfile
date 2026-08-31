# Compass API — FastAPI + Gemini Live + Firestore
# Secrets are injected at runtime. Never copy .env or key files into this image.

FROM python:3.11-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 1001 appuser

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py gemini_live.py db.py exercise_detector.py twilio_handler.py concepts.py ./
COPY models ./models
COPY data/concepts.json ./data/concepts.json
COPY static ./static

RUN chown -R appuser:appuser /app
USER appuser

ENV PORT=8080 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

EXPOSE 8080

CMD ["python", "main.py"]
