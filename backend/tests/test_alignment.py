import unittest

from app.models.schemas import LyricLine, LyricsData, WordTimestamp
from app.services.transcriber import reconcile_canonical_lines


class AlignmentTests(unittest.TestCase):
    def test_canonical_lines_retain_repetitions_missing_text_and_locks(self):
        canonical = "Điệp khúc\n\nCâu rất nhanh\nĐiệp khúc"
        locked = LyricLine(
            id="locked",
            start=9,
            end=10,
            text="Sửa tay",
            locked=True,
            words=[WordTimestamp(word="Sửa tay", start=9, end=10)],
        )
        existing = LyricsData(
            song_id="song",
            title="title",
            lines=[locked],
        )
        aligned = [
            LyricLine(start=1, end=2, text="AI 1", words=[WordTimestamp(word="AI", start=1, end=2)]),
            LyricLine(start=3, end=4, text="AI 2", words=[WordTimestamp(word="AI", start=3, end=4)]),
        ]
        result = reconcile_canonical_lines(canonical, aligned, existing)

        self.assertEqual([line.text for line in result], ["Sửa tay", "Câu rất nhanh", "Điệp khúc"])
        self.assertEqual(result[0].id, "locked")
        self.assertTrue(result[0].locked)
        self.assertTrue(result[2].review_required)
        self.assertEqual([word.word for word in result[2].words], ["Điệp", "khúc"])


    def test_clean_headers_and_avoid_domino_desync(self):
        canonical = """
        [Lời bài hát "TEST"]
        [Verse 1]
        Kể từ khi gặp em
        Đoạn ca sĩ bỏ qua không hề hát
        [Chorus]
        Điệp khúc bùng cháy
        """
        # ASR heard intro "yeah yeah", then "Kể từ khi gặp em", then directly "Điệp khúc bùng cháy"
        aligned = [
            LyricLine(
                start=0.5,
                end=1.2,
                text="yeah yeah",
                words=[WordTimestamp(word="yeah", start=0.5, end=0.8), WordTimestamp(word="yeah", start=0.8, end=1.2)],
            ),
            LyricLine(
                start=2.0,
                end=3.5,
                text="kể từ khi gặp em",
                words=[
                    WordTimestamp(word="kể", start=2.0, end=2.3),
                    WordTimestamp(word="từ", start=2.3, end=2.5),
                    WordTimestamp(word="khi", start=2.5, end=2.8),
                    WordTimestamp(word="gặp", start=2.8, end=3.1),
                    WordTimestamp(word="em", start=3.1, end=3.5),
                ],
            ),
            LyricLine(
                start=10.0,
                end=12.0,
                text="điệp khúc bùng cháy",
                words=[
                    WordTimestamp(word="điệp", start=10.0, end=10.4),
                    WordTimestamp(word="khúc", start=10.4, end=10.8),
                    WordTimestamp(word="bùng", start=10.8, end=11.3),
                    WordTimestamp(word="cháy", start=11.3, end=12.0),
                ],
            ),
        ]
        result = reconcile_canonical_lines(canonical, aligned, None)

        # Headers [Verse 1] and [Chorus] are stripped
        self.assertEqual(len(result), 3)
        self.assertEqual(result[0].text, "Kể từ khi gặp em")
        self.assertEqual(result[1].text, "Đoạn ca sĩ bỏ qua không hề hát")
        self.assertEqual(result[2].text, "Điệp khúc bùng cháy")

        # Line 0 starts at 2.0 (NOT 0.5 intro!)
        self.assertEqual(result[0].start, 2.0)
        self.assertEqual(result[0].end, 3.5)

        # Line 1 is unaligned without disrupting Line 2
        self.assertTrue(result[1].review_required)
        self.assertIsNone(result[1].start)

        # Line 2 matches the chorus at 10.0
        self.assertEqual(result[2].start, 10.0)
        self.assertEqual(result[2].end, 12.0)


if __name__ == "__main__":
    unittest.main()
