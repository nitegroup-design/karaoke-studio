import json
import tempfile
import unittest
from pathlib import Path

from app.models.schemas import LyricLine, LyricsData, WordTimestamp
from app.services.storage import DuplicateJob, StudioStore, VersionConflict


def sample_lyrics(song_id: str, canonical: str = "A\n\nB\nA") -> LyricsData:
    return LyricsData(
        song_id=song_id,
        title="Bài thử.mp3",
        canonical_text=canonical,
        lines=[
            LyricLine(start=1, end=2, text="A", words=[WordTimestamp(word="A", start=1, end=2)]),
            LyricLine(start=3, end=4, text="B", words=[WordTimestamp(word="B", start=3, end=4)]),
            LyricLine(start=5, end=6, text="A", words=[WordTimestamp(word="A", start=5, end=6)]),
        ],
    )


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.store = StudioStore(self.root / "studio.db")
        self.store.initialize()
        self.store.create_song("song-1", "Bài thử.mp3", "song-1.mp3")

    def tearDown(self):
        self.temp.cleanup()

    def test_versions_are_immutable_and_survive_new_store_instance(self):
        first = self.store.save_lyrics(sample_lyrics("song-1"), expected_version=0, source="test")
        self.assertEqual(first.version, 1)
        self.assertEqual(first.canonical_text, "A\n\nB\nA")

        edited = first.model_copy(deep=True)
        edited.title = "Tên mới"
        second = self.store.save_lyrics(edited, expected_version=1, source="editor")
        self.assertEqual(second.version, 2)
        with self.assertRaises(VersionConflict):
            self.store.save_lyrics(first, expected_version=1, source="stale_job")

        reopened = StudioStore(self.root / "studio.db")
        reopened.initialize()
        self.assertEqual(reopened.get_lyrics("song-1").version, 2)
        self.assertEqual(reopened.get_lyrics("song-1", 1).canonical_text, "A\n\nB\nA")

    def test_duplicate_job_guard_and_percent_progress_contract(self):
        job = self.store.create_job("song-1", "alignment", {"model_preset": "draft"})
        with self.assertRaises(DuplicateJob):
            self.store.create_job("song-1", "alignment", {})
        updated = self.store.update_job(job["id"], status="processing", progress=42.5)
        self.assertEqual(updated["progress"], 42.5)
        clamped = self.store.update_job(job["id"], progress=999)
        self.assertEqual(clamped["progress"], 100)

    def test_imports_legacy_files_without_rewriting_them(self):
        uploads = self.root / "uploads"
        outputs = self.root / "outputs"
        uploads.mkdir()
        song_id = "legacy-song"
        (uploads / f"{song_id}.mp3").write_bytes(b"legacy")
        song_dir = outputs / song_id
        song_dir.mkdir(parents=True)
        legacy = sample_lyrics(song_id).model_dump(mode="json")
        legacy["version"] = 0
        lyrics_path = song_dir / "lyrics.json"
        original = json.dumps(legacy, ensure_ascii=False, indent=2)
        lyrics_path.write_text(original, encoding="utf-8")

        imported = self.store.import_existing_library(uploads, outputs)
        self.assertEqual(imported, {"songs": 1, "lyrics": 1})
        self.assertEqual(lyrics_path.read_text(encoding="utf-8"), original)
        self.assertEqual(self.store.get_lyrics(song_id).canonical_text, "A\n\nB\nA")

    def test_song_structure_persistence(self):
        from app.models.schemas import SongStructure, LyricSection, SectionType, SectionOccurrence
        occ = SectionOccurrence(section_id="sec-1", index=1, start=10.0, end=20.0)
        section = LyricSection(id="sec-1", type=SectionType.VERSE, label="Verse 1", occurrences=[occ])
        struct = SongStructure(sections=[section], bpm=128.0, key="G Minor")
        self.store.save_song_structure("song-1", struct)

        loaded = self.store.get_song_structure("song-1")
        self.assertIsNotNone(loaded)
        self.assertEqual(len(loaded.sections), 1)
        self.assertEqual(loaded.sections[0].label, "Verse 1")
        self.assertEqual(loaded.bpm, 128.0)
        self.assertEqual(loaded.key, "G Minor")

    def test_review_history_audit_trail(self):
        entry = self.store.record_review_action(
            "song-1",
            action="CHANGE_WORD_END",
            target_id="w-123",
            old_value=12.4,
            new_value=12.9,
            user_id="user_admin",
        )
        self.assertEqual(entry.action, "CHANGE_WORD_END")
        history = self.store.get_review_history("song-1")
        self.assertEqual(len(history), 1)
        self.assertEqual(history[0].target_id, "w-123")
        self.assertEqual(history[0].old_value, 12.4)
        self.assertEqual(history[0].new_value, 12.9)

    def test_job_checkpoint_and_resume(self):
        job = self.store.create_job("song-1", "process_all", {})
        self.store.checkpoint_job(
            job["id"],
            stage="transcription",
            checkpoint_data={"whisper_segments": 14, "last_timestamp": 45.2},
            progress=55.0,
            message="Transcribed 14 segments",
        )
        ckpt = self.store.get_job_checkpoint(job["id"])
        self.assertEqual(ckpt["stage"], "transcription")
        self.assertEqual(ckpt["progress"], 55.0)
        self.assertEqual(ckpt["checkpoint"]["whisper_segments"], 14)


if __name__ == "__main__":
    unittest.main()

