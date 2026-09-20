import unittest

from app.models.schemas import (
    ConfidenceBreakdown,
    LyricLine,
    LyricSection,
    OccurrenceMatch,
    ReviewReason,
    SectionOccurrence,
    SectionType,
    SongStructure,
    WordTimestamp,
)
from app.providers.base import ASRResult, ASRSegmentResult, ASRWordResult
from app.services.review_engine import generate_review_summary
from app.services.structure_engine import AudioLyricStructureEngine


class StructureAndReviewEngineTests(unittest.TestCase):
    def test_audio_lyric_structure_engine_chorus_repeats(self):
        engine = AudioLyricStructureEngine()
        canonical = """
[Verse 1]
Tôi bước đi

[Chorus]
Hát vang bài ca yêu đời
"""
        # ASR has Chorus at 30s AND repeated Chorus at 90s
        asr = ASRResult(
            segments=[
                ASRSegmentResult(text="Tôi bước đi", start=10.0, end=12.0),
                ASRSegmentResult(text="Hát vang bài ca yêu đời", start=30.0, end=35.0),
                ASRSegmentResult(text="Hát vang bài ca yêu đời", start=90.0, end=95.0),
            ]
        )

        res = engine.analyze_structure(None, asr_result=asr, canonical_lyrics=canonical)
        struct = res.structure

        chorus = next(s for s in struct.sections if s.type == SectionType.CHORUS)
        # Should have found both occurrences (at 30s and 90s)
        self.assertEqual(len(chorus.occurrences), 2)
        self.assertEqual(chorus.occurrences[0].start, 30.0)
        self.assertEqual(chorus.occurrences[1].start, 90.0)

    def test_review_summary_thresholds_and_explanations(self):
        # 1. Perfectly aligned line (conf 0.95 >= 0.90 -> aligned)
        l1 = LyricLine(
            text="Câu một",
            start=1.0,
            end=3.0,
            confidence=ConfidenceBreakdown(text=0.95, audio=0.95, timing=0.95, structure=0.95),
            words=[WordTimestamp(word="Câu", start=1.0, end=1.5), WordTimestamp(word="một", start=1.5, end=3.0)],
        )

        # 2. Line with variation (conf 0.78 -> need review)
        l2 = LyricLine(
            text="Câu hai",
            start=4.0,
            end=6.0,
            confidence=ConfidenceBreakdown(text=0.75, audio=0.80, timing=0.80, structure=0.80),
            review_required=True,
            review_reasons=[ReviewReason.VARIATION_DETECTED],
            words=[WordTimestamp(word="Câu", start=4.0, end=4.5), WordTimestamp(word="hai", start=4.5, end=6.0)],
        )

        # 3. Line omitted (missing timing -> conflict)
        l3 = LyricLine(
            text="Câu ba",
            start=None,
            end=None,
            confidence=ConfidenceBreakdown(text=0.0, audio=0.0, timing=0.0, structure=0.5),
            review_required=True,
            review_reasons=[ReviewReason.MISSING_TIMING, ReviewReason.OMITTED_VOCAL],
            words=[WordTimestamp(word="Câu", start=None, end=None), WordTimestamp(word="ba", start=None, end=None)],
        )

        summary = generate_review_summary([l1, l2, l3])

        self.assertEqual(summary.total_lines, 3)
        self.assertEqual(summary.aligned_count, 1)
        self.assertEqual(summary.need_review_count, 1)
        self.assertEqual(summary.conflicts_count, 1)

        # Explanations generated
        explanations = [item.ai_interpretation for item in summary.items]
        self.assertTrue(any("biến thể" in exp for exp in explanations))
        self.assertTrue(any("không thấy xuất hiện" in exp for exp in explanations))


if __name__ == "__main__":
    unittest.main()
