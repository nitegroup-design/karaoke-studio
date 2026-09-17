import { memo, useEffect, useRef, useState } from 'react';
import type { LyricLine } from '../types';
import { formatClock, getReviewReasons } from '../utils/lyrics';

interface LyricsPanelProps {
  lines: LyricLine[];
  selectedLineId?: string;
  activeLineId?: string;
  onSelect: (lineId: string) => void;
  onSeek: (time: number) => void;
  onTextChange: (lineId: string, text: string) => void;
  onToggleLock: (lineId: string) => void;
  onReplaceAllLyrics?: (newText: string) => void;
}

export const LyricsPanel = memo(function LyricsPanel({
  lines,
  selectedLineId,
  activeLineId,
  onSelect,
  onSeek,
  onTextChange,
  onToggleLock,
  onReplaceAllLyrics,
}: LyricsPanelProps) {
  const selectedRef = useRef<HTMLDivElement>(null);
  const [showReplaceModal, setShowReplaceModal] = useState(false);
  const [replaceText, setReplaceText] = useState('');

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedLineId]);

  return (
    <section className="studio-panel lyrics-panel" aria-label="Danh sách lời bài hát">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">BẢN LỜI CHUẨN</span>
          <h2>Lời bài hát</h2>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {onReplaceAllLyrics && (
            <button
              type="button"
              className="text-button"
              style={{ fontSize: '0.72rem', padding: '2px 6px', color: 'var(--accent)' }}
              onClick={() => {
                setReplaceText(lines.map((l) => l.text).join('\n'));
                setShowReplaceModal(true);
              }}
              title="Dán hoặc cập nhật lại toàn bộ lời bài hát"
            >
              📝 Đổi lời
            </button>
          )}
          <span className="count-pill">{lines.length} câu</span>
        </div>
      </div>
      <div className="lyrics-list">
        {lines.map((line, index) => {
          const selected = line.id === selectedLineId;
          const active = line.id === activeLineId;
          const reasons = getReviewReasons(line);
          return (
            <div
              key={line.id}
              ref={selected ? selectedRef : undefined}
              className={`lyric-card ${selected ? 'selected' : ''} ${active ? 'playing' : ''}`}
              onClick={() => onSelect(line.id)}
            >
              <button
                className="line-time"
                type="button"
                disabled={line.start === null}
                onClick={(event) => { event.stopPropagation(); if (line.start !== null) onSeek(line.start); }}
                aria-label={`Nghe từ ${formatClock(line.start, true)}`}
              >
                <span>{String(index + 1).padStart(2, '0')}</span>
                <time>{formatClock(line.start, true)}</time>
              </button>
              <textarea
                rows={2}
                value={line.text}
                readOnly={line.locked}
                onFocus={() => onSelect(line.id)}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => onTextChange(line.id, event.target.value)}
                aria-label={`Nội dung câu ${index + 1}`}
              />
              <div className="line-meta">
                {reasons.length > 0 ? (
                  <span className="review-chip" title={reasons.join(' · ')}>⚠ Cần kiểm tra</span>
                ) : (
                  <span className="ok-chip">Đã có nhịp</span>
                )}
                <button
                  type="button"
                  className={`icon-button tiny ${line.locked ? 'active' : ''}`}
                  onClick={(event) => { event.stopPropagation(); onToggleLock(line.id); }}
                  title={line.locked ? 'Mở khóa câu' : 'Khóa câu đã sửa'}
                  aria-label={line.locked ? 'Mở khóa câu' : 'Khóa câu'}
                >
                  {line.locked ? '🔒' : '🔓'}
                </button>
              </div>
            </div>
          );
        })}
        {lines.length === 0 ? <div className="empty-panel">Chưa có lời. Hãy dán lyric rồi căn lại toàn bài.</div> : null}
      </div>

      {showReplaceModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="bg-stone-900 border border-stone-800 rounded-2xl w-full max-w-xl p-6 shadow-2xl flex flex-col gap-4 text-stone-100">
            <div className="flex items-center justify-between border-b border-stone-800 pb-3">
              <div>
                <span className="text-[11px] font-bold tracking-widest text-amber-500 uppercase">CẬP NHẬT LỜI BÀI HÁT</span>
                <h3 className="text-lg font-bold">Dán bản lời chuẩn mới</h3>
              </div>
              <button type="button" onClick={() => setShowReplaceModal(false)} className="text-stone-400 hover:text-white text-xl">✕</button>
            </div>
            <p className="text-xs text-stone-400">
              Dán toàn bộ lời bài hát vào đây (mỗi câu một dòng). Nhạc và giọng hát đã được tách sẵn nên quá trình căn lại lời mới sẽ hoàn tất chỉ trong 1 giây!
            </p>
            <textarea
              className="w-full h-64 p-3 bg-stone-950 border border-stone-700 rounded-xl text-sm font-sans text-stone-200 focus:border-amber-500 focus:outline-none resize-none leading-relaxed"
              placeholder="Dán toàn bộ lời bài hát tại đây..."
              value={replaceText}
              onChange={(e) => setReplaceText(e.target.value)}
            />
            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-stone-500">
                {replaceText.split(/\r?\n/).filter((l) => l.trim()).length} câu · {replaceText.trim() ? replaceText.trim().split(/\s+/).length : 0} tiếng
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowReplaceModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-stone-300 hover:bg-stone-800"
                >
                  Hủy
                </button>
                <button
                  type="button"
                  disabled={!replaceText.trim()}
                  onClick={() => {
                    onReplaceAllLyrics?.(replaceText.trim());
                    setShowReplaceModal(false);
                  }}
                  className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 text-xs font-bold shadow-lg disabled:opacity-50 transition-colors"
                >
                  ✓ Căn nhịp lại ngay
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
});
