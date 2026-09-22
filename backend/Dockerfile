FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt
COPY backend /app/backend
ENV PYTHONPATH=/app/backend MEDIA_ROOT=/app/data/media
RUN useradd --uid 10001 --create-home akis && mkdir -p /app/data/media && chown -R akis:akis /app
USER akis
EXPOSE 8000
CMD ["uvicorn", "akis.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
