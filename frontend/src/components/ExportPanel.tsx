import { artifactUrl, getBackendMode } from '../api/client';
import type { ExportJob, KaraokePreset } from '../types';

interface ExportPanelProps {
  songId: string;
  preset: KaraokePreset;
  job: ExportJob;
  disabled?: boolean;
  onStart: () => void;
}

const COLAB_WORKER_URL =
  'https://colab.research.google.com/github/nitegroup-design/karaoke-studio/blob/main/worker/karaoke_colab_worker.ipynb';

const artifacts = [
  ['mp4', '🎬 Tải MP4 (1080p)'],
  ['ass', '📝 Tải ASS Karaoke'],
  ['srt', '📄 Tải SRT'],
  ['lrc', '🎵 Tải LRC'],
  ['wav', '🎼 Tải Beat (WAV)'],
] as const;

export function ExportPanel({ songId, preset, job, disabled, onStart }: ExportPanelProps) {
  const working = job.state === 'queued' || job.state === 'processing';
  const isCloud = getBackendMode() === 'supabase';

  return (
    <div className="export-strip" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.65rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div className="export-copy">
          <span className="eyebrow">XUẤT THÀNH PHẨM</span>
          <strong>{preset === 'classic' ? 'Classic hai dòng' : 'Modern cuộn nhiều dòng'}</strong>
          <small>MP4 1080p · 30 fps · H.264/AAC · instrumental</small>
        </div>

        {isCloud && (
          <a
            href={COLAB_WORKER_URL}
            target="_blank"
            rel="noreferrer"
            className="secondary-button"
            style={{
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.35rem 0.75rem',
              fontSize: '0.8rem',
              color: '#60a5fa',
              borderColor: 'rgba(59, 130, 246, 0.4)',
              background: 'rgba(59, 130, 246, 0.08)',
              fontWeight: 500,
            }}
            title="Mở Google Colab để GPU T4 render video"
          >
            ⚡ Mở Google Colab Worker ↗
          </a>
        )}
      </div>

      {working ? (
        <div className="export-progress" aria-live="polite">
          <div><span style={{ width: `${job.progress}%` }} /></div>
          <small>{job.message || `Đang dựng video… ${Math.round(job.progress)}%`}</small>
          {isCloud && job.state === 'queued' && (
            <div style={{ fontSize: '0.78rem', color: '#fbbf24', marginTop: '0.35rem' }}>
              ⏳ Đang xếp hàng chờ GPU worker... Nếu chưa mở Colab, bấm{' '}
              <a href={COLAB_WORKER_URL} target="_blank" rel="noreferrer" style={{ color: '#60a5fa', textDecoration: 'underline' }}>
                vào đây để mở
              </a>{' '}
              và bấm <b>Runtime → Run all</b>.
            </div>
          )}
        </div>
      ) : null}

      {job.state === 'error' ? (
        <div className="export-error" style={{ fontSize: '0.82rem' }}>
          {job.error || 'Xuất video thất bại.'}
          {isCloud && (
            <div style={{ marginTop: '0.35rem', fontSize: '0.78rem' }}>
              Gợi ý: Kiểm tra Google Colab xem đã bấm <b>Run all</b> chưa.
            </div>
          )}
        </div>
      ) : null}

      {job.state === 'done' ? (
        <div>
          <div className="artifact-links" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
            {artifacts.map(([kind, label]) => (
              <a
                key={kind}
                href={artifactUrl(songId, kind, job.export_id)}
                download
                target="_blank"
                rel="noreferrer"
                className="primary-button"
                style={{
                  textDecoration: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  padding: '0.45rem 0.85rem',
                  fontSize: '0.85rem',
                }}
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
          {isCloud && (
            <div style={{ fontSize: '0.76rem', color: 'rgba(255, 255, 255, 0.55)', marginTop: '0.45rem' }}>
              💡 <i>Nếu tải MP4 gặp lỗi 404 (do lượt render trước chưa hoàn tất), hãy bật Colab và bấm nút <b>"🔄 Xuất lại video"</b> ở trên.</i>
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button type="button" className="primary-button" disabled={disabled || working} onClick={onStart}>
            {working ? 'Đang xuất…' : 'Xuất video & tài nguyên'}
          </button>
        </div>
      )}
    </div>
  );
}
