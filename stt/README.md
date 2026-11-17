# GoodEnglish STT

Self-hosted speech-to-text for the **Main peran** mic: [faster-whisper]
behind a small FastAPI app. No paid API, audio is never stored, and the
transcript is **verbatim**: the learner's grammar mistakes are kept, because
the roleplay summary corrects them later.

```
Browser (MediaRecorder: webm/opus, Safari mp4/aac)
  → POST /api/v1/roleplay/sessions/:id/transcribe   (NestJS: login, permission,
     multipart: audio + language=en|id                session, rate limit, 5 MB)
  → POST http://stt:8000/api/transcribe              (this service, internal only)
  ← {"text": "I go to event yesterday", "language": "en", "duration_sec": 1.52}
```

## Run

Production (the VPS) runs it from `docker-compose.yml` as the `stt` service:
no public port, only `app` reaches it at `http://stt:8000`. On the first
start the model is downloaded into the `stt_models` volume (~0.5 GB for
`small`) and loaded once; later starts take a few seconds.

```bash
docker compose up -d stt
docker compose logs -f stt        # "model ready in …s"
```

Local development (`pnpm start:dev` on the host): `docker-compose.override.yml`
builds it from `stt/` and publishes it on `127.0.0.1:8100`; put
`STT_URL=http://127.0.0.1:8100` in the backend `.env`.

```bash
docker compose up -d --build stt
curl -F audio=@samples/synthetic/en_grammar_1.webm -F language=en \
  http://127.0.0.1:8100/api/transcribe
```

## Deploying to the VPS (first time)

The VPS has no git checkout, only the copied `docker-compose.yml`:

1. Copy the new `docker-compose.yml` to `~/goodenglish/goodenglish-be/`
   (it adds the `stt` service, the `stt_models` volume and `STT_URL` for `app`).
2. Optionally add the `STT_*` lines from `.env.example` to the VPS `.env`
   (the defaults already suit 2 vCPU / 4 GB).
3. nginx: allow uploads up to the 5 MB limit on the API location, e.g.
   `client_max_body_size 6m;` inside `location /api/v1 { … }`, then
   `sudo nginx -t && sudo systemctl reload nginx`. nginx's default is 1 MB,
   and a 60 s Safari recording can come close to that.
4. Push to `development`/`main`: CI builds `ghcr.io/<owner>/goodenglish-stt`
   and the deploy job runs `docker compose pull && up -d`. The first start
   downloads the model (a minute or two); until then the mic answers
   `stt_busy` / `stt_unavailable` and typing still works.
5. For the benchmark, copy the clips over once:
   `scp -r stt/samples <vps>:~/goodenglish/goodenglish-be/stt/`.

## API

`POST /api/transcribe` (multipart/form-data)

| Field | | |
|---|---|---|
| `audio` | file | webm, ogg, mp4/m4a, wav, mp3 … (anything ffmpeg reads), ≤ 5 MB, ≤ 60 s |
| `language` | `en` \| `id` | default `en`. Never auto-detected (short answers are often detected wrong) |

200 `{"text", "language", "duration_sec"}`. Errors are
`{"detail": {"code", "message"}}`, with Indonesian messages for people:

| Status | code | When |
|---|---|---|
| 422 | `no_speech` | silence, noise, or only a known Whisper hallucination → "Suaramu tidak terdengar, coba lagi ya." |
| 422 | `too_long` | longer than 60 s |
| 413 | `too_large` | bigger than 5 MB |
| 415 | `bad_audio` | not a readable audio file |
| 422 | `bad_language` | not `en` / `id` |
| 503 | `busy` / `not_ready` | queue full / model still loading |

`GET /health` → `{"ok": true, "model": "small"}`.

## Settings (env)

