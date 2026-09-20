import React, { useState } from 'react';
import {
  getBackendMode,
  setBackendMode,
  getSupabaseCredentials,
  setSupabaseCredentials,
  type BackendMode,
} from '../api/client';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onModeChanged?: () => void;
}

export function CloudSettingsModal({ isOpen, onClose, onModeChanged }: Props) {
  const [mode, setMode] = useState<BackendMode>(getBackendMode());
  const initialCreds = getSupabaseCredentials();
  const [supabaseUrl, setSupabaseUrl] = useState(initialCreds.url);
  const [supabaseKey, setSupabaseKey] = useState(initialCreds.anonKey);
  const [savedMessage, setSavedMessage] = useState('');

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setBackendMode(mode);
    setSupabaseCredentials(supabaseUrl, supabaseKey);
    setSavedMessage('✅ Đã lưu cấu hình thành công!');
    setTimeout(() => {
      setSavedMessage('');
      onModeChanged?.();
      onClose();
    }, 900);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(8px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: 'var(--card-bg, #18181b)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: '16px',
          width: '100%',
          maxWidth: '520px',
          padding: '1.75rem',
          color: 'var(--text-color, #f4f4f5)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
            ☁️ Chế độ xử lý & Kết nối Cloud
          </h3>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#888',
              fontSize: '1.5rem',
              cursor: 'pointer',
              lineHeight: 1,
            }}
          >
            &times;
          </button>
        </div>

        <form onSubmit={handleSave}>
          <div style={{ marginBottom: '1.25rem' }}>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, marginBottom: '0.5rem', opacity: 0.85 }}>
              Nơi xử lý bài hát:
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <button
                type="button"
                onClick={() => setMode('local')}
                style={{
                  padding: '0.75rem',
                  borderRadius: '10px',
                  border: mode === 'local' ? '2px solid #f59e0b' : '1px solid rgba(255, 255, 255, 0.12)',
                  background: mode === 'local' ? 'rgba(245, 158, 11, 0.12)' : 'rgba(255, 255, 255, 0.04)',
                  color: mode === 'local' ? '#f59e0b' : 'inherit',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontSize: '0.85rem',
                }}
              >
                <div style={{ fontWeight: 600 }}>🖥️ Máy cục bộ</div>
                <div style={{ fontSize: '0.75rem', opacity: 0.7, marginTop: '2px' }}>FastAPI (Port 8000)</div>
              </button>

              <button
                type="button"
                onClick={() => setMode('supabase')}
                style={{
                  padding: '0.75rem',
                  borderRadius: '10px',
                  border: mode === 'supabase' ? '2px solid #3b82f6' : '1px solid rgba(255, 255, 255, 0.12)',
                  background: mode === 'supabase' ? 'rgba(59, 130, 246, 0.12)' : 'rgba(255, 255, 255, 0.04)',
                  color: mode === 'supabase' ? '#60a5fa' : 'inherit',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontSize: '0.85rem',
                }}
              >
                <div style={{ fontWeight: 600 }}>☁️ Đám mây (Cloud)</div>
                <div style={{ fontSize: '0.75rem', opacity: 0.7, marginTop: '2px' }}>Supabase + GPU Colab/RunPod</div>
              </button>
            </div>
          </div>

          <div style={{ opacity: mode === 'supabase' ? 1 : 0.6, transition: 'opacity 0.2s ease' }}>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.35rem' }}>
                Supabase Project URL:
              </label>
              <input
                type="url"
                value={supabaseUrl}
                onChange={(e) => setSupabaseUrl(e.target.value)}
                placeholder="https://xyzcompany.supabase.co"
                style={{
                  width: '100%',
                  padding: '0.65rem 0.85rem',
                  borderRadius: '8px',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  background: 'rgba(0, 0, 0, 0.25)',
                  color: '#fff',
                  fontSize: '0.85rem',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.35rem' }}>
                Supabase Anon Key:
              </label>
              <input
                type="password"
                value={supabaseKey}
                onChange={(e) => setSupabaseKey(e.target.value)}
                placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                style={{
                  width: '100%',
                  padding: '0.65rem 0.85rem',
                  borderRadius: '8px',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  background: 'rgba(0, 0, 0, 0.25)',
                  color: '#fff',
                  fontSize: '0.85rem',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>

          <div
            style={{
              fontSize: '0.82rem',
              lineHeight: 1.5,
              background: 'rgba(59, 130, 246, 0.1)',
              border: '1px solid rgba(59, 130, 246, 0.25)',
              padding: '0.85rem 1rem',
              borderRadius: '8px',
              marginBottom: '1.25rem',
            }}
          >
            <div style={{ fontWeight: 600, color: '#60a5fa', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              ⚡ GPU Worker (Google Colab miễn phí)
            </div>
            <div style={{ opacity: 0.85, marginBottom: '8px' }}>
              Khi tách nhạc hoặc xuất video MP4, bạn cần mở Google Colab để nhận tác vụ từ hàng đợi Supabase:
            </div>
            <a
              href="https://colab.research.google.com/github/nitegroup-design/karaoke-studio/blob/main/worker/karaoke_colab_worker.ipynb"
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                background: '#3b82f6',
                color: '#fff',
                padding: '0.45rem 0.85rem',
                borderRadius: '6px',
                textDecoration: 'none',
                fontWeight: 600,
                fontSize: '0.8rem',
              }}
            >
              🚀 Mở Google Colab GPU Worker (1-Click) ↗
            </a>
          </div>

          {savedMessage && (
            <div style={{ color: '#10b981', fontSize: '0.88rem', fontWeight: 500, marginBottom: '0.75rem', textAlign: 'center' }}>
              {savedMessage}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '0.55rem 1.1rem',
                borderRadius: '8px',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                background: 'transparent',
                color: 'inherit',
                cursor: 'pointer',
                fontSize: '0.85rem',
              }}
            >
              Hủy
            </button>
            <button
              type="submit"
              style={{
                padding: '0.55rem 1.3rem',
                borderRadius: '8px',
                border: 'none',
                background: '#f59e0b',
                color: '#18181b',
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: '0.85rem',
              }}
            >
              Lưu cấu hình
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
