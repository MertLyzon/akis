# Northflank/API deployment image.
# The build context is the repository root so the same image can be used by
# Docker Compose (backend/Dockerfile) and platforms that expect /Dockerfile.
FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

COPY backend /app/backend
ENV PYTHONPATH=/app/backend \
    MEDIA_ROOT=/app/data/media

RUN useradd --uid 10001 --create-home akis \
    && mkdir -p /app/data/media /app/backups \
    && chown -R akis:akis /app
USER akis

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health')"

# Apply committed schema changes before accepting traffic. Northflank runs this
# image without the separate Compose `migrate` service used for local installs.
CMD ["sh", "-c", "alembic -c backend/alembic.ini upgrade head && exec uvicorn akis.main:app --host 0.0.0.0 --port 8000 --no-access-log"]
