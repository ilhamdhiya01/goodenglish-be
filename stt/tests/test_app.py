import asyncio

import numpy as np
from fastapi.testclient import TestClient

from app import Busy, create_app
from core import NO_SPEECH_MESSAGE, SAMPLE_RATE, Settings


class FakeTranscriber:
    def __init__(self, text="I go to event yesterday", seconds=3.0, bad=False):
        self.text, self.seconds, self.bad = text, seconds, bad
        self.calls = []

    def decode(self, path):
        if self.bad:
            raise ValueError("not audio")
        return np.zeros(int(self.seconds * SAMPLE_RATE), dtype=np.float32)

    def transcribe(self, samples, language):
        self.calls.append(language)
        return self.text


def client(t, **settings):
    return TestClient(create_app(t, Settings(**settings)))


def post(c, data=b"x" * 100, language="en"):
    return c.post(
        "/api/transcribe",
        files={"audio": ("a.webm", data, "audio/webm")},
        data={"language": language},
    )


def test_returns_text_language_and_duration():
    t = FakeTranscriber()
    with client(t) as c:
        r = post(c, language="id")
    assert r.status_code == 200
    assert r.json() == {"text": "I go to event yesterday", "language": "id", "duration_sec": 3.0}
    assert t.calls == ["id"]


def test_defaults_to_english_and_refuses_other_languages():
    t = FakeTranscriber()
    with client(t) as c:
        r = c.post("/api/transcribe", files={"audio": ("a.webm", b"x" * 10, "audio/webm")})
        assert r.status_code == 200
        assert post(c, language="fr").status_code == 422
    assert t.calls == ["en"]


def test_silence_is_422_with_a_friendly_message():
    with client(FakeTranscriber(text="")) as c:
        r = post(c)
    assert r.status_code == 422
    assert r.json()["detail"] == {"code": "no_speech", "message": NO_SPEECH_MESSAGE}


def test_too_big_too_long_and_unreadable():
    with client(FakeTranscriber(), max_bytes=50) as c:
        assert post(c, data=b"x" * 51).status_code == 413
    with client(FakeTranscriber(seconds=61)) as c:
        r = post(c)
        assert r.status_code == 422
        assert r.json()["detail"]["code"] == "too_long"
    with client(FakeTranscriber(bad=True)) as c:
        assert post(c).status_code == 415
    with client(FakeTranscriber()) as c:
        assert post(c, data=b"").status_code == 422


def test_temp_files_are_removed(tmp_path, monkeypatch):
    import tempfile

    monkeypatch.setattr(tempfile, "tempdir", str(tmp_path))
    with client(FakeTranscriber()) as c:
        post(c)
        with client(FakeTranscriber(bad=True)) as c2:
            post(c2)
    assert list(tmp_path.iterdir()) == []


def test_busy_refuses_beyond_the_queue():
    async def run():
        busy = Busy(concurrency=1, queue_max=1)
        await busy.__aenter__()  # one running
        waiter = asyncio.create_task(busy.__aenter__())  # one waiting
        await asyncio.sleep(0)
        try:
            await busy.__aenter__()  # third: refused
        except Exception as e:  # HTTPException
            assert getattr(e, "status_code", None) == 503
        else:
            raise AssertionError("expected 503")
        await busy.__aexit__(None, None, None)
        await waiter
        await busy.__aexit__(None, None, None)

    asyncio.run(run())
