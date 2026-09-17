import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LyricsSession } from '../src/utils/lyricsSession.ts';
import { normalizeLyrics, normalizeExport } from '../src/api/client.ts';
import { syncLineText, updateCanonicalLine, playbackStateAt } from '../src/utils/lyrics.ts';
import type { LyricsData } from '../src/types/index.ts';

const fixture = () => normalizeLyrics({ song_id: 'test', version: 3, title: 'Bài thử', canonical_text: '[Verse]\nEm về\n\n[Chorus]\nEm về', lines: [
  { id: 'line-a', text: 'Em về', start: 1, end: 3, words: [{ id: 'a', word: 'Em', start: 1, end: 2 }, { id: 'b', word: 'về', start: 2, end: 3 }] },
  { id: 'line-b', text: 'Em về', start: 4, end: 6, words: [{ id: 'c', word: 'Em', start: 4, end: 5 }, { id: 'd', word: 'về', start: 5, end: 6 }] },
] });

test('saved or untouched documents never create redundant versions', async () => {
  const session = new LyricsSession(); session.load(fixture());
  let writes = 0;
  const writer = async (doc: LyricsData) => { writes++; return { ...doc, version: doc.version + 1 }; };
  await session.save(writer); assert.equal(writes, 0);
  session.commit(doc => ({ ...doc, title: 'Đã sửa' }));
  const lines = session.getSnapshot().document!.lines;
  await session.save(writer);
  await session.save(writer); await session.save(writer);
  assert.equal(writes, 1);
  assert.equal(session.getSnapshot().status, 'saved');
  assert.equal(session.getSnapshot().document!.lines, lines);
});

test('a concurrent Export/Save awaits newest edits and updated server version', async () => {
  const session = new LyricsSession(); session.load(fixture());
  session.commit(doc => ({ ...doc, title: 'A' }));
  let release!: (doc: LyricsData) => void;
  const writes: LyricsData[] = [];
  const writer = async (doc: LyricsData) => {
    writes.push(doc);
    return writes.length === 1 ? new Promise<LyricsData>(resolve => { release = resolve; }) : { ...doc, version: doc.version + 1 };
  };
  const first = session.save(writer);
  session.commit(doc => ({ ...doc, title: 'B' }));
  const second = session.save(writer);
  assert.equal(first, second);
  release({ ...writes[0], version: 4 });
  assert.equal(await second, true);
  assert.deepEqual(writes.map(doc => [doc.title, doc.version]), [['A', 3], ['B', 4]]);
  assert.equal(session.getSnapshot().document!.title, 'B');
  assert.equal(session.getSnapshot().document!.version, 5);
});

test('undo/redo preserves server version and one history entry per edit', async () => {
  const session = new LyricsSession(); session.load(fixture());
  session.commit(doc => ({ ...doc, title: 'Edit' }));
  await session.save(async doc => ({ ...doc, version: 4 }));
  session.undo();
  assert.equal(session.getSnapshot().document!.title, 'Bài thử');
  assert.equal(session.getSnapshot().document!.version, 4);
  assert.equal(session.getSnapshot().canUndo, false);
  session.redo();
  assert.equal(session.getSnapshot().document!.title, 'Edit');
  assert.equal(session.getSnapshot().canRedo, false);
});

test('version conflict retains draft and forbids silent automatic retry', async () => {
  const session = new LyricsSession(); session.load(fixture());
  session.commit(doc => ({ ...doc, title: 'Local' }));
  const writer = async () => { throw Object.assign(new Error('Conflict'), { status: 409 }); };
  assert.equal(await session.save(writer), false);
  session.commit(doc => ({ ...doc, title: 'Local 2' }));
  assert.equal(session.getSnapshot().status, 'conflict');
  let writes = 0;
  await session.save(async doc => { writes++; return doc; });
  assert.equal(writes, 0);
  assert.equal(session.getSnapshot().document!.title, 'Local 2');
});

test('late alignment cannot overwrite edits; clean alignment is already saved', async () => {
  const session = new LyricsSession(); session.load(fixture());
  const aligned = { ...fixture(), version: 4, title: 'AI' };
  assert.equal(session.applyAligned(aligned, 0), true);
  assert.equal(session.getSnapshot().status, 'saved');
  let writes = 0; await session.save(async doc => { writes++; return doc; }); assert.equal(writes, 0);
  const revision = session.getSnapshot().revision;
  session.commit(doc => ({ ...doc, title: 'Local' }));
  assert.equal(session.applyAligned({ ...aligned, version: 5 }, revision), false);
  assert.equal(session.getSnapshot().document!.title, 'Local');
});

test('inserted syllables remain untimed, IDs and repeated lines are preserved', () => {
  const original = fixture();
  const edited = syncLineText(original.lines[0], 'Em sẽ về');
  assert.equal(edited.words[0].id, 'a'); assert.equal(edited.words[2].id, 'b');
  assert.equal(edited.words[1].start, null); assert.equal(edited.words[1].end, null);
  const roundTrip = normalizeLyrics(JSON.parse(JSON.stringify({ ...original, lines: [edited] })));
  assert.equal(roundTrip.lines[0].words[1].start, null);
  assert.equal(updateCanonicalLine(original.canonical_text, original.lines, 'line-a', edited.text), '[Verse]\nEm sẽ về\n\n[Chorus]\nEm về');
  assert.equal(playbackStateAt(roundTrip, 0).currentLineIndex, -1);
});

test('export progress of 1 means 1 percent, not complete', () => {
  assert.equal(normalizeExport({ status: 'processing', progress: 1 }).progress, 1);
});
