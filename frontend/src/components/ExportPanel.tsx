import { artifactUrl } from '../api/client';
import type { ExportJob, KaraokePreset } from '../types';

interface ExportPanelProps {
  songId: string;
  preset: KaraokePreset;
  job: ExportJob;
  disabled?: boolean;
  onStart: () => void;
}

const artifacts = [
  ['mp4', 'MP4 video'],
  ['ass', 'ASS karaoke'],
  ['srt', 'SRT theo câu'],
  ['wav', 'WAV nhạc nền'],
] as const;

export function ExportPanel({ songId, preset, job, disabled, onStart }: ExportPanelProps) {
  const working = job.state === 'queued' || job.state === 'processing';
  return (
    <div className="export-strip">
      <div className="export-copy">
        <span className="eyebrow">XUẤT THÀNH PHẨM</span>
        <strong>{preset === 'classic' ? 'Classic hai dòng' : 'Modern cuộn nhiều dòng'}</strong>
        <small>MP4 1080p · 30 fps · H.264/AAC · instrumental</small>
      </div>
      {working ? (
        <div className="export-progress" aria-live="polite">
          <div><span style={{ width: `${job.progress}%` }} /></div>
          <small>{job.message || `Đang dựng video… ${Math.round(job.progress)}%`}</small>
        </div>
      ) : null}
      {job.state === 'error' ? <div className="export-error">{job.error || 'Xuất video thất bại.'}</div> : null}
      {job.state === 'done' ? (
        <div className="artifact-links" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
          {artifacts.map(([kind, label]) => (
            <a
              key={kind}
              href={artifactUrl(songId, kind, job.export_id)}
              download
              className="primary-button"
              style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.4rem', padding: '0.45rem 0.85rem', fontSize: '0.85rem' }}
            >
              📥 {label}
            </a>
          ))}
          <button
            type="button"
            className="secondary-button"
            disabled={disabled || working}
            onClick={onStart}
            style={{ fontSize: '0.85rem', padding: '0.45rem 0.85rem' }}
          >
            🔄 Xuất lại video
          </button>
        </div>
      ) : (
        <button type="button" className="primary-button" disabled={disabled || working} onClick={onStart}>
          {working ? 'Đang xuất…' : 'Xuất video & tài nguyên'}
        </button>
      )}
    </div>
  );
}
