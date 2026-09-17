import array
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from app.models.schemas import LyricLine, LyricsData, WordTimestamp
from app.services.alignment import hybrid_align_canonical_lyrics, normalize_word
from app.services.waveform import calculate_peaks, waveform_data, _cached_waveform
from app.services.transcriber import transcribed_vocal


class OptimizationTests(unittest.TestCase):
    def test_unknown_word_does_not_shift_valid_asr_anchor(self):
        asr = [LyricLine(text='Em về', words=[WordTimestamp(word='Em', start=1, end=2), WordTimestamp(word='về', start=2, end=3)])]
        result = hybrid_align_canonical_lyrics('Em sẽ về', asr)[0]
        self.assertEqual([w.word for w in result.words], ['Em', 'sẽ', 'về'])
        self.assertIsNone(result.words[1].start)
        self.assertEqual(result.words[2].start, 2)
        self.assertEqual(result.end, 3)

    def test_insert_before_locked_line_preserves_its_identity_and_new_text(self):
        locked = LyricLine(id='lock', text='Em về', start=5, end=6, locked=True)
        existing = LyricsData(song_id='s', title='t', lines=[locked])
        result = hybrid_align_canonical_lyrics('Câu mới\nEm về', [], existing)
        self.assertEqual([line.text for line in result], ['Câu mới', 'Em về'])
        self.assertEqual(result[1].id, 'lock')
        self.assertEqual(result[1].start, 5)
        self.assertTrue(result[1].locked)

    def test_vietnamese_unicode_and_long_repeated_chorus(self):
        self.assertEqual(normalize_word('về'), normalize_word('ve\u0302\u0300'))
        tokens = ['Em', 'về'] * 130
        words = [WordTimestamp(word=w, start=i, end=i+.5) for i, w in enumerate(tokens)]
        result = hybrid_align_canonical_lyrics(' '.join(tokens), [LyricLine(text='', words=words)])[0]
        self.assertEqual(len(result.words), 260)
        self.assertEqual(result.words[-1].start, 259)

    def test_peaks_handle_tiny_or_silent_audio(self):
        self.assertEqual(calculate_peaks([], 100), [])
        self.assertEqual(calculate_peaks([0, -32768], 100), [0, 1])
        self.assertEqual(calculate_peaks([0]*100, 32), [0]*32)

    def test_waveform_cache_invalidates_when_audio_is_replaced(self):
        _cached_waveform.cache_clear()
        with tempfile.TemporaryDirectory() as temp:
            audio = Path(temp) / 'test.wav'; audio.write_bytes(b'old')
            with patch('app.services.waveform.decode_mono_samples', return_value=array.array('h', [2, 3])) as decode:
                self.assertIn('peaks', waveform_data(audio, 100))
                waveform_data(audio, 100)
                self.assertEqual(decode.call_count, 1)
                audio.write_bytes(b'new audio')
                waveform_data(audio, 100)
                self.assertEqual(decode.call_count, 2)

    def test_asr_cache_reuses_model_result_and_invalidates_per_audio_and_preset(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); audio = root / 'vocal.wav'; audio.write_bytes(b'1')
            word = SimpleNamespace(word='Em', start=1, end=2)
            result = SimpleNamespace(segments=[SimpleNamespace(text='Em', start=1, end=2, words=[word])])
            with patch('app.services.transcriber.OUTPUTS_DIR', root), patch('app.services.transcriber.get_model') as model:
                model.return_value.transcribe.return_value = result
                transcribed_vocal('song', audio, 'draft')
                transcribed_vocal('song', audio, 'draft')
                self.assertEqual(model.call_count, 1)
                transcribed_vocal('song', audio, 'quality')
                self.assertEqual(model.call_count, 2)
                audio.write_bytes(b'2 changed')
                transcribed_vocal('song', audio, 'draft')
                self.assertEqual(model.call_count, 3)


if __name__ == '__main__':
    unittest.main()
