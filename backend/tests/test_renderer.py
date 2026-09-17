import re
import unittest

from app.models.schemas import LyricLine, LyricsData, ReviewReason, WordTimestamp
from app.services.renderer import escape_ass_text, generate_ass_text, generate_srt_text, karaoke_payload


class RendererTests(unittest.TestCase):
    def test_absolute_gaps_cover_complete_760_centiseconds(self):
        values = [
            ("Chút", 168.71, 169.31),
            ("từng", 169.31, 169.75),
            ("lúc", 171.09, 171.09),
            ("lại", 171.09, 171.27),
            ("gần", 171.27, 171.57),
            ("bí", 171.57, 171.87),
            ("mật,", 171.87, 172.03),
            ("lại", 174.73, 174.99),
            ("gần", 174.99, 175.33),
            ("bí", 175.33, 175.55),
            ("mật", 175.55, 175.73),
            ("của", 175.73, 175.93),
            ("anh", 175.93, 176.31),
        ]
        line = LyricLine(
            start=168.71,
            end=176.31,
            text="Chút từng lúc lại gần bí mật, lại gần bí mật của anh",
            words=[WordTimestamp(word=word, start=start, end=end) for word, start, end in values],
        )
        payload = karaoke_payload(line)
        timings = [int(value) for value in re.findall(r"\{\\k(?:f)?(\d+)\}", payload)]

        self.assertEqual(sum(timings), 760)
        self.assertIn(r"{\k134}", payload)
        self.assertIn(r"{\k270}", payload)
        self.assertIn(r"{\kf0}lúc", payload)
        self.assertTrue(line.words[2].review_required)
        self.assertIn(ReviewReason.ZERO_DURATION, line.words[2].review_reasons)

    def test_untimed_and_out_of_bounds_words_remain_visible_without_overflow(self):
        line = LyricLine(
            start=10,
            end=12,
            text="một chữ thiếu",
            words=[
                WordTimestamp(word="một", start=9, end=10.5),
                WordTimestamp(word="chữ", start=None, end=None),
                WordTimestamp(word="thiếu", start=13, end=14),
            ],
        )
        payload = karaoke_payload(line)
        timings = [int(value) for value in re.findall(r"\{\\k(?:f)?(\d+)\}", payload)]
        self.assertEqual(sum(timings), 200)
        self.assertIn(r"{\kf0}chữ", payload)
        self.assertIn("thiếu", payload)

    def test_ass_escapes_user_text_and_both_presets_share_generator(self):
        line = LyricLine(
            start=1,
            end=2,
            text=r"A {test}\B",
            words=[WordTimestamp(word=r"A {test}\B", start=1, end=2)],
        )
        lyrics = LyricsData(song_id="song", title="title", lines=[line])
        self.assertEqual(escape_ass_text(line.text), r"A \{test\}\\B")
        self.assertIn(r"A \{test\}\\B", generate_ass_text(lyrics, "classic"))
        self.assertIn(r"A \{test\}\\B", generate_ass_text(lyrics, "modern"))
        self.assertIn("00:00:01,000 --> 00:00:02,000", generate_srt_text(lyrics))

    def test_corrected_timing_clears_automatic_review_reason(self):
        broken = WordTimestamp(word="sửa", start=1, end=1)
        self.assertTrue(broken.review_required)
        corrected = WordTimestamp.model_validate({**broken.model_dump(), "end": 1.5})
        self.assertFalse(corrected.review_required)
        self.assertEqual(corrected.review_reasons, [])


    def test_custom_style_and_colors(self):
        from app.models.schemas import StyleOptions
        from app.services.renderer import hex_to_ass_color

        # Test hex color conversion
        self.assertEqual(hex_to_ass_color("#FFB547"), "&H0047B5FF&")
        self.assertEqual(hex_to_ass_color("#F7F3EB"), "&H00EBF3F7&")
        self.assertEqual(hex_to_ass_color("#201810"), "&H00101820&")

        # Test ASS generation with custom style
        style = StyleOptions(
            font_family="Montserrat",
            primary_color="#F7F3EB",
            secondary_color="#FF2A85",
            outline_color="#160822",
            effect="glow",
        )
        line = LyricLine(
            start=1,
            end=2,
            text="Hát vang",
            words=[WordTimestamp(word="Hát", start=1, end=1.5), WordTimestamp(word="vang", start=1.5, end=2)],
        )
        lyrics = LyricsData(song_id="song", title="title", lines=[line])
        ass_text = generate_ass_text(lyrics, "classic", style=style)

        self.assertIn("Montserrat", ass_text)
        self.assertIn(hex_to_ass_color("#FF2A85"), ass_text)
        self.assertIn(r"\fad(180,150)", ass_text)


if __name__ == "__main__":
    unittest.main()
