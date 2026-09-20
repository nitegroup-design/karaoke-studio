import math
import struct
import tempfile
import unittest
import wave
from pathlib import Path

from app.models.schemas import VocalActivityType
from app.providers.asr import WhisperASRProvider
from app.providers.base import ASRResult, ASRSegmentResult, ASRWordResult
from app.providers.vocal_activity import EnergyVocalActivityDetector
from app.services.media_analyzer import analyze_media, normalize_audio


def create_synthetic_wav(
    path: Path,
    duration: float = 2.0,
    frequency: float = 440.0,
    sample_rate: int = 16000,
    amplitude: float = 0.5,
) -> Path:
    num_samples = int(duration * sample_rate)
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        frames = bytearray()
        for i in range(num_samples):
            val = int(amplitude * 32767.0 * math.sin(2.0 * math.pi * frequency * i / sample_rate))
            frames.extend(struct.pack("<h", val))
        wf.writeframes(frames)
    return path


class AudioEnginePhase3And4Tests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_media_analyzer_on_wav(self):
        wav_path = self.root / "test_tone.wav"
        create_synthetic_wav(wav_path, duration=1.5, frequency=440.0, sample_rate=16000)

        meta = analyze_media(wav_path)
        self.assertAlmostEqual(meta.duration, 1.5, delta=0.1)
        self.assertEqual(meta.sample_rate, 16000)
        self.assertFalse(meta.has_video)
        self.assertGreaterEqual(meta.audio_tracks_count, 1)

    def test_audio_normalization(self):
        wav_in = self.root / "raw_audio.wav"
        wav_out = self.root / "normalized.wav"
        create_synthetic_wav(wav_in, duration=1.0, frequency=220.0, sample_rate=16000, amplitude=0.1)

        result_path = normalize_audio(wav_in, wav_out, target_lufs=-14.0)
        self.assertTrue(result_path.exists())
        self.assertTrue(wav_in.exists())  # Original intact per Section 7

        meta = analyze_media(result_path)
        self.assertAlmostEqual(meta.duration, 1.0, delta=0.1)
        self.assertEqual(meta.sample_rate, 44100)  # Converted to pristine studio rate

    def test_vocal_activity_detection(self):
        # Create audio with 1s silence, 1s resonant tone (singing), 1s silence
        combined_path = self.root / "mixed_vocal.wav"
        sr = 16000
        num_silent = int(0.6 * sr)
        num_singing = int(1.2 * sr)

        with wave.open(str(combined_path), "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(sr)
            frames = bytearray()
            # Silence
            frames.extend(struct.pack("<h", 0) * num_silent)
            # Singing tone (resonant 440 Hz)
            for i in range(num_singing):
                val = int(0.7 * 32767.0 * math.sin(2.0 * math.pi * 440.0 * i / sr))
                frames.extend(struct.pack("<h", val))
            # Silence
            frames.extend(struct.pack("<h", 0) * num_silent)
            wf.writeframes(frames)

        detector = EnergyVocalActivityDetector(frame_duration=0.05)
        analysis = detector.detect_activity(combined_path)

        self.assertGreater(len(analysis.segments), 0)
        self.assertGreater(analysis.silence_ratio, 0.2)
        # Should detect singing activity during the tone
        activities = [s.activity for s in analysis.segments]
        self.assertIn(VocalActivityType.SINGING, activities)
        self.assertIn(VocalActivityType.SILENCE, activities)

    def test_asr_provider_models_contract(self):
        # Verify ASRResult and WordTimestamp schema integration
        word1 = ASRWordResult(word="Lời", start=1.0, end=1.4, confidence=0.98)
        word2 = ASRWordResult(word="hát", start=1.5, end=2.0, confidence=0.95)
        seg = ASRSegmentResult(
            text="Lời hát",
            start=1.0,
            end=2.0,
            words=[word1, word2],
            confidence=0.965,
            language="vi",
        )
        res = ASRResult(
            segments=[seg],
            language="vi",
            duration=2.0,
            model_name="whisper-large-v3",
            confidence=0.965,
        )

        self.assertEqual(len(res.segments), 1)
        self.assertEqual(len(res.segments[0].words), 2)
        self.assertEqual(res.segments[0].words[0].word, "Lời")
        self.assertAlmostEqual(res.confidence, 0.965)


if __name__ == "__main__":
    unittest.main()
