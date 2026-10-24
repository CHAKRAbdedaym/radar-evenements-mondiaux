FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN useradd --system --uid 10001 --create-home radar
WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY radar_ingest ./radar_ingest
COPY config ./config
COPY themes_mapping.yaml ./themes_mapping.yaml
COPY tests ./tests

USER radar
CMD ["python", "-m", "radar_ingest.streamer"]
