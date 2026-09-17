import type { KaraokePreset, LyricLine, LyricWord, ModelPreset } from '../types';
import { formatClock, getReviewReasons } from '../utils/lyrics';

interface InspectorPanelProps {
  line?: LyricLine;
  word?: LyricWord;
  currentTime: number;
  preset: KaraokePreset;
  modelPreset: ModelPreset;
  aligning: boolean;
  onPresetChange: (preset: KaraokePreset) => void;
  onModelPresetChange: (preset: ModelPreset) => void;
  onLineChange: (lineId: string, patch: Partial<LyricLine>) => void;
  onWordChange: (lineId: string, wordId: string, patch: Partial<LyricWord>) => void;
  onSelectWord: (wordId: string) => void;
  onPlayWord: (word: LyricWord) => void;
  onToggleLock: (lineId: string) => void;
  onNudge: (amount: number) => void;
  onSetBoundary: (boundary: 'start' | 'end') => void;
  onRealignLine: (lineId: string) => void;
}

function SecondsField({ label, value, disabled, onChange }: { label: string; value: number | null; disabled?: boolean; onChange: (value: number | null) => void }) {
  return (
    <label className="field-label">
      <span>{label}</span>
      <div className="time-field">
        <input
          type="number"
          min={0}
          step={0.01}
          value={value === null ? '' : Number(value.toFixed(3))}
          placeholder="Chưa có mốc"
          disabled={disabled}
          onChange={(event) => onChange(event.target.value === '' ? null : Math.max(0, Number(event.target.value) || 0))}
        />
        <small>giây</small>
      </div>
    </label>
  );
}

export function InspectorPanel({
  line,
  word,
  currentTime,
  preset,
  modelPreset,
  aligning,
  onPresetChange,
  onModelPresetChange,
  onLineChange,
  onWordChange,
  onSelectWord,
  onPlayWord,
  onToggleLock,
  onNudge,
  onSetBoundary,
  onRealignLine,
}: InspectorPanelProps) {
  if (!line) {
    return (
      <aside className="studio-panel inspector-panel">
        <div className="panel-heading"><div><span className="eyebrow">THUỘC TÍNH</span><h2>Chọn một câu</h2></div></div>
        <div className="empty-panel">Chọn câu ở bảng bên trái hoặc trên timeline để chỉnh mốc.</div>
      </aside>
    );
  }

  const reasons = getReviewReasons(line);
  const targetStart = word ? word.start : line.start;
  const targetEnd = word ? word.end : line.end;

  return (
    <aside className="studio-panel inspector-panel">
      <div className="panel-heading">
        <div><span className="eyebrow">THUỘC TÍNH</span><h2>{word ? `Tiếng “${word.word}”` : 'Câu đang chọn'}</h2></div>
        <button type="button" className={`lock-button ${line.locked ? 'active' : ''}`} onClick={() => onToggleLock(line.id)}>
          {line.locked ? '🔒 Đã khóa' : '🔓 Khóa câu'}
        </button>
      </div>

      <div className="inspector-scroll">
        <div className="property-group">
          <div className="group-title"><span>Mốc thời gian</span><time>{formatClock(currentTime, true)}</time></div>
          <div className="field-grid">
            <SecondsField
              label="Bắt đầu"
              value={targetStart}
              disabled={line.locked}
              onChange={(value) => word ? onWordChange(line.id, word.id, { start: value }) : onLineChange(line.id, { start: value })}
            />
            <SecondsField
              label="Kết thúc"
              value={targetEnd}
              disabled={line.locked}
              onChange={(value) => word ? onWordChange(line.id, word.id, { end: value }) : onLineChange(line.id, { end: value })}
            />
          </div>
          <div className="button-row compact">
            <button type="button" disabled={line.locked} onClick={() => onSetBoundary('start')}>Đặt đầu tại con trỏ</button>
            <button type="button" disabled={line.locked} onClick={() => onSetBoundary('end')}>Đặt cuối tại con trỏ</button>
          </div>
          <div className="nudge-grid" aria-label="Dịch mốc thời gian">
            {[-0.05, -0.01, 0.01, 0.05].map((amount) => (
              <button type="button" key={amount} disabled={line.locked || targetStart === null || targetEnd === null} onClick={() => onNudge(amount)}>
                {amount > 0 ? '+' : '−'}{Math.abs(amount) * 1000} ms
              </button>
            ))}
          </div>
        </div>

        <div className="property-group">
          <div className="group-title"><span>Từng tiếng</span><small>Bấm để nghe</small></div>
          <div className="word-cloud">
            {line.words.map((item) => (
              <button
                type="button"
                key={item.id}
                className={`${word?.id === item.id ? 'selected' : ''} ${item.review_required || item.start === null || item.end === null || item.end <= item.start ? 'needs-review' : ''}`}
                onClick={() => { onSelectWord(item.id); onPlayWord(item); }}
              >
                {item.word || '∅'}
              </button>
            ))}
          </div>
          {word ? (
            <label className="field-label full-width">
              <span>Nội dung tiếng</span>
              <input
                type="text"
                value={word.word}
                disabled={line.locked}
                onChange={(event) => onWordChange(line.id, word.id, { word: event.target.value, review_required: true, review_reasons: ['unaligned_text'] })}
              />
            </label>
          ) : null}
        </div>

        <div className="property-group">
          <div className="group-title"><span>Kiểm tra nhịp</span><small>{reasons.length} cảnh báo</small></div>
          {reasons.length > 0 ? (
            <ul className="review-list">{reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
          ) : (
            <p className="success-note">Các mốc hiện tại hợp lệ. Hãy nghe lại trước khi xuất.</p>
          )}
          <label className="field-label full-width">
            <span>Chất lượng căn lời</span>
            <select value={modelPreset} onChange={(event) => onModelPresetChange(event.target.value as ModelPreset)}>
              <option value="quality">Chuẩn · large-v3</option>
              <option value="draft">Nháp nhanh · small</option>
            </select>
          </label>
          <button
            type="button"
            className="primary-button full-width"
            disabled={line.locked || aligning}
            onClick={() => onRealignLine(line.id)}
          >
            {aligning ? 'Đang căn lại…' : 'Căn lại câu đang chọn'}
          </button>
        </div>

        <div className="property-group">
          <div className="group-title"><span>Kiểu video</span><small>16:9 · 1080p</small></div>
          <div className="segmented-control full-width">
            <button type="button" className={preset === 'classic' ? 'active' : ''} onClick={() => onPresetChange('classic')}>Classic</button>
            <button type="button" className={preset === 'modern' ? 'active' : ''} onClick={() => onPresetChange('modern')}>Modern</button>
          </div>
          <p className="helper-text">{preset === 'classic' ? 'Hai dòng, quét vàng theo từng tiếng.' : 'Năm dòng cuộn, câu hiện tại nổi bật ở giữa.'}</p>
        </div>
      </div>
    </aside>
  );
}
