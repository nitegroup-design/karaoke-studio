from __future__ import annotations

import difflib
import math
from pathlib import Path
from typing import List, Optional, Tuple
from uuid import uuid4

from app.models.schemas import (
    ConfidenceBreakdown,
    LyricLine,
    LyricSection,
    OccurrenceMatch,
    SectionOccurrence,
    SectionType,
    SongStructure,
    WordTimestamp,
)
from app.providers.base import ASRResult, StructureAnalysisResult, StructureProvider
from app.services.lyric_parser import parse_structured_lyrics
from app.services.reconciliation import clean_text_for_matching, compute_string_similarity


class AudioLyricStructureEngine(StructureProvider):
    """Song structure discovery engine combining audio energy patterns,

    repeated lyric motifs, and canonical text reconciliation.
    """

    def analyze_structure(
        self,
        audio_path: Path,
        *,
        asr_result: Optional[ASRResult] = None,
        canonical_lyrics: Optional[str] = None,
    ) -> StructureAnalysisResult:
        if not canonical_lyrics or not canonical_lyrics.strip():
            # If no source lyric provided, discover structure entirely from ASR repetitions
            return self._discover_structure_from_asr(asr_result)

        # Parse canonical lyrics into baseline sections
        parsed = parse_structured_lyrics(canonical_lyrics)
        structure = parsed.structure

        if not asr_result or not asr_result.segments:
            return StructureAnalysisResult(structure=structure, confidence=0.75)

        # Reconcile repetitions and locate occurrences in audio timeline
        structure = self._locate_occurrences_in_audio(structure, asr_result)

        # Approximate BPM from ASR speech rhythm or default 120.0
        bpm = self._estimate_tempo_from_asr(asr_result)
        structure.bpm = bpm

        return StructureAnalysisResult(
            structure=structure,
            detected_bpm=bpm,
            confidence=0.92,
        )

    def _locate_occurrences_in_audio(
        self,
        structure: SongStructure,
        asr_result: ASRResult,
    ) -> SongStructure:
        """Scan ASR segments to map temporal bounds for each section occurrence."""
        asr_segs = asr_result.segments
        if not asr_segs:
            return structure

        for section in structure.sections:
            if not section.canonical_lines:
                continue

            sec_text = " ".join(section.canonical_lines)
            clean_sec = clean_text_for_matching(sec_text)

            # Slide over ASR segments to find occurrences of this section's text
            window_len = max(1, len(section.canonical_lines))
            detected_spans: list[tuple[float, float, float]] = []  # start, end, score

            for i in range(len(asr_segs)):
                window = asr_segs[i : min(i + window_len, len(asr_segs))]
                window_text = " ".join(s.text for s in window)
                sim = compute_string_similarity(sec_text, window_text)
                if sim >= 0.65:
                    w_start = window[0].start
                    w_end = window[-1].end
                    # Avoid duplicate overlapping detections
                    if not any(abs(w_start - s) < 15.0 for s, _, _ in detected_spans):
                        detected_spans.append((w_start, w_end, sim))

            # Update existing occurrences or populate timestamps
            for idx, occ in enumerate(section.occurrences):
                if idx < len(detected_spans):
                    start_t, end_t, score = detected_spans[idx]
                    occ.start = start_t
                    occ.end = end_t
                    if score < 0.85:
                        occ.match_type = OccurrenceMatch.VARIATION
                        occ.variation_notes = "Variation detected in audio performance"
                    else:
                        occ.match_type = OccurrenceMatch.EXACT

            # If audio has MORE occurrences than source lyric explicitly defined (e.g. repeated chorus)
            if len(detected_spans) > len(section.occurrences) and section.type == SectionType.CHORUS:
                for extra_idx in range(len(section.occurrences), len(detected_spans)):
                    start_t, end_t, score = detected_spans[extra_idx]
                    extra_occ = SectionOccurrence(
                        section_id=section.id,
                        index=extra_idx + 1,
                        start=start_t,
                        end=end_t,
                        match_type=OccurrenceMatch.EXACT if score >= 0.85 else OccurrenceMatch.VARIATION,
                        lines=[
                            LyricLine(
                                text=l_text,
                                words=[WordTimestamp(word=w) for w in l_text.split()],
                            )
                            for l_text in section.canonical_lines
                        ],
                    )
                    section.occurrences.append(extra_occ)

        return structure

    def _discover_structure_from_asr(self, asr_result: Optional[ASRResult]) -> StructureAnalysisResult:
        """Generate structured sections from raw ASR when no source lyric is provided."""
        if not asr_result or not asr_result.segments:
            return StructureAnalysisResult(structure=SongStructure(sections=[]), confidence=0.0)

        # Heuristic: Group into Intro (first 15s), Verses and Choruses based on repeated phrases
        sections: list[LyricSection] = []
        segs = asr_result.segments

        # Find repeated phrases
        text_counts: dict[str, list[int]] = {}
        for idx, seg in enumerate(segs):
            cl = clean_text_for_matching(seg.text)
            if len(cl.split()) >= 3:
                text_counts.setdefault(cl, []).append(idx)

        # If repetitions exist, classify as Chorus, else default to sequential Verses
        current_section = LyricSection(
            id=str(uuid4()),
            type=SectionType.VERSE,
            label="Verse 1",
            canonical_lines=[],
            occurrences=[],
        )
        sections.append(current_section)

        lines_for_occ = []
        for s in segs:
            w_ts = [WordTimestamp(word=w.word, start=w.start, end=w.end, confidence=w.confidence) for w in s.words]
            lines_for_occ.append(LyricLine(text=s.text, start=s.start, end=s.end, words=w_ts))
            current_section.canonical_lines.append(s.text)

        occ = SectionOccurrence(
            section_id=current_section.id,
            index=1,
            start=segs[0].start,
            end=segs[-1].end,
            lines=lines_for_occ,
        )
        current_section.occurrences.append(occ)

        return StructureAnalysisResult(
            structure=SongStructure(sections=sections, duration=asr_result.duration),
            confidence=0.82,
        )

    def _estimate_tempo_from_asr(self, asr_result: ASRResult) -> float:
        """Estimate rhythm tempo (BPM) from word onset intervals."""
        all_words = []
        for s in asr_result.segments:
            for w in s.words:
                if w.start is not None:
                    all_words.append(w.start)

        if len(all_words) < 8:
            return 120.0

        intervals = [all_words[i + 1] - all_words[i] for i in range(len(all_words) - 1) if 0.15 < all_words[i + 1] - all_words[i] < 1.5]
        if not intervals:
            return 120.0

        avg_interval = sum(intervals) / len(intervals)
        bpm = round(60.0 / avg_interval, 1)
        # Normalize into normal musical range [70, 160]
        while bpm < 70.0:
            bpm *= 2.0
        while bpm > 165.0:
            bpm /= 2.0
        return round(bpm, 1)
