import unittest

from app.models.schemas import (
    OccurrenceMatch,
    ReviewReason,
    SectionType,
    VocalActivityType,
)
from app.providers.base import ASRResult, ASRSegmentResult, ASRWordResult
from app.services.lyric_parser import parse_structured_lyrics
from app.services.reconciliation import reconcile_source_and_asr


class LyricParserAndReconciliationTests(unittest.TestCase):
    def test_parse_structured_lyrics_with_repeats(self):
        raw = """
[Verse 1]
Mặt trời lên cao
Chào ngày mới tươi vui

[Chorus x2]
Hát vang lên nào
Cùng nhau vui ca

Repeat Chorus
"""
        res = parse_structured_lyrics(raw)
        struct = res.structure

        self.assertEqual(len(struct.sections), 2)
        verse = struct.sections[0]
        chorus = struct.sections[1]

        self.assertEqual(verse.type, SectionType.VERSE)
        self.assertEqual(len(verse.occurrences), 1)

        self.assertEqual(chorus.type, SectionType.CHORUS)
        # [Chorus x2] -> 2 occurrences + Repeat Chorus -> 1 occurrence = 3 total occurrences
        self.assertEqual(len(chorus.occurrences), 3)
        self.assertEqual(chorus.canonical_lines, ["Hát vang lên nào", "Cùng nhau vui ca"])

    def test_reconciliation_exact_and_variation(self):
        raw = """
[Verse]
Anh yêu em
Anh nhớ em
"""
        parsed = parse_structured_lyrics(raw)

        asr = ASRResult(
            segments=[
                ASRSegmentResult(
                    text="Anh yêu em",
                    start=10.0,
                    end=12.0,
                    words=[
                        ASRWordResult(word="Anh", start=10.0, end=10.5),
                        ASRWordResult(word="yêu", start=10.6, end=11.2),
                        ASRWordResult(word="em", start=11.3, end=11.9),
                    ],
                ),
                ASRSegmentResult(
                    text="Anh rất nhớ em",  # Variation
                    start=13.0,
                    end=15.0,
                    words=[
                        ASRWordResult(word="Anh", start=13.0, end=13.4),
                        ASRWordResult(word="rất", start=13.5, end=13.9),
                        ASRWordResult(word="nhớ", start=14.0, end=14.4),
                        ASRWordResult(word="em", start=14.5, end=14.9),
                    ],
                ),
            ]
        )

        reconciled_struct, report = reconcile_source_and_asr(parsed.structure, asr)
        occ = reconciled_struct.sections[0].occurrences[0]

        # Line 1: Exact
        self.assertEqual(occ.lines[0].text, "Anh yêu em")
        self.assertEqual(occ.lines[0].start, 10.0)
        self.assertFalse(occ.lines[0].review_required)

        # Line 2: Variation
        self.assertEqual(occ.lines[1].text, "Anh nhớ em")
        self.assertEqual(occ.lines[1].start, 13.0)
        self.assertTrue(occ.lines[1].review_required)
        self.assertIn(ReviewReason.VARIATION_DETECTED, occ.lines[1].review_reasons)

    def test_reconciliation_omitted_line_and_adlib(self):
        raw = """
[Verse]
Câu một
Câu hai không được hát
"""
        parsed = parse_structured_lyrics(raw)

        asr = ASRResult(
            segments=[
                ASRSegmentResult(
                    text="Câu một",
                    start=5.0,
                    end=6.0,
                    words=[ASRWordResult(word="Câu", start=5.0, end=5.4), ASRWordResult(word="một", start=5.5, end=5.9)],
                ),
                ASRSegmentResult(
                    text="Yeah baby",  # Extra vocal / Ad-lib not in text
                    start=7.0,
                    end=7.8,
                    words=[ASRWordResult(word="Yeah", start=7.0, end=7.3), ASRWordResult(word="baby", start=7.4, end=7.7)],
                ),
            ]
        )

        reconciled_struct, report = reconcile_source_and_asr(parsed.structure, asr)
        occ = reconciled_struct.sections[0].occurrences[0]

        # Line 1: matched
        self.assertEqual(occ.lines[0].start, 5.0)

        # Line 2: OMITTED (no hallucinated timestamps!)
        self.assertIsNone(occ.lines[1].start)
        self.assertIsNone(occ.lines[1].end)
        self.assertTrue(occ.lines[1].review_required)
        self.assertIn(ReviewReason.OMITTED_VOCAL, occ.lines[1].review_reasons)

        # Ad-lib detected
        self.assertEqual(len(report.adlibs), 1)
        self.assertEqual(report.adlibs[0].text, "Yeah baby")
        self.assertEqual(report.adlibs[0].vocal_type, VocalActivityType.ADLIB)

    def test_reconciliation_opening_hook(self):
        raw = """
[Verse 1]
Tôi bước đi một mình

[Chorus]
Yêu một người thật khó
Nhớ một người thật đau
"""
        parsed = parse_structured_lyrics(raw)

        # Audio starts with chorus line in intro (< 25s) before Verse 1
        asr = ASRResult(
            segments=[
                ASRSegmentResult(
                    text="Yêu một người thật khó",  # Early chorus line as Opening Hook!
                    start=3.0,
                    end=5.5,
                    words=[
                        ASRWordResult(word="Yêu", start=3.0, end=3.4),
                        ASRWordResult(word="một", start=3.5, end=3.8),
                        ASRWordResult(word="người", start=3.9, end=4.4),
                        ASRWordResult(word="thật", start=4.5, end=4.9),
                        ASRWordResult(word="khó", start=5.0, end=5.4),
                    ],
                ),
                ASRSegmentResult(
                    text="Tôi bước đi một mình",
                    start=28.0,
                    end=30.0,
                    words=[ASRWordResult(word="Tôi", start=28.0, end=28.4)],
                ),
            ]
        )

        reconciled_struct, report = reconcile_source_and_asr(parsed.structure, asr)
        self.assertTrue(report.opening_hook_detected)
        self.assertEqual(reconciled_struct.sections[0].type, SectionType.OPENING_HOOK)
        self.assertEqual(reconciled_struct.sections[0].occurrences[0].start, 3.0)


if __name__ == "__main__":
    unittest.main()
