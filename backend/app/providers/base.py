from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.models.schemas import (
    ConfidenceBreakdown,
    LyricLine,
    LyricSection,
    SectionOccurrence,
    SongStructure,
    VocalActivityType,
    WordTimestamp,
)


@dataclass
class ASRWordResult:
    word: str
    start: float
    end: float
    confidence: float = 1.0


@dataclass
class ASRSegmentResult:
    text: str
    start: float
    end: float
    words: List[ASRWordResult] = field(default_factory=list)
    confidence: float = 1.0
    language: str = "vi"


@dataclass
class ASRResult:
    segments: List[ASRSegmentResult] = field(default_factory=list)
    language: str = "vi"
    duration: float = 0.0
    model_name: str = "whisper"
    confidence: float = 1.0


class ASRProvider(ABC):
    """Abstract interface for Speech Recognition engines (faster-whisper, WhisperX, etc.)."""

    @abstractmethod
    def transcribe(
        self,
        audio_path: Path,
        *,
        language: Optional[str] = "vi",
        word_timestamps: bool = True,
        vad_filter: bool = True,
        initial_prompt: Optional[str] = None,
    ) -> ASRResult:
        """Transcribe audio into text segments with word timestamps and confidence."""
        pass


@dataclass
class SeparationResult:
    vocals_path: Path
    instrumental_path: Path
    stems: Dict[str, Path] = field(default_factory=dict)
    model_name: str = "htdemucs"


class SeparationProvider(ABC):
    """Abstract interface for vocal separation models (Demucs, UVR, MDX)."""

    @abstractmethod
    def separate(
        self,
        audio_path: Path,
        output_dir: Path,
        *,
        device: str = "cpu",
        stems: Optional[List[str]] = None,
    ) -> SeparationResult:
        """Separate audio into vocals and instrumental tracks."""
        pass


@dataclass
class VocalSegment:
    start: float
    end: float
    activity: VocalActivityType
    confidence: float = 1.0


@dataclass
class VocalActivityAnalysis:
    segments: List[VocalSegment] = field(default_factory=list)
    singing_ratio: float = 0.0
    speech_ratio: float = 0.0
    silence_ratio: float = 0.0


class VocalActivityProvider(ABC):
    """Abstract interface for Vocal Activity Detection (Singing, Rap, Speech, Ad-lib)."""

    @abstractmethod
    def detect_activity(
        self,
        audio_path: Path,
        *,
        min_silence_duration: float = 0.3,
    ) -> VocalActivityAnalysis:
        """Classify temporal segments of audio into singing, speech, ad-lib, silence, etc."""
        pass


@dataclass
class AlignmentResult:
    lines: List[LyricLine] = field(default_factory=list)
    aligned_word_count: int = 0
    total_word_count: int = 0
    overall_confidence: float = 1.0
    unaligned_lines: List[str] = field(default_factory=list)


class AlignmentProvider(ABC):
    """Abstract interface for Audio-to-Lyric forced alignment engines."""

    @abstractmethod
    def align(
        self,
        audio_path: Path,
        canonical_lyrics: str,
        *,
        asr_result: Optional[ASRResult] = None,
        language: str = "vi",
    ) -> AlignmentResult:
        """Reconcile canonical lyrics against audio & ASR evidence and output aligned lines."""
        pass


@dataclass
class StructureAnalysisResult:
    structure: SongStructure
    detected_bpm: Optional[float] = None
    detected_key: Optional[str] = None
    confidence: float = 1.0


class StructureProvider(ABC):
    """Abstract interface for Song Structure Discovery (Verses, Choruses, Hooks, Repeats)."""

    @abstractmethod
    def analyze_structure(
        self,
        audio_path: Path,
        *,
        asr_result: Optional[ASRResult] = None,
        canonical_lyrics: Optional[str] = None,
    ) -> StructureAnalysisResult:
        """Analyze repetition, melody, and lyric patterns to discover song structure."""
        pass


@dataclass
class DiarizationSegment:
    speaker: str
    start: float
    end: float
    confidence: float = 1.0


@dataclass
class DiarizationResult:
    speakers: List[str] = field(default_factory=list)
    segments: List[DiarizationSegment] = field(default_factory=list)


class DiarizationProvider(ABC):
    """Abstract interface for speaker diarization (duet, multi-singer, overlapping vocals)."""

    @abstractmethod
    def diarize(
        self,
        vocals_path: Path,
        *,
        num_speakers: Optional[int] = None,
    ) -> DiarizationResult:
        """Distinguish different vocalists and assign speaker IDs."""
        pass
