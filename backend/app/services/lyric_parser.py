from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from typing import List, Optional
from uuid import uuid4

from app.models.schemas import (
    LyricLine,
    LyricSection,
    OccurrenceMatch,
    SectionOccurrence,
    SectionType,
    SongStructure,
    WordTimestamp,
)

# Regex recognizing section headers: [Verse 1], [Chorus x2], (Điệp khúc), [Hook], etc.
SECTION_HEADER_RE = re.compile(
    r"^[\[\(]\s*(intro|opening hook|hook|verse(?:\s*\d+)?|pre-chorus|chorus|post-chorus|bridge|break|instrumental|outro|solo|điệp khúc|phiên khúc(?:\s*\d+)?|đoạn(?:\s*\d+)?|lời(?:\s*\d+)?)"
    r"(?:\s*[xX*]\s*(\d+))?\s*[\]\)]",
    re.IGNORECASE,
)

# Regex recognizing repeat directives: Repeat Chorus, Chorus x2, Chorus 2x, etc.
REPEAT_DIRECTIVE_RE = re.compile(
    r"^(?:lặp lại|nhắc lại|repeat)?\s*(chorus|điệp khúc|verse|phiên khúc|hook)\s*(?:[xX*]\s*(\d+)|(\d+)\s*[xX])?$",
    re.IGNORECASE,
)


def normalize_section_type(raw_type: str) -> SectionType:
    s = raw_type.lower().strip()
    if "intro" in s:
        return SectionType.INTRO
    if "opening hook" in s:
        return SectionType.OPENING_HOOK
    if "hook" in s:
        return SectionType.HOOK
    if "pre-chorus" in s or "tiền điệp khúc" in s:
        return SectionType.PRE_CHORUS
    if "chorus" in s or "điệp khúc" in s:
        return SectionType.CHORUS
    if "post-chorus" in s or "hậu điệp khúc" in s:
        return SectionType.POST_CHORUS
    if "bridge" in s or "cầu nối" in s:
        return SectionType.BRIDGE
    if "break" in s:
        return SectionType.BREAK
    if "instrumental" in s or "nhạc dạo" in s or "dạo nhạc" in s:
        return SectionType.INSTRUMENTAL
    if "outro" in s or "kết" in s:
        return SectionType.OUTRO
    if "solo" in s:
        return SectionType.SOLO
    if "verse" in s or "phiên khúc" in s or "đoạn" in s or "lời" in s:
        return SectionType.VERSE
    return SectionType.VERSE


@dataclass
class ParsedLyricResult:
    structure: SongStructure
    canonical_text: str
    lines_count: int = 0
    sections_count: int = 0
    occurrences_count: int = 0


def parse_structured_lyrics(raw_text: str, default_title: str = "Bài hát") -> ParsedLyricResult:
    """Parse raw lyrics containing section markers, repeat tags (e.g. [Chorus x2], Repeat Chorus)

    into a hierarchical SongStructure model without duplicating underlying canonical definitions.
    """
    if not raw_text or not raw_text.strip():
        # Fallback empty structure
        return ParsedLyricResult(
            structure=SongStructure(sections=[]),
            canonical_text="",
        )

    raw_lines = [line.strip() for line in raw_text.replace("\r\n", "\n").replace("\r", "\n").split("\n")]

    sections: list[LyricSection] = []
    section_map: dict[str, LyricSection] = {}  # key by normalized label or type

    current_section: Optional[LyricSection] = None
    current_lines: list[str] = []
    current_multiplier = 1

    def flush_current():
        nonlocal current_section, current_lines, current_multiplier
        if not current_section:
            return

        if current_lines:
            current_section.canonical_lines = list(current_lines)
            # Create occurrences for this section based on multiplier
            for i in range(current_multiplier):
                occ_lines = [
                    LyricLine(
                        id=str(uuid4()),
                        text=line_text,
                        words=[WordTimestamp(word=w) for w in line_text.split()],
                    )
                    for line_text in current_lines
                ]
                current_section.occurrences.append(
                    SectionOccurrence(
                        id=str(uuid4()),
                        section_id=current_section.id,
                        index=len(current_section.occurrences) + 1,
                        match_type=OccurrenceMatch.EXACT,
                        lines=occ_lines,
                    )
                )

        current_lines = []
        current_multiplier = 1

    for line in raw_lines:
        if not line:
            continue

        # Check section header
        header_match = SECTION_HEADER_RE.match(line)
        if header_match:
            flush_current()
            raw_type = header_match.group(1)
            repeat_num = header_match.group(2)
            sec_type = normalize_section_type(raw_type)
            sec_label = raw_type.strip().title()

            # Check if this section type already exists (e.g. repeated [Chorus])
            canonical_key = sec_type.value
            if canonical_key in section_map and sec_type == SectionType.CHORUS:
                current_section = section_map[canonical_key]
                current_multiplier = int(repeat_num) if repeat_num else 1
            else:
                current_section = LyricSection(
                    id=str(uuid4()),
                    type=sec_type,
                    label=sec_label,
                    canonical_lines=[],
                    occurrences=[],
                )
                sections.append(current_section)
                section_map[canonical_key] = current_section
                current_multiplier = int(repeat_num) if repeat_num else 1
            continue

        # Check standalone repeat directive (e.g., "Repeat Chorus", "Chorus x2")
        repeat_match = REPEAT_DIRECTIVE_RE.match(line)
        if repeat_match:
            flush_current()
            target_type_str = repeat_match.group(1)
            n1 = repeat_match.group(2)
            n2 = repeat_match.group(3)
            repeat_count = int(n1 or n2 or 1)
            target_type = normalize_section_type(target_type_str)
            target_key = target_type.value

            if target_key in section_map:
                target_sec = section_map[target_key]
                for _ in range(repeat_count):
                    occ_lines = [
                        LyricLine(
                            id=str(uuid4()),
                            text=lt,
                            words=[WordTimestamp(word=w) for w in lt.split()],
                        )
                        for lt in target_sec.canonical_lines
                    ]
                    target_sec.occurrences.append(
                        SectionOccurrence(
                            id=str(uuid4()),
                            section_id=target_sec.id,
                            index=len(target_sec.occurrences) + 1,
                            match_type=OccurrenceMatch.EXACT,
                            lines=occ_lines,
                        )
                    )
            continue

        # Normal lyric line
        if current_section is None:
            # Default to Verse 1 if no header at start
            current_section = LyricSection(
                id=str(uuid4()),
                type=SectionType.VERSE,
                label="Verse 1",
                canonical_lines=[],
                occurrences=[],
            )
            sections.append(current_section)
            section_map[SectionType.VERSE.value] = current_section

        current_lines.append(line)

    flush_current()

    # Build canonical text
    canonical_parts = []
    total_lines = 0
    total_occs = 0
    for s in sections:
        total_occs += len(s.occurrences)
        canonical_parts.append(f"[{s.label}]")
        canonical_parts.extend(s.canonical_lines)
        canonical_parts.append("")
        total_lines += len(s.canonical_lines)

    canonical_str = "\n".join(canonical_parts).strip()
    structure = SongStructure(sections=sections)

    return ParsedLyricResult(
        structure=structure,
        canonical_text=canonical_str,
        lines_count=total_lines,
        sections_count=len(sections),
        occurrences_count=total_occs,
    )
