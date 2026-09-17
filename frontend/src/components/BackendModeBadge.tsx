import { useState } from 'react';
import { getBackendMode, isSupabaseConfigured, type BackendMode } from '../api/client';
import { CloudSettingsModal } from './CloudSettingsModal';

export function BackendModeBadge() {
  const [mode, setMode] = useState<BackendMode>(getBackendMode());
  const [isModalOpen, setIsModalOpen] = useState(false);
  const configured = isSupabaseConfigured();

  const refreshState = () => {
    setMode(getBackendMode());
  };

  const isCloud = mode === 'supabase';

  return (
    <>
      <button
        type="button"
        onClick={() => setIsModalOpen(true)}
        title="Bấm để cấu hình chế độ Cục bộ (FastAPI) hoặc Đám mây (Supabase + GPU)"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '0.35rem 0.75rem',
          borderRadius: '9999px',
          fontSize: '0.78rem',
          fontWeight: 500,
          cursor: 'pointer',
          border: isCloud
            ? '1px solid rgba(59, 130, 246, 0.4)'
            : '1px solid rgba(245, 158, 11, 0.4)',
          background: isCloud
            ? 'rgba(59, 130, 246, 0.12)'
            : 'rgba(245, 158, 11, 0.12)',
          color: isCloud ? '#60a5fa' : '#f59e0b',
          transition: 'all 0.2s ease',
        }}
      >
        <span
          style={{
            display: 'inline-block',
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            backgroundColor: isCloud ? (configured ? '#3b82f6' : '#ef4444') : '#10b981',
          }}
        />
        <span>{isCloud ? '☁️ Supabase Cloud' : '🖥️ Máy cục bộ'}</span>
        <span style={{ opacity: 0.6, fontSize: '0.7rem' }}>⚙️</span>
      </button>

      <CloudSettingsModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onModeChanged={refreshState}
      />
    </>
  );
}
