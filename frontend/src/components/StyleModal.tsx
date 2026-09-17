import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { VideoStyle } from '../types';
import { loadVideoFonts } from '../utils/videoFonts';

interface StyleModalProps {
  songId: string;
  style: VideoStyle;
  hasCustomBackground: boolean;
  onStyleChange: (newStyle: VideoStyle) => void;
  onBackgroundUpdated: (hasBg: boolean) => void;
  onClose: () => void;
}

const FONT_OPTIONS = [
  { id: 'Be Vietnam Pro', name: 'Be Vietnam Pro', desc: 'Chuẩn studio, hiện đại, trang nhã' },
  { id: 'Montserrat', name: 'Montserrat', desc: 'Trẻ trung, mạnh mẽ, phong cách Pop' },
  { id: 'Playfair Display', name: 'Playfair Display', desc: 'Cổ điển, nghệ thuật, Bolero & Trữ tình' },
  { id: 'Lexend', name: 'Lexend', desc: 'Tối ưu độ đọc, bo tròn thân thiện' },
  { id: 'Oswald', name: 'Oswald', desc: 'Cao, dứt khoát, phong cách Rap & Rock' },
  { id: 'Roboto', name: 'Roboto', desc: 'Tiêu chuẩn, rõ nét, dễ nhìn' },
];

const COLOR_THEMES = [
  {
    name: 'Apple Tinh Tế',
    primary: 'rgba(255, 255, 255, 0.45)',
    secondary: '#FFFFFF',
    outline: 'transparent',
    icon: '✨',
  },
  {
    name: 'Hoàng Kim',
    primary: '#F7F3EB',
    secondary: '#FFB547',
    outline: '#181109',
    icon: '🌟',
  },
  {
    name: 'Cyber Neon',
    primary: '#FFFFFF',
    secondary: '#FF2A85',
    outline: '#160822',
    icon: '🌸',
  },
  {
    name: 'Đại Dương',
    primary: '#E2E8F0',
    secondary: '#00F2FE',
    outline: '#041C2C',
    icon: '🌊',
  },
  {
    name: 'Ngọc Lục Bảo',
    primary: '#F8FAFC',
    secondary: '#10B981',
    outline: '#062817',
    icon: '🍃',
  },
  {
    name: 'Hoàng Hôn',
    primary: '#FEF08A',
    secondary: '#F97316',
    outline: '#240B04',
    icon: '🔥',
  },
];

const EFFECT_OPTIONS = [
  { id: 'smooth', name: 'Quét mượt liên tục', desc: 'Chữ chuyển màu đều êm ái, mờ viền mềm' },
  { id: 'glow', name: 'Phát sáng Neon (Glow)', desc: 'Hào quang tỏa sáng rực rỡ quanh chữ' },
  { id: 'pop', name: 'Nảy nhịp (Beat Pop)', desc: 'Chữ nảy nhẹ tạo điểm nhấn theo từng tiếng' },
] as const;

