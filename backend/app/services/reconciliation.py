from __future__ import annotations

import difflib
import re
import unicodedata
from dataclasses import dataclass, field
from typing import List, Optional, Tuple
from uuid import uuid4

from app.models.schemas import (
    ConfidenceBreakdown,
    LyricLine,
    LyricSection,
    OccurrenceMatch,
    ReviewReason,
    SectionOccurrence,
    SectionType,
    SongStructure,
    VocalActivityType,
    WordTimestamp,
)
from app.providers.base import ASRResult, ASRSegmentResult, ASRWordResult


def clean_text_for_matching(text: str) -> str:
    """Normalize text for invariant phonetic and lexical comparison."""
    norm = unicodedata.normalize("NFC", text).lower()
    return re.sub(r"[^\w\s]", "", norm).strip()


def compute_string_similarity(a: str, b: str) -> float:
    ca = clean_text_for_matching(a)
    cb = clean_text_for_matching(b)
    if not ca and not cb:
        return 1.0
    if not ca or not cb:
        return 0.0
    return round(difflib.SequenceMatcher(None, ca, cb).ratio(), 3)


@dataclass
class ReconciledLine:
    source_text: str
    asr_text: str
    match_status: OccurrenceMatch  # EXACT, VARIATION, PARTIAL, OMITTED
    confidence: ConfidenceBreakdown
    line: LyricLine
    explanation: Optional[str] = None


@dataclass
class ReconciliationReport:
    matched_lines: List[ReconciledLine] = field(default_factory=list)
    adlibs: List[LyricLine] = field(default_factory=list)
    omitted_lines: List[str] = field(default_factory=list)
    overall_confidence: float = 1.0
    opening_hook_detected: bool = False
    review_required_count: int = 0


