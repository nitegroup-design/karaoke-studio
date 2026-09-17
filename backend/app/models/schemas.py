from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Literal, Optional
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class ReviewReason(str, Enum):
    MISSING_TIMING = "missing_timing"
    ZERO_DURATION = "zero_duration"
    OVERLAP = "overlap"
    LONG_DURATION = "long_duration"
    UNALIGNED_TEXT = "unaligned_text"


class WordTimestamp(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid4()))
    word: str
    start: Optional[float] = None
    end: Optional[float] = None
    review_required: bool = False
    review_reasons: List[ReviewReason] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_timing(self) -> "WordTimestamp":
        reasons = [reason for reason in self.review_reasons if reason == ReviewReason.UNALIGNED_TEXT]
        if self.start is None or self.end is None:
            reasons.append(ReviewReason.MISSING_TIMING)
        elif self.end <= self.start:
            reasons.append(ReviewReason.ZERO_DURATION)
        elif self.end - self.start > 4.0:
            reasons.append(ReviewReason.LONG_DURATION)
        self.review_reasons = list(dict.fromkeys(reasons))
        self.review_required = bool(self.review_reasons)
        return self


class LyricLine(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid4()))
    start: Optional[float] = None
    end: Optional[float] = None
    text: str
    words: List[WordTimestamp] = Field(default_factory=list)
    locked: bool = False
    review_required: bool = False
    review_reasons: List[ReviewReason] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_line(self) -> "LyricLine":
        reasons = [reason for reason in self.review_reasons if reason == ReviewReason.UNALIGNED_TEXT]
        if self.start is None or self.end is None:
            reasons.append(ReviewReason.MISSING_TIMING)
        elif self.end <= self.start:
            reasons.append(ReviewReason.ZERO_DURATION)

        previous_end: Optional[float] = None
        for word in self.words:
            if previous_end is not None and word.start is not None and word.start < previous_end - 0.001:
                reasons.append(ReviewReason.OVERLAP)
                word.review_required = True
                if ReviewReason.OVERLAP not in word.review_reasons:
                    word.review_reasons.append(ReviewReason.OVERLAP)
            if word.end is not None:
                previous_end = max(previous_end or word.end, word.end)

        if any(word.review_required for word in self.words):
            self.review_required = True
        self.review_reasons = list(dict.fromkeys(reasons))
        self.review_required = bool(self.review_reasons) or any(word.review_required for word in self.words)
        return self


class LyricsData(BaseModel):
    model_config = ConfigDict(extra="ignore")

    song_id: str
    title: str
    version: int = 0
    updated_at: str = Field(default_factory=utc_now_iso)
    canonical_text: Optional[str] = None
    lines: List[LyricLine] = Field(default_factory=list)

    @field_validator("version")
    @classmethod
    def valid_version(cls, value: int) -> int:
        if value < 0:
            raise ValueError("version must be non-negative")
        return value


class StatusResponse(BaseModel):
    song_id: str
    status: Dict[str, Any]
    active_jobs: List[Dict[str, Any]] = Field(default_factory=list)


class ProcessOptions(BaseModel):
    lyrics_text: Optional[str] = None
    model_preset: str = "quality"
    base_version: Optional[int] = None

    @field_validator("model_preset")
    @classmethod
    def normalize_model(cls, value: str) -> str:
        if value in ("large-v3", "large", "quality"):
            return "quality"
        return "draft"


class AlignmentRequest(ProcessOptions):
    line_ids: Optional[List[str]] = None


class StyleOptions(BaseModel):
    font_family: str = "Be Vietnam Pro"
    primary_color: str = "#F7F3EB"
    secondary_color: str = "#FFB547"
    outline_color: str = "#201810"
    effect: Literal["smooth", "glow", "pop"] = "smooth"


class ExportRequest(BaseModel):
    preset: Literal["classic", "modern"] = "classic"
    lyrics_version: Optional[int] = None
    style: Optional[StyleOptions] = None


class PreviewAssRequest(BaseModel):
    preset: Literal["classic", "modern"] = "classic"
    lyrics: Optional[LyricsData] = None
    style: Optional[StyleOptions] = None


class JobResponse(BaseModel):
    message: str
    song_id: str
    job_id: str
    export_id: Optional[str] = None
