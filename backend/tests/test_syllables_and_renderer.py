import unittest

from app.models.schemas import LyricLine, LyricsData, WordTimestamp
from app.services.renderer import generate_ass_text, generate_lrc_text, generate_srt_text
from app.services.syllable_alignment import (
    align_word_syllables,
    apply_melisma_gap_bridging,
    process_line_syllables_and_melisma,
    segment_word_into_syllables,
)


class SyllablesAndRendererTests(unittest.TestCase):
    def test_syllable_segmentation_and_alignment(self):
        # Vietnamese syllable
        syls_vi = segment_word_into_syllables("hát", language="vi")
        self.assertEqual(syls_vi, ["hát"])

        # Hyphenated word
        syls_hyphen = segment_word_into_syllables("ka-ra-o-ke", language="vi")
        self.assertEqual(syls_hyphen, ["ka", "ra", "o", "ke"])

        # Alignment duration split
        word = WordTimestamp(word="ka-ra", start=1.0, end=2.0)
        aligned_syls = align_word_syllables(word, language="vi")
        self.assertEqual(len(aligned_syls), 2)
        self.assertEqual(aligned_syls[0].start, 1.0)
        self.assertEqual(aligned_syls[0].end, 1.5)
        self.assertEqual(aligned_syls[1].start, 1.5)
        self.assertEqual(aligned_syls[1].end, 2.0)

    def test_melisma_gap_bridging(self):
        # Line with a 0.3s breath/singing gap between words (should be bridged)
        line = LyricLine(
            text="yêu em",
            words=[
                WordTimestamp(word="yêu", start=1.0, end=1.5),
                WordTimestamp(word="em", start=1.8, end=2.5),  # gap = 0.3s
            ],
        )
        bridged = apply_melisma_gap_bridging(line, max_gap=0.85, min_breath_gap=0.03)
        # Word 1 should stretch up to 1.8 - 0.03 = 1.77
        self.assertAlmostEqual(bridged.words[0].end, 1.77, places=2)
        self.assertEqual(bridged.words[1].start, 1.8)

    def test_lrc_export_standard_and_enhanced(self):
        lyrics = LyricsData(
            song_id="s-1",
            title="Tình Ca",
            lines=[
                LyricLine(
                    text="Anh yêu em",
                    start=62.5,
                    end=65.0,
                    words=[
                        WordTimestamp(word="Anh", start=62.5, end=63.0),
                        WordTimestamp(word="yêu", start=63.2, end=64.0),
                        WordTimestamp(word="em", start=64.1, end=65.0),
                    ],
                )
            ],
        )

        std_lrc = generate_lrc_text(lyrics, enhanced=False)
        self.assertIn("[01:02.50]Anh yêu em", std_lrc)

        enh_lrc = generate_lrc_text(lyrics, enhanced=True)
        self.assertIn("[01:02.50]<01:02.50>Anh <01:03.20>yêu <01:04.10>em", enh_lrc)

    def test_renderer_multi_presets(self):
        lyrics = LyricsData(
            song_id="s-1",
            title="Tình Ca",
            lines=[LyricLine(text="Hát vang", start=1.0, end=3.0, words=[WordTimestamp(word="Hát", start=1.0, end=2.0)])],
        )

        # Classic preset
        ass_classic = generate_ass_text(lyrics, preset="classic")
        self.assertIn("Style: ClassicTop", ass_classic)

        # Modern Apple Music preset
        ass_modern = generate_ass_text(lyrics, preset="modern")
        self.assertIn("Style: ModernFocus", ass_modern)

        # Neon preset
        ass_neon = generate_ass_text(lyrics, preset="neon")
        self.assertIn("Style: ModernFocus", ass_neon)

        # Cinema preset
        ass_cinema = generate_ass_text(lyrics, preset="cinema")
        self.assertIn("Style: ClassicTop", ass_cinema)


if __name__ == "__main__":
    unittest.main()