def reconcile_source_and_asr(
    structure: SongStructure,
    asr_result: ASRResult,
) -> Tuple[SongStructure, ReconciliationReport]:
    """Reconcile source lyric structure with ASR evidence without hallucination or domino shifts."""
    report = ReconciliationReport()
    asr_segments = list(asr_result.segments)
    used_asr_indices = set()

    # Check for Opening Hook: ASR has vocal activity in first 25s matching Chorus lines before Verse 1
    chorus_sections = [s for s in structure.sections if s.type == SectionType.CHORUS]
    if chorus_sections and asr_segments:
        first_chorus = chorus_sections[0]
        early_asr = [seg for seg in asr_segments if seg.start < 25.0]
        if early_asr and first_chorus.canonical_lines:
            # Check similarity between early ASR and first few lines of Chorus
            top_chorus_lines = first_chorus.canonical_lines[: len(early_asr)]
            sims = [
                compute_string_similarity(c, a.text)
                for c, a in zip(top_chorus_lines, early_asr)
            ]
            if sims and (sum(sims) / len(sims)) >= 0.70:
                report.opening_hook_detected = True
                # Insert OPENING_HOOK section at the beginning
                hook_lines = []
                for idx, (c_line, a_seg) in enumerate(zip(top_chorus_lines, early_asr)):
                    used_asr_indices.add(asr_segments.index(a_seg))
                    sim = sims[idx]
                    match_type = OccurrenceMatch.EXACT if sim >= 0.88 else OccurrenceMatch.PARTIAL
                    words = [
                        WordTimestamp(
                            word=w.word,
                            start=w.start,
                            end=w.end,
                            confidence=w.confidence,
                        )
                        for w in a_seg.words
                    ]
                    hook_lines.append(
                        LyricLine(
                            text=c_line,
                            start=a_seg.start,
                            end=a_seg.end,
                            words=words,
                            confidence=ConfidenceBreakdown(
                                text=sim, audio=a_seg.confidence, timing=0.92, structure=0.95
                            ),
                        )
                    )

                hook_occ = SectionOccurrence(
                    section_id="sec-opening-hook",
                    index=1,
                    start=early_asr[0].start,
                    end=early_asr[-1].end,
                    match_type=OccurrenceMatch.PARTIAL,
                    variation_notes="Opening Hook matched from Chorus",
                    lines=hook_lines,
                )
                hook_sec = LyricSection(
                    id="sec-opening-hook",
                    type=SectionType.OPENING_HOOK,
                    label="Opening Hook",
                    canonical_lines=top_chorus_lines,
                    occurrences=[hook_occ],
                )
                structure.sections.insert(0, hook_sec)

    # Process all occurrences in the structure
    all_confs: list[float] = []

    for section in structure.sections:
        if section.type == SectionType.OPENING_HOOK:
            continue

        for occ in section.occurrences:
            aligned_occ_lines: list[LyricLine] = []

            for line in occ.lines:
                # Find best matching ASR segment that hasn't been consumed
                best_idx = -1
                best_sim = 0.0

                for a_idx, a_seg in enumerate(asr_segments):
                    if a_idx in used_asr_indices:
                        continue
                    sim = compute_string_similarity(line.text, a_seg.text)
                    if sim > best_sim:
                        best_sim = sim
                        best_idx = a_idx

                if best_idx >= 0 and best_sim >= 0.45:
                    used_asr_indices.add(best_idx)
                    matched_seg = asr_segments[best_idx]

                    # Determine match classification
                    if best_sim >= 0.88:
                        match_status = OccurrenceMatch.EXACT
                        reasons = []
                    elif best_sim >= 0.65:
                        match_status = OccurrenceMatch.VARIATION
                        reasons = [ReviewReason.VARIATION_DETECTED]
                    else:
                        match_status = OccurrenceMatch.PARTIAL
                        reasons = [ReviewReason.LOW_CONFIDENCE]

                    # Word alignment mapping
                    words: list[WordTimestamp] = []
                    if matched_seg.words:
                        for w in matched_seg.words:
                            words.append(
                                WordTimestamp(
                                    word=w.word,
                                    start=w.start,
                                    end=w.end,
                                    confidence=w.confidence,
                                )
                            )
                    else:
                        for w in line.text.split():
                            words.append(WordTimestamp(word=w, start=matched_seg.start, end=matched_seg.end))

                    conf = ConfidenceBreakdown(
                        text=best_sim,
                        audio=matched_seg.confidence,
                        timing=0.90,
                        structure=0.92,
                    )
                    all_confs.append(conf.overall)

                    is_review = conf.overall < 0.70 or bool(reasons)
                    if is_review:
                        report.review_required_count += 1

                    updated_line = LyricLine(
                        id=line.id,
                        text=line.text,
                        start=matched_seg.start,
                        end=matched_seg.end,
                        words=words,
                        confidence=conf,
                        review_required=is_review,
                        review_reasons=reasons,
                    )
                    aligned_occ_lines.append(updated_line)
                    report.matched_lines.append(
                        ReconciledLine(
                            source_text=line.text,
                            asr_text=matched_seg.text,
                            match_status=match_status,
                            confidence=conf,
                            line=updated_line,
                        )
                    )
                else:
                    # OMITTED: line present in source but missing from audio evidence
                    report.omitted_lines.append(line.text)
                    report.review_required_count += 1
                    conf = ConfidenceBreakdown(text=0.0, audio=0.0, timing=0.0, structure=0.5)
                    all_confs.append(conf.overall)
                    unaligned_words = [
                        WordTimestamp(
                            word=w,
                            start=None,
                            end=None,
                            confidence=0.0,
                            review_required=True,
                            review_reasons=[ReviewReason.MISSING_TIMING, ReviewReason.OMITTED_VOCAL],
                        )
                        for w in line.text.split()
                    ]
                    omitted_line = LyricLine(
                        id=line.id,
                        text=line.text,
                        start=None,
                        end=None,
                        words=unaligned_words,
                        confidence=conf,
                        review_required=True,
                        review_reasons=[ReviewReason.MISSING_TIMING, ReviewReason.OMITTED_VOCAL],
                    )
                    aligned_occ_lines.append(omitted_line)

            occ.lines = aligned_occ_lines
            valid_starts = [l.start for l in aligned_occ_lines if l.start is not None]
            valid_ends = [l.end for l in aligned_occ_lines if l.end is not None]
            if valid_starts:
                occ.start = min(valid_starts)
            if valid_ends:
                occ.end = max(valid_ends)

    # Detect EXTRA VOCALS / AD-LIBS: Remaining unconsumed ASR segments
    for idx, a_seg in enumerate(asr_segments):
        if idx not in used_asr_indices:
            dur = a_seg.end - a_seg.start
            is_adlib = dur <= 1.5 or len(a_seg.text.split()) <= 3
            vocal_act = VocalActivityType.ADLIB if is_adlib else VocalActivityType.SINGING

            adlib_words = [
                WordTimestamp(word=w.word, start=w.start, end=w.end, confidence=w.confidence)
                for w in a_seg.words
            ]
            adlib_line = LyricLine(
                id=str(uuid4()),
                text=a_seg.text,
                start=a_seg.start,
                end=a_seg.end,
                words=adlib_words,
                vocal_type=vocal_act,
                review_required=True,
                review_reasons=[ReviewReason.EXTRA_VOCAL],
            )
            report.adlibs.append(adlib_line)
            report.review_required_count += 1

    report.overall_confidence = round(sum(all_confs) / len(all_confs), 3) if all_confs else 1.0
    return structure, report
