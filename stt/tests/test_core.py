from dataclasses import dataclass

from core import Settings, is_hallucination, join_segments, keep_segment

S = Settings()


@dataclass
class Seg:
    text: str
    no_speech_prob: float = 0.05
    avg_logprob: float = -0.3


def test_keeps_grammar_mistakes_exactly():
    segs = [Seg(" I go to event yesterday."), Seg(" She is work in Jakarta.")]
    assert join_segments(segs, "en", S) == "I go to event yesterday. She is work in Jakarta."


def test_drops_segments_whisper_thinks_are_silence():
    assert not keep_segment(Seg(" you", no_speech_prob=0.9, avg_logprob=-1.4), S)
    # Confident words are kept even when no_speech_prob is high.
    assert keep_segment(Seg(" Yes.", no_speech_prob=0.7, avg_logprob=-0.2), S)
    # Unsure words in clear speech are kept.
    assert keep_segment(Seg(" Hmm okay", no_speech_prob=0.1, avg_logprob=-1.5), S)


def test_whole_result_hallucinations_become_empty():
    assert join_segments([Seg(" Thank you for watching!")], "en", S) == ""
    assert join_segments([Seg(" Terima kasih telah menonton.")], "id", S) == ""
    assert join_segments([Seg(" Subtitles by the Amara.org community")], "en", S) == ""


def test_short_real_answers_are_not_hallucinations():
    assert join_segments([Seg(" Thank you.")], "en", S) == "Thank you."
    assert join_segments([Seg(" Bye!")], "en", S) == "Bye!"
    assert not is_hallucination("Thank you for the coffee", "en")


def test_prompt_echo_on_silence_is_dropped():
    assert is_hallucination(
        "Umm, I go to... uh, yesterday I am meet my friend. She is work in Jakarta.", "en"
    )
    assert is_hallucination("I go to, uh, yesterday I am meet my friend. She is work in Jakarta", "en")
    assert is_hallucination("Eh, aku... ya, aku kerja di Jakarta, hmm, udah dua tahun.", "id")


def test_a_real_answer_that_overlaps_the_prompt_is_kept():
    # The prompt is built from typical mistakes; learners really say these.
    assert not is_hallucination("Yesterday I am meet my friend.", "en")
    assert not is_hallucination("She is work in Jakarta.", "en")
    assert not is_hallucination("Aku kerja di Jakarta.", "id")
    assert join_segments([Seg(" Yesterday I am meet my friend.")], "en", S) == (
        "Yesterday I am meet my friend."
    )


def test_empty_is_empty():
    assert join_segments([], "en", S) == ""
    assert join_segments([Seg("  ")], "en", S) == ""
