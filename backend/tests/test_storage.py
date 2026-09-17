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


if __name__ == "__main__":
    unittest.main()
