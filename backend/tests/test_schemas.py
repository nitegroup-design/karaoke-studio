import unittest

from app.models.schemas import (
    ConfidenceBreakdown,
    LyricLine,
    LyricSection,
    LyricSyllable,
    LyricsData,
    OccurrenceMatch,
    ReviewHistoryEntry,
    ReviewReason,
    SectionOccurrence,
    SectionType,
    SongStructure,
    VocalActivityType,
    WordTimestamp,
)


class SchemaHierarchyTests(unittest.TestCase):
    def test_confidence_breakdown_computation(self):
        conf = ConfidenceBreakdown(text=0.90, audio=0.80, timing=0.85, structure=0.95)
        # Expected: 0.90*0.3 + 0.80*0.25 + 0.85*0.25 + 0.95*0.2 = 0.27 + 0.20 + 0.2125 + 0.19 = 0.8725 -> 0.873
        self.assertAlmostEqual(conf.overall, 0.873, places=3)

    def test_word_timestamp_low_confidence_triggers_review(self):
        word = WordTimestamp(word="hát", start=1.0, end=1.5, confidence=0.60)
        self.assertTrue(word.review_required)
        self.assertIn(ReviewReason.LOW_CONFIDENCE, word.review_reasons)

    def test_word_timestamp_syllables(self):
        syl1 = LyricSyllable(text="Ka", start=1.0, end=1.2, phonemes=["k", "a"])
        syl2 = LyricSyllable(text="ra", start=1.2, end=1.4, phonemes=["r", "a"])
        word = WordTimestamp(word="Kara", start=1.0, end=1.4, syllables=[syl1, syl2])
        self.assertEqual(len(word.syllables), 2)
        self.assertEqual(word.syllables[0].text, "Ka")

    def test_lyric_line_speaker_and_vocal_type(self):
        line = LyricLine(
            start=2.0,
            end=4.0,
            text="Yeah oh baby",
            speaker="vocalist_b",
            vocal_type=VocalActivityType.ADLIB,
            words=[
                WordTimestamp(word="Yeah", start=2.0, end=2.5),
                WordTimestamp(word="oh", start=2.6, end=3.0),
                WordTimestamp(word="baby", start=3.1, end=3.9),
            ],
        )
        self.assertEqual(line.speaker, "vocalist_b")
        self.assertEqual(line.vocal_type, VocalActivityType.ADLIB)
        self.assertFalse(line.review_required)

    def test_section_occurrence_and_song_structure(self):
        # Occurrence 1: Chorus at 30s
        occ1 = SectionOccurrence(
            section_id="sec-chorus",
            index=1,
            start=30.0,
            end=45.0,
            match_type=OccurrenceMatch.EXACT,
            lines=[
                LyricLine(
                    start=30.0,
                    end=35.0,
                    text="Anh yêu em",
                    words=[
                        WordTimestamp(word="Anh", start=30.0, end=31.0),
                        WordTimestamp(word="yêu", start=31.2, end=32.5),
                        WordTimestamp(word="em", start=32.6, end=34.5),
                    ],
                )
            ],
        )
        # Occurrence 2: Chorus variation at 90s
        occ2 = SectionOccurrence(
            section_id="sec-chorus",
            index=2,
            start=90.0,
            end=105.0,
            match_type=OccurrenceMatch.VARIATION,
            variation_notes="Thêm câu adlib cuối",
            lines=[
                LyricLine(
                    start=90.0,
                    end=95.0,
                    text="Anh vẫn yêu em",
                    words=[
                        WordTimestamp(word="Anh", start=90.0, end=91.0),
                        WordTimestamp(word="vẫn", start=91.1, end=92.0),
                        WordTimestamp(word="yêu", start=92.1, end=93.0),
                        WordTimestamp(word="em", start=93.1, end=94.5),
                    ],
                )
            ],
        )

        section = LyricSection(
            id="sec-chorus",
            type=SectionType.CHORUS,
            label="Điệp khúc",
            canonical_lines=["Anh yêu em"],
            occurrences=[occ1, occ2],
        )

        structure = SongStructure(sections=[section], bpm=120.0, key="C Major", duration=180.0)
        flattened = structure.flatten_lines()
        self.assertEqual(len(flattened), 2)
        self.assertEqual(flattened[0].text, "Anh yêu em")
        self.assertEqual(flattened[1].text, "Anh vẫn yêu em")
        self.assertEqual(flattened[0].start, 30.0)
        self.assertEqual(flattened[1].start, 90.0)

    def test_lyrics_data_backward_compatibility(self):
        raw = {
            "song_id": "test-song",
            "title": "Test Title",
            "version": 1,
            "lines": [
                {
                    "text": "Line 1",
                    "start": 1.0,
                    "end": 2.0,
                    "words": [{"word": "Line", "start": 1.0, "end": 1.5}, {"word": "1", "start": 1.5, "end": 2.0}],
                }
            ],
        }
        lyrics = LyricsData.model_validate(raw)
        self.assertEqual(lyrics.song_id, "test-song")
        self.assertEqual(len(lyrics.lines), 1)
        self.assertEqual(lyrics.speakers, ["main"])
        self.assertEqual(len(lyrics.adlibs), 0)
        self.assertIsNone(lyrics.structure)


if __name__ == "__main__":
    unittest.main()
