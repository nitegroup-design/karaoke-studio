from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional
from uuid import uuid4

from app.models.schemas import (
    ConfidenceBreakdown,
    LyricLine,
    ReviewReason,
    SongStructure,
)


@dataclass
class ReviewItemModel:
    id: str
    line_id: str
    word_id: Optional[str]
    timestamp: Optional[float]
    reason: ReviewReason
    source_text: str
    asr_text: Optional[str]
    ai_interpretation: str
    confidence: float
    status: str = "pending"  # pending, resolved, ignored
    recommendation: str = "Kiểm tra lại âm thanh."


@dataclass
class ReviewSummary:
    total_lines: int = 0
    aligned_count: int = 0
    need_review_count: int = 0
    conflicts_count: int = 0
    items: List[ReviewItemModel] = field(default_factory=list)


def generate_review_summary(
    lines: List[LyricLine],
    adlibs: Optional[List[LyricLine]] = None,
) -> ReviewSummary:
    """Evaluate lines against decision thresholds (>=0.90 accept, 0.70-0.89 suggest, <0.70 review)

    and compile clear explanations of discrepancies.
    """
    total = len(lines)
    aligned = 0
    needs_review = 0
    conflicts = 0
    items: list[ReviewItemModel] = []

    for line in lines:
        conf = line.confidence.overall if line.confidence else 1.0

        if not line.review_required and conf >= 0.90:
            aligned += 1
            continue

        if conf < 0.70 or ReviewReason.MISSING_TIMING in line.review_reasons or ReviewReason.OMITTED_VOCAL in line.review_reasons:
            conflicts += 1
        else:
            needs_review += 1

        for reason in line.review_reasons:
            explanation = "Độ tin cậy của AI dưới ngưỡng tự động duyệt."
            rec = "Nghe thử đoạn audio để xác nhận."

            if reason == ReviewReason.VARIATION_DETECTED:
                explanation = f"Phát hiện biến thể lời hát. Nguồn: “{line.text}”"
                rec = "Xem xét giữ lời nguồn hay sửa theo ca sĩ hát."
            elif reason == ReviewReason.OMITTED_VOCAL:
                explanation = f"Câu hát “{line.text}” không thấy xuất hiện trong bản thu âm."
                rec = "Xác nhận câu này có bị ca sĩ lược bỏ không."
            elif reason == ReviewReason.MISSING_TIMING:
                explanation = "Câu hát chưa có mốc thời gian bắt đầu hoặc kết thúc."
                rec = "Kéo mốc trên timeline để định vị câu."
            elif reason == ReviewReason.OVERLAP:
                explanation = "Mốc thời gian của các từ bị chồng lấn nhau."
                rec = "Điều chỉnh ranh giới từ trên waveform."
            elif reason == ReviewReason.LOW_CONFIDENCE:
                explanation = f"Độ tin cậy tổng thể của AI thấp ({int(conf * 100)}%)."
                rec = "Nghe lại để kiểm chứng từ ngữ."

            items.append(
                ReviewItemModel(
                    id=str(uuid4()),
                    line_id=line.id,
                    word_id=None,
                    timestamp=line.start,
                    reason=reason,
                    source_text=line.text,
                    asr_text=None,
                    ai_interpretation=explanation,
                    confidence=conf,
                    recommendation=rec,
                )
            )

    # Add ad-libs as review items
    if adlibs:
        for adlib in adlibs:
            needs_review += 1
            items.append(
                ReviewItemModel(
                    id=str(uuid4()),
                    line_id=adlib.id,
                    word_id=None,
                    timestamp=adlib.start,
                    reason=ReviewReason.EXTRA_VOCAL,
                    source_text="",
                    asr_text=adlib.text,
                    ai_interpretation=f"Phát hiện âm thanh/ad-lib thêm trong audio: “{adlib.text}”",
                    confidence=0.82,
                    recommendation="Thêm vào làn ad-lib hoặc bỏ qua nếu là tiếng ồn.",
                )
            )

    return ReviewSummary(
        total_lines=total,
        aligned_count=aligned,
        need_review_count=needs_review,
        conflicts_count=conflicts,
        items=items,
    )
