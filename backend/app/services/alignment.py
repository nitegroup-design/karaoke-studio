"""Hybrid Audio-to-Lyric alignment engine.

Fuzzy-aligns canonical reference lyrics with Whisper transcribed vocal tokens,
preventing cascading desynchronization (domino errors) when audio contains
ad-libs/intros not in the text, or when the text contains extra/omitted lines.
"""

from __future__ import annotations

import difflib
import re
import unicodedata
from typing import Optional
from uuid import uuid4

from app.models.schemas import LyricLine, LyricsData, ReviewReason, WordTimestamp


HEADER_PATTERN = re.compile(
    r"^\[.*\]$|^\(.*(?:verse|chorus|hook|intro|outro|bridge|điệp khúc|lời bài hát|đoạn|phiên khúc|solo).*\)$",
    re.IGNORECASE,
)


def clean_lyrics_text(text: str) -> list[str]:
    """Strip section headers (e.g. [Chorus], [Verse 1]) and empty lines."""
    lines: list[str] = []
    for raw in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = raw.strip()
        if not line:
            continue
        if HEADER_PATTERN.match(line):
            continue
        lines.append(line)
    return lines


def normalize_word(word: str) -> str:
    """Normalize a word for fuzzy phonetic comparison."""
    return re.sub(r"[^\w\s]", "", unicodedata.normalize("NFC", word).lower()).strip()


def _missing_line(text: str, existing_id: Optional[str] = None) -> LyricLine:
    words = [
        WordTimestamp(
            id=str(uuid4()),
            word=w,
            start=None,
            end=None,
            review_required=True,
            review_reasons=[ReviewReason.MISSING_TIMING, ReviewReason.UNALIGNED_TEXT],
        )
        for w in text.split()
    ]
    return LyricLine(
        id=existing_id or str(uuid4()),
        text=text,
        start=None,
        end=None,
        words=words,
        review_required=True,
        review_reasons=[ReviewReason.MISSING_TIMING, ReviewReason.UNALIGNED_TEXT],
    )


def interpolate_missing_word_timings(words: list[WordTimestamp]) -> None:
    """Linearly fill missing start/end timestamps within a line that has partial timings."""
    n = len(words)
    if n == 0:
        return

    # Find indices of words with valid start & end
    valid_indices = [i for i, w in enumerate(words) if w.start is not None and w.end is not None]
    if not valid_indices:
        return

    # If some words at the beginning are missing, extrapolate backward from first valid
    first_valid = valid_indices[0]
    if first_valid > 0:
        ref_start = words[first_valid].start or 0.0
        avg_dur = max(0.18, min(0.4, (words[first_valid].end or ref_start + 0.3) - ref_start))
        cur_end = ref_start
        for i in range(first_valid - 1, -1, -1):
            cur_start = max(0.0, round(cur_end - avg_dur, 3))
            words[i].start = cur_start
            words[i].end = cur_end
            cur_end = cur_start

    # Fill gaps between valid words
    for idx in range(len(valid_indices) - 1):
        left_idx = valid_indices[idx]
        right_idx = valid_indices[idx + 1]
        gap_count = right_idx - left_idx - 1
        if gap_count <= 0:
            continue

        t_left = words[left_idx].end or words[left_idx].start or 0.0
        t_right = words[right_idx].start or words[right_idx].end or t_left
        span = max(0.05 * gap_count, t_right - t_left)
        step = span / gap_count

        for g in range(gap_count):
            missing_idx = left_idx + 1 + g
            w_start = round(t_left + g * step, 3)
            w_end = round(t_left + (g + 1) * step, 3)
            words[missing_idx].start = w_start
            words[missing_idx].end = w_end

    # If some words at the end are missing, extrapolate forward from last valid
    last_valid = valid_indices[-1]
    if last_valid < n - 1:
        cur_start = words[last_valid].end or words[last_valid].start or 0.0
        avg_dur = max(0.18, min(0.4, cur_start - (words[last_valid].start or (cur_start - 0.3))))
        for i in range(last_valid + 1, n):
            cur_end = round(cur_start + avg_dur, 3)
            words[i].start = cur_start
            words[i].end = cur_end
            cur_start = cur_end


