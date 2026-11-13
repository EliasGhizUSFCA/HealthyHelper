# syntax=docker/dockerfile:1.7
# AI Health Mirror backend — CPU image by default.
# CUDA: docker build --build-arg TORCH_INDEX=https://download.pytorch.org/whl/cu124 ...
FROM python:3.13-slim AS base
ARG TORCH_INDEX=https://download.pytorch.org/whl/cpu
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 MLFLOW_DISABLE_AGENT_HINT=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
 && apt-get clean && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
COPY backend/requirements.txt backend/requirements-dev.txt backend/
RUN pip install torch==2.15.0 torchvision==0.29.2 --index-url ${TORCH_INDEX} \
 && pip install -r backend/requirements.txt

# Optional stage: train the synthetic DEMO models into the image (--build-arg DEMO_MODELS=1).
FROM base AS models
ARG DEMO_MODELS=0
COPY backend backend
COPY shared shared
COPY scripts scripts
RUN mkdir -p models && if [ "$DEMO_MODELS" = "1" ]; then \
      pip install -r backend/requirements-dev.txt && EPOCHS=4 SUBJECTS=100 scripts/train_demo_models.sh; fi

FROM base AS runtime
RUN useradd --create-home --uid 10001 app
COPY backend backend
COPY shared shared
COPY --from=models /srv/models models
ENV MODELS_DIR=/srv/models REGIONS_FILE=/srv/shared/regions.json DATA_DIR=/data PORT=8000
RUN mkdir -p /data && chown app:app /data
USER app
WORKDIR /srv/backend
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request,os;urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('PORT','8000')+'/api/health')"
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --ws-max-size 2097152"]