export const StyleModal: React.FC<StyleModalProps> = ({
  songId,
  style,
  hasCustomBackground,
  onStyleChange,
  onBackgroundUpdated,
  onClose,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => { loadVideoFonts(); }, []);
  const [uploadingBg, setUploadingBg] = useState(false);
  const [bgKey, setBgKey] = useState(() => Date.now());
  const [errorNotice, setErrorNotice] = useState('');

  const bgUrl = `${api.getBackgroundUrl(songId)}?t=${bgKey}`;

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingBg(true);
    setErrorNotice('');
    try {
      await api.uploadBackground(songId, file);
      setBgKey(Date.now());
      onBackgroundUpdated(true);
    } catch (err) {
      setErrorNotice('Không tải được ảnh: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setUploadingBg(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemoveBackground = async () => {
    try {
      await api.deleteBackground(songId);
      onBackgroundUpdated(false);
      setBgKey(Date.now());
    } catch (err) {
      setErrorNotice('Lỗi xóa ảnh: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-3xl bg-stone-900 border border-amber-500/30 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-800 bg-stone-950/60">
          <div className="flex items-center gap-3">
            <span className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold text-lg">🎨</span>
            <div>
              <h2 className="text-base font-semibold text-stone-100">Tùy biến Kiểu chữ & Hình nền Video</h2>
              <p className="text-xs text-stone-400">Chọn phông chữ, màu sắc, hiệu ứng phát sáng và hình nền cho Karaoke.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-stone-400 hover:text-stone-100 w-8 h-8 rounded-lg flex items-center justify-center hover:bg-stone-800 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
          {errorNotice && (
            <div className="p-3 rounded-lg bg-red-500/15 border border-red-500/30 text-red-300 text-xs flex justify-between items-center">
              <span>{errorNotice}</span>
              <button type="button" onClick={() => setErrorNotice('')} className="text-red-400 hover:text-red-200">✕</button>
            </div>
          )}

          {/* Live Preview Sample Box */}
          <div className="rounded-xl overflow-hidden border border-stone-800 bg-stone-950 p-6 relative flex flex-col items-center justify-center min-h-[140px] shadow-inner">
            {hasCustomBackground ? (
              <>
                <img
                  src={bgUrl}
                  alt="Background preview"
                  className="absolute inset-0 w-full h-full object-cover filter blur-[2px] opacity-40 pointer-events-none"
                />
                <div className="absolute inset-0 bg-stone-950/40 pointer-events-none" />
              </>
            ) : (
              <div className="absolute inset-0 bg-radial from-amber-500/10 via-stone-950 to-stone-950 opacity-60 pointer-events-none" />
            )}

            <div className="relative z-10 text-center space-y-2 select-none">
              <span className="text-xs font-medium tracking-widest text-stone-400 uppercase">Mẫu hiển thị thực tế</span>
              <div
                className="text-2xl md:text-3xl font-bold flex items-center justify-center gap-1.5 flex-wrap"
                style={{ fontFamily: style.font_family }}
              >
                <span
                  style={{
                    color: style.secondary_color,
                    WebkitTextStroke: `1px ${style.outline_color}`,
                    textShadow: style.effect === 'glow' ? `0 0 20px ${style.secondary_color}` : `0 2px 4px ${style.outline_color}`,
                    transform: style.effect === 'pop' ? 'scale(1.08)' : 'none',
                    display: 'inline-block',
                    transition: 'all 0.2s',
                  }}
                >
                  Kể từ khi
                </span>
                <span
                  style={{
                    color: style.secondary_color,
                    WebkitTextStroke: `1px ${style.outline_color}`,
                    textShadow: style.effect === 'glow' ? `0 0 20px ${style.secondary_color}` : `0 2px 4px ${style.outline_color}`,
                    display: 'inline-block',
                  }}
                >
                  gặp em,
                </span>
                <span
                  style={{
                    color: style.primary_color,
                    WebkitTextStroke: `1px ${style.outline_color}`,
                    textShadow: `0 2px 4px ${style.outline_color}`,
                    opacity: 0.65,
                    display: 'inline-block',
                  }}
                >
                  trí nhớ hơi bị kém
                </span>
              </div>
            </div>
          </div>

          {/* 1. Background Image Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-stone-300 uppercase tracking-wider">
                🖼 Hình nền Video (Tùy chọn)
              </label>
              {hasCustomBackground && (
                <button
                  type="button"
                  onClick={handleRemoveBackground}
                  className="text-xs text-red-400 hover:text-red-300 transition-colors"
                >
                  🗑 Xóa hình nền (Dùng nền đen)
                </button>
              )}
            </div>

            <div className="flex gap-4 items-center">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handleFileUpload}
              />
              <button
                type="button"
                disabled={uploadingBg}
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-100 text-xs font-medium border border-stone-700 transition-colors"
              >
                {uploadingBg ? '⏳ Đang tải ảnh...' : hasCustomBackground ? '🔄 Thay ảnh nền khác' : '📁 Tải ảnh nền từ máy (JPG/PNG)'}
              </button>
              <span className="text-xs text-stone-400">
                {hasCustomBackground ? '✓ Đang áp dụng hình nền tùy chỉnh' : 'Mặc định: Nền than điện ảnh `#111216`'}
              </span>
            </div>
          </div>

          {/* 2. Font Family Selection */}
          <div className="space-y-3">
            <label className="text-xs font-semibold text-stone-300 uppercase tracking-wider">
              🔤 Kiểu chữ / Phông chữ (Font Family)
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
              {FONT_OPTIONS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => onStyleChange({ ...style, font_family: f.id })}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    style.font_family === f.id
                      ? 'bg-amber-500/15 border-amber-500 text-amber-300 shadow-md'
                      : 'bg-stone-800/60 border-stone-700/60 text-stone-300 hover:bg-stone-800 hover:border-stone-600'
                  }`}
                >
                  <div className="font-semibold text-sm" style={{ fontFamily: f.id }}>{f.name}</div>
                  <div className="text-[11px] text-stone-400 mt-0.5">{f.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* 3. Color Themes & Pickers */}
          <div className="space-y-3">
            <label className="text-xs font-semibold text-stone-300 uppercase tracking-wider">
              🎨 Bảng phối màu (Color Themes)
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {COLOR_THEMES.map((theme) => {
                const isActive =
                  style.primary_color.toUpperCase() === theme.primary.toUpperCase() &&
                  style.secondary_color.toUpperCase() === theme.secondary.toUpperCase();
                return (
                  <button
                    key={theme.name}
                    type="button"
                    onClick={() =>
                      onStyleChange({
                        ...style,
                        primary_color: theme.primary,
                        secondary_color: theme.secondary,
                        outline_color: theme.outline,
                      })
                    }
                    className={`p-2.5 rounded-xl border flex flex-col items-center gap-1.5 transition-all ${
                      isActive
                        ? 'bg-amber-500/20 border-amber-500 text-stone-100 shadow-md ring-2 ring-amber-500/40'
                        : 'bg-stone-800/60 border-stone-700/60 text-stone-300 hover:bg-stone-800'
                    }`}
                  >
                    <span className="text-base">{theme.icon}</span>
                    <span className="text-xs font-medium">{theme.name}</span>
                    <div className="flex gap-1 mt-0.5">
                      <span className="w-3.5 h-3.5 rounded-full border border-stone-700" style={{ backgroundColor: theme.primary }} />
                      <span className="w-3.5 h-3.5 rounded-full border border-stone-700" style={{ backgroundColor: theme.secondary }} />
                      <span className="w-3.5 h-3.5 rounded-full border border-stone-700" style={{ backgroundColor: theme.outline }} />
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Custom Color Inputs */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
              <label className="flex items-center gap-2 p-2 rounded-xl bg-stone-800/40 border border-stone-700/60 text-xs">
                <input
                  type="color"
                  value={style.secondary_color}
                  onChange={(e) => onStyleChange({ ...style, secondary_color: e.target.value })}
                  className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent p-0"
                />
                <div>
                  <span className="block font-medium text-stone-200">Màu quét chữ</span>
                  <span className="text-[10px] text-stone-400 font-mono">{style.secondary_color}</span>
                </div>
              </label>

              <label className="flex items-center gap-2 p-2 rounded-xl bg-stone-800/40 border border-stone-700/60 text-xs">
                <input
                  type="color"
                  value={style.primary_color}
                  onChange={(e) => onStyleChange({ ...style, primary_color: e.target.value })}
                  className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent p-0"
                />
                <div>
                  <span className="block font-medium text-stone-200">Màu chữ chờ</span>
                  <span className="text-[10px] text-stone-400 font-mono">{style.primary_color}</span>
                </div>
              </label>

              <label className="flex items-center gap-2 p-2 rounded-xl bg-stone-800/40 border border-stone-700/60 text-xs">
                <input
                  type="color"
                  value={style.outline_color}
                  onChange={(e) => onStyleChange({ ...style, outline_color: e.target.value })}
                  className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent p-0"
                />
                <div>
                  <span className="block font-medium text-stone-200">Màu viền chữ</span>
                  <span className="text-[10px] text-stone-400 font-mono">{style.outline_color}</span>
                </div>
              </label>
            </div>
          </div>

          {/* 4. Motion / Transition Effect */}
          <div className="space-y-3">
            <label className="text-xs font-semibold text-stone-300 uppercase tracking-wider">
              ✨ Hiệu ứng chuyển chữ & chuyển câu
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {EFFECT_OPTIONS.map((eff) => (
                <button
                  key={eff.id}
                  type="button"
                  onClick={() => onStyleChange({ ...style, effect: eff.id })}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    style.effect === eff.id
                      ? 'bg-amber-500/15 border-amber-500 text-amber-300 shadow-md'
                      : 'bg-stone-800/60 border-stone-700/60 text-stone-300 hover:bg-stone-800 hover:border-stone-600'
                  }`}
                >
                  <div className="font-semibold text-xs">{eff.name}</div>
                  <div className="text-[11px] text-stone-400 mt-0.5">{eff.desc}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-stone-800 bg-stone-950/80">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold text-sm transition-colors shadow-md"
          >
            ✓ Áp dụng phong cách
          </button>
        </div>
      </div>
    </div>
  );
};
