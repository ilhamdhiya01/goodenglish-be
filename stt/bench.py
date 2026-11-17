"""Benchmark & accuracy check over the test clips in samples/.

    python bench.py                    # model from STT_MODEL (default small)
    python bench.py small medium       # compare models
    python bench.py --dir samples/real # the learner's own recordings

samples/<dir>/expected.json lists each clip:
    {"file": "en_grammar_1.m4a", "language": "en", "kind": "grammar",
     "expected": "I go to event yesterday", "must_keep": ["I go to event"]}
kind "silence"/"noise" must come back empty (422 in the API).
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time
from dataclasses import replace

from core import SAMPLE_RATE, Settings, Transcriber


def words(s: str) -> str:
    import re

    return re.sub(r"[^a-z0-9 ]+", "", s.lower().replace("'", "")).strip()


def run(model: str, clips: list, folder: str) -> dict:
    s = replace(Settings.from_env(), model=model)
    t0 = time.perf_counter()
    tr = Transcriber(s)
    load = time.perf_counter() - t0
    # Warm-up: the first call pays one-off costs that a running server doesn't.
    tr.transcribe(tr.decode(os.path.join(folder, clips[0]["file"])), clips[0]["language"])

    rows = []
    for c in clips:
        path = os.path.join(folder, c["file"])
        start = time.perf_counter()
        audio = tr.decode(path)
        text = tr.transcribe(audio, c["language"])
        took = time.perf_counter() - start
        dur = len(audio) / SAMPLE_RATE
        empty_wanted = c.get("kind") in ("silence", "noise")
        if empty_wanted:
            ok = text == ""
        else:
            keep = c.get("must_keep") or []
            ok = bool(text) and all(words(k) in words(text) for k in keep)
        rows.append({**c, "text": text, "audio_sec": round(dur, 2), "latency_sec": round(took, 2), "ok": ok})

    speech = [r for r in rows if r.get("kind") not in ("silence", "noise")]
    lat = sorted(r["latency_sec"] for r in rows)
    rtf = [r["latency_sec"] / r["audio_sec"] for r in speech if r["audio_sec"] > 0]
    # latency ≈ fixed + per_sec × audio: short clips are mostly the fixed
    # part, so a plain average of ratios overstates long answers.
    xs = [r["audio_sec"] for r in speech]
    ys = [r["latency_sec"] for r in speech]
    if len(xs) >= 2 and len(set(xs)) > 1:
        mx, my = statistics.mean(xs), statistics.mean(ys)
        per_sec = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sum((x - mx) ** 2 for x in xs)
        fixed = my - per_sec * mx
        est10 = round(fixed + per_sec * 10, 1)
    else:
        fixed = per_sec = est10 = None
    return {
        "model": model,
        "device": s.device,
        "compute_type": s.compute_type,
        "cpu_threads": s.cpu_threads,
        "load_sec": round(load, 1),
        "p50_sec": round(statistics.median(lat), 2),
        "p95_sec": round(lat[min(len(lat) - 1, int(len(lat) * 0.95))], 2),
        # Real-time factor: seconds of work per second of audio.
        "rtf": round(statistics.mean(rtf), 2) if rtf else None,
        "fixed_sec": round(fixed, 2) if fixed is not None else None,
        "per_audio_sec": round(per_sec, 3) if per_sec is not None else None,
        "est_10s_answer_sec": est10,
        "passed": sum(r["ok"] for r in rows),
        "total": len(rows),
        "rows": rows,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("models", nargs="*")
    ap.add_argument("--dir", default="samples/synthetic")
    ap.add_argument("--json", help="also write the full result here")
    a = ap.parse_args()
    with open(os.path.join(a.dir, "expected.json"), encoding="utf-8") as f:
        clips = json.load(f)
    models = a.models or [Settings.from_env().model]

    results = [run(m, clips, a.dir) for m in models]
    for r in results:
        print(f"\n=== {r['model']} ({r['device']}/{r['compute_type']}, {r['cpu_threads']} threads) "
              f"load {r['load_sec']}s · p50 {r['p50_sec']}s · p95 {r['p95_sec']}s · "
              f"≈ {r['fixed_sec']}s + {r['per_audio_sec']}×audio → "
              f"~{r['est_10s_answer_sec']}s per 10s answer · "
              f"{r['passed']}/{r['total']} ok")
        for row in r["rows"]:
            mark = "OK " if row["ok"] else "XX "
            print(f"{mark}{row['file']:<26} {row['language']} {row['audio_sec']:>5}s "
                  f"{row['latency_sec']:>5}s  {row['text']!r}")
            if not row["ok"]:
                print(f"{'':>4}expected: {row.get('expected')!r}")
    if a.json:
        with open(a.json, "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False, indent=1)
    return 0 if all(r["passed"] == r["total"] for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
