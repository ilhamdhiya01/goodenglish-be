# GoodEnglish STT: faster-whisper behind a small FastAPI app (CPU build).
# The model is downloaded on first start into the /models volume and loaded
# once per container start. For a GPU host see README.md.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/models \
    STT_MODELS_DIR=/models

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

RUN useradd --uid 1001 --create-home --shell /usr/sbin/nologin stt && \
    mkdir -p /models && chown stt:stt /models

COPY core.py app.py bench.py ./

USER stt
EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=180s --retries=5 \
  CMD python -c "import urllib.request,json,sys; sys.exit(0 if json.load(urllib.request.urlopen('http://127.0.0.1:8000/health'))['ok'] else 1)"

# One worker: the model is in memory once; concurrency is handled inside.
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
