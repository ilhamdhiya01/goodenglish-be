"""Speech-to-text for GoodEnglish "Main peran": faster-whisper, verbatim.

Everything here is plain Python so it can be tested without the model.
The learner's own mistakes are the point of the exercise, so the output
must be exactly what was said: no auto-detected language, no fallback
temperatures, no "previous text" conditioning, and a prompt full of
ungrammatical speech so Whisper doesn't tidy the sentence up.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from typing import Iterable, Protocol

SAMPLE_RATE = 16000
LANGUAGES = ("en", "id")

# Shows Whisper the style we want: hesitant, ungrammatical, kept as said.
INITIAL_PROMPTS = {
    "en": "Umm, I go to... uh, yesterday I am meet my friend. She is work in Jakarta.",
    "id": "Eh, aku... ya, aku kerja di Jakarta, hmm, udah dua tahun.",
}

# What Whisper "hears" in silence or noise (from its subtitle training data).
# Only dropped when it is the whole result: a learner may well say "thank
# you", so short everyday phrases are deliberately NOT in this list.
HALLUCINATIONS = {
    "thank you for watching",
    "thanks for watching",
    "thank you so much for watching",
    "thank you for watching please subscribe",
    "please subscribe",
    "like and subscribe",
    "dont forget to like and subscribe",
    "see you in the next video",
    "see you next time",
    "subtitles by",
    "subtitles by the amara org community",
    "subtitled by",
    "transcribed by",
    "translated by",
    "terima kasih telah menonton",
    "terima kasih sudah menonton",
    "terima kasih telah menyaksikan",
    "jangan lupa subscribe",
    "jangan lupa like dan subscribe",
    "sampai jumpa di video berikutnya",
    "subtitle oleh",
    "diterjemahkan oleh",
    "disarikan oleh",
}

# Subtitle credits ("Subtitles by …", "Diterjemahkan oleh …") are never a
# learner's answer, whatever follows them.
HALLUCINATION_PREFIXES = (
    "subtitles by",
    "subtitled by",
    "transcribed by",
    "translated by",
    "captions by",
    "subtitle oleh",
    "diterjemahkan oleh",
    "disarikan oleh",
)

NO_SPEECH_MESSAGE = "Suaramu tidak terdengar, coba lagi ya."


def env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


def env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    model: str = "small"
    device: str = "cpu"
    compute_type: str = "int8"
    cpu_threads: int = 2
    beam_size: int = 5
    max_bytes: int = 5_000_000
    max_sec: float = 60.0
    # A segment is dropped as "no speech" when Whisper thinks it is silence
    # (no_speech_prob above this) AND isn't confident in its words
    # (avg_logprob below LOGPROB_MIN) - Whisper's own rule.
    no_speech_max: float = 0.6
    logprob_min: float = -1.0
    concurrency: int = 1
    queue_max: int = 4
    models_dir: str = "/models"

    @staticmethod
    def from_env() -> "Settings":
        return Settings(
            model=os.environ.get("STT_MODEL", "small"),
            device=os.environ.get("STT_DEVICE", "cpu"),
            compute_type=os.environ.get("STT_COMPUTE_TYPE", "int8"),
            cpu_threads=env_int("STT_CPU_THREADS", 2),
            beam_size=env_int("STT_BEAM_SIZE", 5),
            max_bytes=env_int("STT_MAX_BYTES", 5_000_000),
            max_sec=env_float("STT_MAX_SEC", 60.0),
            no_speech_max=env_float("STT_NO_SPEECH_MAX", 0.6),
            logprob_min=env_float("STT_LOGPROB_MIN", -1.0),
            concurrency=max(1, env_int("STT_CONCURRENCY", 1)),
            queue_max=max(0, env_int("STT_QUEUE_MAX", 4)),
            models_dir=os.environ.get("STT_MODELS_DIR", "/models"),
        )


class Segment(Protocol):
    text: str
    no_speech_prob: float
    avg_logprob: float


def _words(text: str) -> str:
    """Lowercase letters/digits only, for comparing phrases."""
    text = text.lower().replace("'", "").replace("’", "")
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def keep_segment(seg: Segment, s: Settings) -> bool:
    return not (seg.no_speech_prob > s.no_speech_max and seg.avg_logprob < s.logprob_min)


def is_hallucination(text: str, language: str) -> bool:
    w = _words(text)
    if not w:
        return True
    if w in HALLUCINATIONS or w.startswith(HALLUCINATION_PREFIXES):
        return True
    # On silence Whisper sometimes just repeats its prompt back. Only most
    # of the prompt counts as an echo: the prompt is made of typical learner
    # mistakes, so a learner may well say a piece of it for real
    # ("Yesterday I am meet my friend").
    prompt = _words(INITIAL_PROMPTS.get(language, ""))
    return w in prompt and len(w) >= 0.6 * len(prompt)


def join_segments(segments: Iterable[Segment], language: str, s: Settings) -> str:
    """The transcript: kept segments joined, or "" for silence/hallucination."""
    text = " ".join(seg.text.strip() for seg in segments if keep_segment(seg, s))
    text = re.sub(r"\s+", " ", text).strip()
    return "" if is_hallucination(text, language) else text


class Transcriber:
    """Loads the model once; transcribe() is blocking (run it in a thread)."""

    def __init__(self, s: Settings):
        from faster_whisper import WhisperModel  # heavy import, keep lazy

        self.s = s
        self.model = WhisperModel(
            s.model,
            device=s.device,
            compute_type=s.compute_type,
            cpu_threads=s.cpu_threads,
            download_root=s.models_dir,
        )

    def decode(self, path: str):
        """16 kHz mono float32 samples (any format ffmpeg/PyAV reads)."""
        from faster_whisper import decode_audio

        return decode_audio(path, sampling_rate=SAMPLE_RATE)

    def transcribe(self, audio, language: str) -> str:
        segments, _info = self.model.transcribe(
            audio,
            language=language,
            task="transcribe",
            beam_size=self.s.beam_size,
            temperature=0.0,
            condition_on_previous_text=False,
            initial_prompt=INITIAL_PROMPTS[language],
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 500},
            without_timestamps=True,
        )
        # `segments` is lazy: iterating it is what runs the model.
        return join_segments(list(segments), language, self.s)
