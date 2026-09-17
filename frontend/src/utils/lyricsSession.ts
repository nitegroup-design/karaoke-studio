import type { LyricsData, SaveState } from '../types';

type Snapshot = {
  document: LyricsData | null;
  revision: number;
  status: SaveState;
  canUndo: boolean;
  canRedo: boolean;
  error: string;
};

/** One owner for local edits. React renders never mutate history or start saves. */
export class LyricsSession {
  private snapshot: Snapshot = { document: null, revision: 0, status: 'saved', canUndo: false, canRedo: false, error: '' };
  private past: LyricsData[] = [];
  private future: LyricsData[] = [];
  private savedRevision = 0;
  private inFlight: Promise<boolean> | null = null;
  private listeners = new Set<() => void>();

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish(patch: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...patch, canUndo: this.past.length > 0, canRedo: this.future.length > 0 };
    this.listeners.forEach((listener) => listener());
  }

  load(document: LyricsData) {
    this.past = [];
    this.future = [];
    this.savedRevision = 0;
    this.publish({ document, revision: 0, status: 'saved', error: '' });
  }

  commit = (update: (current: LyricsData) => LyricsData) => {
    const current = this.snapshot.document;
    if (!current) return;
    const next = update(current);
    if (next === current) return;
    this.past = [...this.past.slice(-49), current];
    this.future = [];
    this.edit(next);
  };

  private edit(document: LyricsData) {
    this.publish({ document, revision: this.snapshot.revision + 1,
      status: this.snapshot.status === 'conflict' ? 'conflict' : 'unsaved' });
  }

  undo = () => {
    const current = this.snapshot.document;
    const previous = this.past.pop();
    if (!current || !previous) return;
    this.future = [current, ...this.future.slice(0, 49)];
    this.edit({ ...previous, version: current.version });
  };

  redo = () => {
    const current = this.snapshot.document;
    const next = this.future.shift();
    if (!current || !next) return;
    this.past = [...this.past.slice(-49), current];
    this.edit({ ...next, version: current.version });
  };

  save(writer: (document: LyricsData) => Promise<LyricsData>): Promise<boolean> {
    // Explicit Save/Export/Align await the same drain, including edits made mid-request.
    if (this.inFlight) return this.inFlight;
    if (!this.snapshot.document || this.snapshot.status === 'conflict') return Promise.resolve(false);
    if (this.savedRevision === this.snapshot.revision) return Promise.resolve(true);
    this.inFlight = this.drain(writer).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async drain(writer: (document: LyricsData) => Promise<LyricsData>): Promise<boolean> {
    while (this.savedRevision !== this.snapshot.revision) {
      if (this.snapshot.status === 'conflict' || !this.snapshot.document) return false;
      const revision = this.snapshot.revision;
      const sent = this.snapshot.document;
      this.publish({ status: 'saving', error: '' });
      try {
        const saved = await writer(structuredClone(sent));
        const current = this.snapshot.document!;
        this.savedRevision = revision;
        // Never replace edits that arrived while the request was in flight.
        // Retain line identity for metadata-only saves so waveform/ASS do not rebuild.
        const lines = JSON.stringify(saved.lines) === JSON.stringify(current.lines) ? current.lines : saved.lines;
        const document = revision === this.snapshot.revision
          ? { ...saved, lines }
          : { ...current, version: saved.version, updated_at: saved.updated_at };
        this.publish({ document, status: revision === this.snapshot.revision ? 'saved' : 'unsaved' });
      } catch (error) {
        const conflict = typeof error === 'object' && error !== null && 'status' in error && error.status === 409;
        this.publish({ status: conflict ? 'conflict' : 'error', error: error instanceof Error ? error.message : 'Không thể lưu lyric.' });
        return false;
      }
    }
    return true;
  }

  applyAligned(document: LyricsData, revisionAtStart: number): boolean {
    if (this.snapshot.revision !== revisionAtStart || this.inFlight) {
      this.publish({ status: 'conflict', error: 'Kết quả AI và bản đang sửa khác nhau. Bản nháp của bạn được giữ nguyên.' });
      return false;
    }
    if (this.snapshot.document) this.past = [...this.past.slice(-49), this.snapshot.document];
    this.future = [];
    const revision = this.snapshot.revision + 1;
    this.savedRevision = revision;
    this.publish({ document, revision, status: 'saved', error: '' });
    return true;
  }
}
