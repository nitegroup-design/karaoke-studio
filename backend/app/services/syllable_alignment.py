from __future__ import annotations

import re
import unicodedata
from typing import List, Optional
from uuid import uuid4

from app.models.schemas import LyricLine, LyricSyllable, WordTimestamp


def segment_word_into_syllables(word_text: str, language: str = "vi") -> list[str]:
    """Segment a word token into syllables. For Vietnamese, tokens separated by spaces

    are predominantly single syllables; compound phrases and hyphens are segmented cleanly.
    """
    cleaned = re.sub(r"[^\w\s\-]", "", word_text).strip()
    if not cleaned:
        return [word_text]

    # If hyphenated (e.g. Ka-ra-o-ke)
    if "-" in cleaned:
        parts = [p.strip() for p in cleaned.split("-") if p.strip()]
        return parts if parts else [word_text]

    # For Vietnamese, standard single tokens are single syllables
    if language in ("vi", "vietnamese"):
        return [cleaned]

    # For English / Latin polysyllabic words, basic vowel-cluster heuristic
    vowel_runs = re.findall(r"[aeiouy]+", cleaned.lower())
    if len(vowel_runs) <= 1:
        return [cleaned]

    # Split into approximate syllables by vowel clusters
    syllables = []
    pattern = r"[^aeiouy]*[aeiouy]+(?:[^aeiouy]+(?=$|[^aeiouy]))?"
    matches = list(re.finditer(pattern, cleaned, re.IGNORECASE))
    if matches:
        for m in matches:
            syllables.append(m.group())
        return syllables
    return [cleaned]


def align_word_syllables(
    word: WordTimestamp,
    language: str = "vi",
) -> List[LyricSyllable]:
    """Generate syllable timings for a word, proportionally distributing duration."""
    syllable_texts = segment_word_into_syllables(word.word, language=language)
    if not syllable_texts:
        syllable_texts = [word.word]

    num_syls = len(syllable_texts)
    if word.start is None or word.end is None or word.end <= word.start:
        return [
            LyricSyllable(
                id=str(uuid4()),
                text=st,
                start=None,
                end=None,
                confidence=word.confidence,
            )
            for st in syllable_texts
        ]

    total_dur = max(0.05, word.end - word.start)
    step = total_dur / num_syls

    result = []
    cur_t = word.start
    for i, st in enumerate(syllable_texts):
        s_end = round(cur_t + step, 3) if i < num_syls - 1 else word.end
        result.append(
            LyricSyllable(
                id=str(uuid4()),
                text=st,
                start=round(cur_t, 3),
                end=round(s_end, 3),
                confidence=word.confidence,
            )
        )
        cur_t = s_end
    return result


def apply_melisma_gap_bridging(
    line: LyricLine,
    max_gap: float = 0.85,
    min_breath_gap: float = 0.03,
) -> LyricLine:
    """Bridge gaps between words in continuous vocal runs (melisma)

    preventing flickering highlight or false word separation.
    """
    valid_words = [w for w in line.words if w.start is not None and w.end is not None]
    if len(valid_words) < 2:
        return line

    for i in range(len(valid_words) - 1):
        w1 = valid_words[i]
        w2 = valid_words[i + 1]
        gap = float(w2.start) - float(w1.end)
        if 0.0 < gap <= max_gap:
            # Stretch w1.end smoothly up to w2.start - min_breath_gap
            w1.end = round(float(w2.start) - min_breath_gap, 3)

    # Line boundary sync
    if valid_words:
        line.start = min(w.start for w in valid_words)
        line.end = max(w.end for w in valid_words)
    return line


def process_line_syllables_and_melisma(line: LyricLine, language: str = "vi") -> LyricLine:
    """Process a lyric line by generating syllables for every word and bridging melisma runs."""
    line = apply_melisma_gap_bridging(line)
    for word in line.words:
        word.syllables = align_word_syllables(word, language=language)
    return line