def hybrid_align_canonical_lyrics(
    canonical_text: str,
    asr_lines: list[LyricLine],
    existing: Optional[LyricsData] = None,
) -> list[LyricLine]:
    """Match canonical reference lyrics to Whisper ASR words via fuzzy sequence alignment.

    - Protects against extra or omitted verses.
    - Prevents audio ad-libs/intros from shifting lyrics.
    - Preserves locked lines and existing IDs.
    """
    clean_lines = clean_lyrics_text(canonical_text)
    if not clean_lines:
        return []

    # Flatten ASR words with valid timestamps
    asr_words: list[WordTimestamp] = []
    for line in asr_lines:
        for w in line.words:
            if w.start is not None and w.end is not None:
                asr_words.append(w)

    # Flatten canonical words: (line_idx, word_idx_in_line, raw_word, norm_word)
    canonical_tokens: list[tuple[int, int, str, str]] = []
    for line_idx, line_str in enumerate(clean_lines):
        for word_idx, raw_w in enumerate(line_str.split()):
            canonical_tokens.append((line_idx, word_idx, raw_w, normalize_word(raw_w)))

    asr_norm = [normalize_word(w.word) for w in asr_words]
    can_norm = [t[3] for t in canonical_tokens]

    # Perform sequence matching between canonical words and ASR words
    # Frequent syllables in Vietnamese and repeated choruses are meaningful anchors.
    matcher = difflib.SequenceMatcher(None, can_norm, asr_norm, autojunk=False)
    mapped_times: dict[int, WordTimestamp] = {}

    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            for c_idx, a_idx in zip(range(i1, i2), range(j1, j2)):
                mapped_times[c_idx] = asr_words[a_idx]
        elif tag == "replace":
            len_c = i2 - i1
            len_a = j2 - j1
            if len_c == len_a:
                for c_idx, a_idx in zip(range(i1, i2), range(j1, j2)):
                    w_can = can_norm[c_idx]
                    w_asr = asr_norm[a_idx]
                    sim = difflib.SequenceMatcher(None, w_can, w_asr).ratio() if (w_can and w_asr) else 0.0
                    if sim >= 0.45 or w_can == w_asr:
                        mapped_times[c_idx] = asr_words[a_idx]
            elif len_c == 1 and len_a >= 1:
                sim = difflib.SequenceMatcher(None, can_norm[i1], asr_norm[j1]).ratio()
                if sim >= 0.5:
                    mapped_times[i1] = WordTimestamp(
                        word=canonical_tokens[i1][2],
                        start=asr_words[j1].start,
                        end=asr_words[j2 - 1].end,
                    )

    # Reconstruct LyricLine list from canonical lines
    output_lines: list[LyricLine] = []
    token_global_idx = 0
    previous_by_index: dict[int, LyricLine] = {}
    if existing:
        previous_matcher = difflib.SequenceMatcher(
            None, [line.text for line in existing.lines], clean_lines, autojunk=False
        )
        for tag, i1, i2, j1, j2 in previous_matcher.get_opcodes():
            if tag == "equal" or (tag == "replace" and i2 - i1 == j2 - j1):
                for old, new in zip(range(i1, i2), range(j1, j2)):
                    previous_by_index[new] = existing.lines[old]
        # Legacy canonical imports may have no corresponding text for a locked line.
        if not previous_by_index:
            previous_by_index = {i: line for i, line in enumerate(existing.lines) if line.locked}

    for line_idx, line_text in enumerate(clean_lines):
        previous = previous_by_index.get(line_idx)
        if previous and previous.locked:
            output_lines.append(previous.model_copy(deep=True))
            token_global_idx += len(line_text.split())
            continue

        raw_words = line_text.split()
        line_word_objs: list[WordTimestamp] = []
        matched_in_line: list[WordTimestamp] = []

        for word_in_line_idx, raw_w in enumerate(raw_words):
            current_token_idx = token_global_idx + word_in_line_idx
            matched_asr = mapped_times.get(current_token_idx)

            existing_word = (
                previous.words[word_in_line_idx]
                if previous and word_in_line_idx < len(previous.words) and previous.words[word_in_line_idx].word == raw_w
                else None
            )
            word_id = existing_word.id if existing_word else str(uuid4())

            if matched_asr is not None and matched_asr.start is not None and matched_asr.end is not None:
                wt = WordTimestamp(
                    id=word_id,
                    word=raw_w,
                    start=matched_asr.start,
                    end=matched_asr.end,
                )
                line_word_objs.append(wt)
                matched_in_line.append(wt)
            else:
                wt = WordTimestamp(
                    id=word_id,
                    word=raw_w,
                    start=None,
                    end=None,
                    review_required=True,
                    review_reasons=[ReviewReason.MISSING_TIMING, ReviewReason.UNALIGNED_TEXT],
                )
                line_word_objs.append(wt)

        token_global_idx += len(raw_words)

        if matched_in_line:
            # Unknown syllables stay unknown. Filling gaps must not move a valid ASR
            # timestamp or invent a duration that subsequently looks authoritative.
            valid_starts = [w.start for w in line_word_objs if w.start is not None]
            valid_ends = [w.end for w in line_word_objs if w.end is not None]
            l_start = min(valid_starts) if valid_starts else None
            l_end = max(valid_ends) if valid_ends else None

            review_reasons: list[ReviewReason] = []
            if len(matched_in_line) < len(raw_words):
                review_reasons.append(ReviewReason.UNALIGNED_TEXT)

            new_line = LyricLine(
                id=previous.id if previous else str(uuid4()),
                text=line_text,
                start=l_start,
                end=l_end,
                words=line_word_objs,
                review_required=bool(review_reasons),
                review_reasons=review_reasons,
            )
            output_lines.append(new_line)
        else:
            output_lines.append(LyricLine(
                id=previous.id if previous else str(uuid4()), text=line_text,
                words=line_word_objs, review_reasons=[ReviewReason.UNALIGNED_TEXT],
            ))

    # Auto-bridge singing gaps for held notes (Melisma / Ngân dài)
    for line in output_lines:
        if line.locked:
            continue
        valid_words = [w for w in line.words if w.start is not None and w.end is not None]
        for i in range(len(valid_words) - 1):
            cur_w = valid_words[i]
            next_w = valid_words[i + 1]
            if cur_w.end is not None and next_w.start is not None:
                gap = next_w.start - cur_w.end
                if 0.0 < gap <= 0.85:
                    cur_w.end = round(next_w.start - 0.03, 3)
        if valid_words and line.end is not None and valid_words[-1].end is not None:
            if valid_words[-1].end < line.end and (line.end - valid_words[-1].end) <= 2.2:
                valid_words[-1].end = round(line.end - 0.05, 3)

    return output_lines
