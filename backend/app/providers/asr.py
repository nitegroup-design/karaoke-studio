from __future__ import annotations

from pathlib import Path
from typing import Optional

from app.config import MODEL_PRESETS
from app.providers.base import ASRProvider, ASRResult, ASRSegmentResult, ASRWordResult


class WhisperASRProvider(ASRProvider):
    """Speech Recognition Engine supporting faster-whisper and stable-whisper models

    with mandatory word-level timestamps and confidence calculation.
    """

    def __init__(
        self,
        preset: str = "quality",
        device: str = "cpu",
        compute_type: str = "int8",
    ):
        self.preset = preset
        self.device = device
        self.compute_type = compute_type
        self.model_name = MODEL_PRESETS.get(preset, "large-v3" if preset == "quality" else "base")
        self._model = None

    def _get_model(self):
        if self._model is None:
            import stable_whisper

            self._model = stable_whisper.load_faster_whisper(
                self.model_name,
                device=self.device,
                compute_type=self.compute_type,
            )
        return self._model

    def transcribe(
        self,
        audio_path: Path,
        *,
        language: Optional[str] = "vi",
        word_timestamps: bool = True,
        vad_filter: bool = True,
        initial_prompt: Optional[str] = None,
    ) -> ASRResult:
        if not audio_path.exists():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        model = self._get_model()

        # Run transcription with word timestamps enabled
        result = model.transcribe(
            str(audio_path),
            language=language,
            word_timestamps=word_timestamps,
            vad_filter=vad_filter,
            initial_prompt=initial_prompt,
        )

        detected_lang = getattr(result, "language", language or "vi")
        segments: list[ASRSegmentResult] = []
        all_word_confs: list[float] = []

        for seg in getattr(result, "segments", []) or []:
            words: list[ASRWordResult] = []
            for w in getattr(seg, "words", []) or []:
                w_start = round(float(getattr(w, "start", 0.0)), 3)
                w_end = round(float(getattr(w, "end", w_start + 0.2)), 3)
                w_prob = getattr(w, "probability", None)
                conf = round(float(w_prob), 3) if w_prob is not None else 0.92
                words.append(
                    ASRWordResult(
                        word=str(getattr(w, "word", "")).strip(),
                        start=w_start,
                        end=w_end,
                        confidence=conf,
                    )
                )
                all_word_confs.append(conf)

            seg_start = round(float(getattr(seg, "start", 0.0)), 3)
            seg_end = round(float(getattr(seg, "end", seg_start + 1.0)), 3)
            seg_conf = round(sum(w.confidence for w in words) / len(words), 3) if words else 0.90

            segments.append(
                ASRSegmentResult(
                    text=str(getattr(seg, "text", "")).strip(),
                    start=seg_start,
                    end=seg_end,
                    words=words,
                    confidence=seg_conf,
                    language=detected_lang,
                )
            )

        duration = max((s.end for s in segments), default=0.0)
        overall_conf = round(sum(all_word_confs) / len(all_word_confs), 3) if all_word_confs else 0.90

        return ASRResult(
            segments=segments,
            language=detected_lang,
            duration=duration,
            model_name=self.model_name,
            confidence=overall_conf,
        )