| Env | Default | |
|---|---|---|
| `STT_MODEL` | `small` | `tiny`, `base`, `small`, `medium`, `large-v3`, `large-v3-turbo`, … |
| `STT_DEVICE` | `cpu` | `cuda` for an NVIDIA GPU |
| `STT_COMPUTE_TYPE` | `int8` | `float16` on GPU |
| `STT_CPU_THREADS` | `2` | = vCPUs |
| `STT_BEAM_SIZE` | `5` | 1 is faster, slightly less accurate |
| `STT_CONCURRENCY` | `1` | transcriptions at the same time |
| `STT_QUEUE_MAX` | `4` | requests allowed to wait; beyond that → 503 `busy` |
| `STT_NO_SPEECH_MAX` | `0.6` | drop a segment when `no_speech_prob` > this … |
| `STT_LOGPROB_MIN` | `-1.0` | … and `avg_logprob` < this (Whisper's own rule) |
| `STT_MAX_BYTES` / `STT_MAX_SEC` | `5000000` / `60` | upload limits |
| `LOG_LEVEL` | `INFO` | |

Backend side (`goodenglish-be/.env`): `STT_URL` (default in Compose
`http://stt:8000`), `STT_RATE_PER_MIN` (recordings per token per minute,
default 12), `STT_TIMEOUT_MS` (default 45000).

### Changing the model

1. Set `STT_MODEL` (and, if needed, `STT_COMPUTE_TYPE`) in the VPS `.env`.
2. `docker compose up -d stt`: the new model is downloaded into the volume on
   start. Watch `docker compose logs -f stt` for "model ready".
3. Raise the `stt` memory limit in `docker-compose.yml` if you go bigger:
   `small` int8 uses ~0.6 GB, `medium` int8 ~1.5–2 GB.
4. Run the benchmark (below) on the server before keeping it.

GPU host (NVIDIA + CUDA): install nvidia-container-toolkit, base the image on
`nvidia/cuda:12.x-cudnn-runtime-ubuntu24.04` (+ Python), set
`STT_MODEL=large-v3-turbo`, `STT_DEVICE=cuda`, `STT_COMPUTE_TYPE=float16`,
and give the service `deploy.resources.reservations.devices` with
`capabilities: [gpu]`. Not needed for the current 2 vCPU / 4 GB VPS.

## Verbatim and anti-hallucination

Transcription uses the forced `language`, `temperature=0`,
`condition_on_previous_text=False`, `beam_size=5`, `vad_filter=True`, and an
`initial_prompt` full of ungrammatical speech (`core.INITIAL_PROMPTS`) so
Whisper keeps mistakes instead of tidying them up. Then:

- segments Whisper considers silence (high `no_speech_prob` and low
  `avg_logprob`) are dropped;
- a result that is only a typical Whisper hallucination ("Thank you for
  watching", "Subtitles by …", "Terima kasih telah menonton", …) or an echo of
  most of the prompt becomes empty → 422. Short real answers like "Thank you."
  are deliberately not filtered.

## Privacy

The upload is written to a temp file only because the decoder needs a
seekable file, and deleted in `finally`, success or not. Logs contain only
the language, durations, sizes and the transcript **length**, never its text.

## Tests and benchmark

```bash
# unit tests (model mocked)
docker build -t goodenglish-stt:dev stt
docker run --rm -v "$PWD/stt":/src -w /src --entrypoint sh goodenglish-stt:dev \
  -c "pip install -q --user pytest httpx && python -m pytest -q tests"

# benchmark + accuracy on the test clips (on the VPS: from ~/goodenglish/goodenglish-be)
docker compose run --rm -v "$PWD/stt/samples:/app/samples:ro" stt \
  python bench.py small            # or: small medium
docker compose run --rm -v "$PWD/stt/samples:/app/samples:ro" stt \
  python bench.py small --dir samples/real
```

- `samples/synthetic/`: 15 machine-voice clips (macOS `say`) + silence +
  noise, rebuilt with `samples/make_synthetic.sh`. Not Indonesian accents.
- `samples/real/`: record these yourself, see `samples/SCRIPT.md`.

`bench.py` prints per clip: OK/XX, audio length, latency and the text, then
p50/p95 and a fit `latency ≈ fixed + per_sec × audio`, with the estimate for
a 10-second answer. A clip is OK when every `must_keep` phrase (e.g. the
grammar mistake) is in the text; silence/noise must come back empty.

[faster-whisper]: https://github.com/SYSTRAN/faster-whisper
