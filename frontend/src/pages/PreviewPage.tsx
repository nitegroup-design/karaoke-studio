import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, audioUrl } from '../api/client';
import { KaraokePreview } from '../components/KaraokePreview';
import { StyleModal } from '../components/StyleModal';
import type { KaraokePreset, LyricsData, TrackKind, VideoStyle } from '../types';

const DEFAULT_STYLE: VideoStyle = {
  font_family: 'Be Vietnam Pro',
  primary_color: 'rgba(255, 255, 255, 0.45)',
  secondary_color: '#FFFFFF',
  outline_color: 'transparent',
  effect: 'glow',
};

const readVideoStyle = (): VideoStyle => {
  try {
    const raw = JSON.parse(localStorage.getItem('karaoke-video-style:v1') || '{}') as Partial<VideoStyle>;
    return { ...DEFAULT_STYLE, ...raw };
  } catch {
    return DEFAULT_STYLE;
  }
};

const readVideoPreset = (): KaraokePreset => {
  try {
    const raw = JSON.parse(localStorage.getItem('karaoke-video-settings:v1') || '{}') as { preset?: KaraokePreset };
    return raw.preset === 'classic' ? 'classic' : 'modern';
  } catch {
    return 'modern';
  }
};

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

export const PreviewPage: React.FC = () => {
  const { songId = '' } = useParams<{ songId: string }>();
  const navigate = useNavigate();

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const hideControlsTimerRef = useRef<number | null>(null);

  const [lyrics, setLyrics] = useState<LyricsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);

  const [track, setTrack] = useState<TrackKind>('instrumental');
  const [preset, setPreset] = useState<KaraokePreset>(readVideoPreset);
  const [videoStyle, setVideoStyle] = useState<VideoStyle>(readVideoStyle);
  const [hasCustomBackground, setHasCustomBackground] = useState(false);
  const [backgroundRevision, setBackgroundRevision] = useState(0);
  const [showStyleModal, setShowStyleModal] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Load lyrics and background status
  useEffect(() => {
    if (!songId) return;
    let active = true;

    const loadData = async () => {
      setLoading(true);
      setLoadError('');
      try {
        const data = await api.getLyrics(songId);
        if (active) {
          setLyrics(data);
          setLoading(false);
        }
      } catch (err) {
        if (active) {
          setLoadError(err instanceof Error ? err.message : 'Không tải được dữ liệu lời bài hát.');
          setLoading(false);
        }
      }

      // Check if custom background exists
      try {
        const probe = new Image();
        probe.src = `${api.getBackgroundUrl(songId)}?probe=${Date.now()}`;
        probe.onload = () => { if (active) setHasCustomBackground(true); };
      } catch {
        // ignore
      }
    };

    void loadData();
    return () => { active = false; };
  }, [songId]);

  // Persist preset and style
  useEffect(() => {
    localStorage.setItem('karaoke-video-settings:v1', JSON.stringify({ preset }));
  }, [preset]);

  useEffect(() => {
    localStorage.setItem('karaoke-video-style:v1', JSON.stringify(videoStyle));
  }, [videoStyle]);

  // High precision time sync with requestAnimationFrame
  const syncPlaybackLoop = useCallback(() => {
    if (audioRef.current && !audioRef.current.paused) {
      setCurrentTime(audioRef.current.currentTime);
      rafRef.current = requestAnimationFrame(syncPlaybackLoop);
    }
  }, []);

  const handlePlay = () => {
    setIsPlaying(true);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(syncPlaybackLoop);
    scheduleHideControls(true);
  };

  const handlePause = () => {
    setIsPlaying(false);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
    setShowControls(true);
  };

  const togglePlay = useCallback(() => {
    if (!audioRef.current) return;
    if (audioRef.current.paused) {
      void audioRef.current.play();
    } else {
      audioRef.current.pause();
    }
  }, []);

  const handleSeek = useCallback((time: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = time;
    setCurrentTime(time);
  }, []);

  const nudgeTime = useCallback((delta: number) => {
    if (!audioRef.current) return;
    const target = Math.max(0, Math.min(duration, audioRef.current.currentTime + delta));
    handleSeek(target);
  }, [duration, handleSeek]);

  // Switch audio track seamlessly preserving current playback time
  const handleTrackChange = (newTrack: TrackKind) => {
    if (newTrack === track || !audioRef.current) return;
    const wasPlaying = !audioRef.current.paused;
    const prevTime = audioRef.current.currentTime;
    setTrack(newTrack);
    audioRef.current.src = audioUrl(songId, newTrack);
    audioRef.current.currentTime = prevTime;
    if (wasPlaying) {
      void audioRef.current.play();
    }
  };

  // Auto-hide controls during playback
  const scheduleHideControls = useCallback((forcePlaying?: boolean) => {
    if (hideControlsTimerRef.current) {
      window.clearTimeout(hideControlsTimerRef.current);
    }
    setShowControls(true);
    const shouldHide = forcePlaying !== undefined ? forcePlaying : isPlaying;
    if (shouldHide) {
      hideControlsTimerRef.current = window.setTimeout(() => {
        setShowControls(false);
      }, 3500);
    }
  }, [isPlaying]);

  const handleMouseMove = () => {
    scheduleHideControls();
  };

  // Fullscreen toggle
  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (showStyleModal) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        nudgeTime(-5);
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        nudgeTime(5);
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        void toggleFullscreen();
      } else if (e.key === 'Escape') {
        if (!document.fullscreenElement) {
          navigate(`/editor/${songId}`);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate, nudgeTime, showStyleModal, songId, togglePlay]);

  return (
    <div
      className="stage-fullscreen-wrapper"
      onMouseMove={handleMouseMove}
      style={{
        width: '100vw',
        height: '100vh',
        background: '#0a0a0f',
        position: 'relative',
        overflow: 'hidden',
        cursor: showControls ? 'default' : 'none',
      }}
    >
      {/* Hidden Audio Engine */}
      {songId && (
        <audio
          ref={audioRef}
          src={audioUrl(songId, track)}
          preload="auto"
          onPlay={handlePlay}
          onPause={handlePause}
          onLoadedMetadata={() => {
            if (audioRef.current) {
              setDuration(audioRef.current.duration);
            }
          }}
          onTimeUpdate={() => {
            if (audioRef.current && audioRef.current.paused) {
              setCurrentTime(audioRef.current.currentTime);
            }
          }}
          onEnded={() => setIsPlaying(false)}
        />
      )}

      {/* Main Karaoke Stage Viewport */}
      {loading ? (
        <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', color: '#f59e0b' }}>
          <div className="processing-orbit" style={{ fontSize: '2.5rem', animation: 'spin 1.5s linear infinite' }}>♫</div>
          <p style={{ fontSize: '1.1rem', fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>Đang chuẩn bị sân khấu biểu diễn…</p>
        </div>
      ) : loadError ? (
        <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', color: '#ef4444' }}>
          <p style={{ fontSize: '1.2rem', fontWeight: 600 }}>{loadError}</p>
          <button
            type="button"
            className="secondary-button"
            onClick={() => navigate(`/editor/${songId}`)}
            style={{ color: '#fff', padding: '0.6rem 1.4rem' }}
          >
            ← Quay lại trình chỉnh sửa
          </button>
        </div>
      ) : lyrics ? (
        <KaraokePreview
          songId={songId}
          lyrics={lyrics}
          currentTime={currentTime}
          preset={preset}
          style={videoStyle}
          hasCustomBackground={hasCustomBackground}
          backgroundRevision={backgroundRevision}
          onSeek={handleSeek}
        />
      ) : null}

      {/* Top Floating Control Bar */}
      <div
        className={`stage-hud-top ${showControls ? 'hud-visible' : 'hud-hidden'}`}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          padding: '1.25rem 2rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          zIndex: 40,
          background: 'linear-gradient(to bottom, rgba(5, 5, 10, 0.85), transparent)',
          transition: 'opacity 0.4s ease, transform 0.4s ease',
          opacity: showControls ? 1 : 0,
          transform: showControls ? 'translateY(0)' : 'translateY(-20px)',
          pointerEvents: showControls ? 'auto' : 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <button
            type="button"
            onClick={() => navigate(`/editor/${songId}`)}
            className="secondary-button"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.45rem 0.9rem',
              borderRadius: '999px',
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.15)',
              color: '#fff',
              fontSize: '0.88rem',
              backdropFilter: 'blur(12px)',
            }}
          >
            ← Quay lại Studio
          </button>
          {lyrics && (
            <span style={{ color: 'rgba(255,255,255,0.9)', fontWeight: 700, fontSize: '1.05rem', letterSpacing: '0.02em' }}>
              {lyrics.title}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {/* Preset Segmented Control */}
          <div
            style={{
              display: 'flex',
              padding: '3px',
              borderRadius: '999px',
              background: 'rgba(0,0,0,0.5)',
              border: '1px solid rgba(255,255,255,0.12)',
              backdropFilter: 'blur(12px)',
            }}
          >
            <button
              type="button"
              onClick={() => setPreset('modern')}
              style={{
                padding: '0.35rem 0.85rem',
                borderRadius: '999px',
                fontSize: '0.8rem',
                fontWeight: 650,
                border: 'none',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                background: preset === 'modern' ? 'linear-gradient(135deg, #f59e0b, #ea580c)' : 'transparent',
                color: preset === 'modern' ? '#fff' : 'rgba(255,255,255,0.65)',
              }}
            >
               Apple Music
            </button>
            <button
              type="button"
              onClick={() => setPreset('classic')}
              style={{
                padding: '0.35rem 0.85rem',
                borderRadius: '999px',
                fontSize: '0.8rem',
                fontWeight: 650,
                border: 'none',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                background: preset === 'classic' ? 'linear-gradient(135deg, #f59e0b, #ea580c)' : 'transparent',
                color: preset === 'classic' ? '#fff' : 'rgba(255,255,255,0.65)',
              }}
            >
              Classic KTV
            </button>
          </div>

          {/* Style Customizer Trigger */}
          <button
            type="button"
            onClick={() => setShowStyleModal(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.45rem 0.9rem',
              borderRadius: '999px',
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.15)',
              color: '#fff',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: 'pointer',
              backdropFilter: 'blur(12px)',
            }}
          >
            🎨 Chữ & Nền
          </button>

          {/* Fullscreen Toggle */}
          <button
            type="button"
            onClick={toggleFullscreen}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '38px',
              height: '38px',
              borderRadius: '999px',
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.15)',
              color: '#fff',
              fontSize: '1rem',
              cursor: 'pointer',
              backdropFilter: 'blur(12px)',
            }}
            title={isFullscreen ? 'Thoát toàn màn hình (F)' : 'Toàn màn hình (F)'}
          >
            {isFullscreen ? '⤦' : '⛶'}
          </button>
        </div>
      </div>

      {/* Bottom Floating Media Player Bar */}
      <div
        className={`stage-hud-bottom ${showControls ? 'hud-visible' : 'hud-hidden'}`}
        style={{
          position: 'absolute',
          bottom: '1.5rem',
          left: '50%',
          transform: `translateX(-50%) ${showControls ? 'translateY(0)' : 'translateY(24px)'}`,
          width: '92%',
          maxWidth: '860px',
          zIndex: 40,
          transition: 'opacity 0.4s ease, transform 0.4s ease',
          opacity: showControls ? 1 : 0,
          pointerEvents: showControls ? 'auto' : 'none',
        }}
      >
        <div
          style={{
            background: 'rgba(15, 16, 24, 0.78)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: '1.25rem',
            padding: '1rem 1.5rem',
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.6), 0 0 30px rgba(245, 158, 11, 0.15)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.85rem',
          }}
        >
          {/* Timeline Scrubber */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'rgba(255,255,255,0.65)', fontVariantNumeric: 'tabular-nums', minWidth: '40px' }}>
              {formatTime(currentTime)}
            </span>
            <input
              type="range"
              min={0}
              max={duration || 100}
              step={0.05}
              value={currentTime}
              onChange={(e) => handleSeek(Number(e.target.value))}
              style={{
                flex: 1,
                accentColor: '#f59e0b',
                cursor: 'pointer',
                height: '5px',
              }}
            />
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'rgba(255,255,255,0.65)', fontVariantNumeric: 'tabular-nums', minWidth: '40px' }}>
              {formatTime(duration)}
            </span>
          </div>

          {/* Controls row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
            {/* Left: Track Switcher */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginRight: '0.2rem' }}>ÂM THANH:</span>
              {(
                [
                  { id: 'instrumental', label: '🎵 Nhạc nền (Beat)' },
                  { id: 'vocals', label: '🎙 Giọng hát' },
                  { id: 'original', label: '🎼 Bài gốc' },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => handleTrackChange(t.id)}
                  style={{
                    padding: '0.35rem 0.75rem',
                    borderRadius: '999px',
                    fontSize: '0.78rem',
                    fontWeight: 650,
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'all 0.18s ease',
                    background: track === t.id ? '#f59e0b' : 'rgba(255,255,255,0.08)',
                    color: track === t.id ? '#0f172a' : 'rgba(255,255,255,0.7)',
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Center: Playback Buttons */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <button
                type="button"
                onClick={() => nudgeTime(-5)}
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  background: 'rgba(255,255,255,0.08)',
                  border: 'none',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                title="Lùi 5 giây (←)"
              >
                ⏪
              </button>

              <button
                type="button"
                onClick={togglePlay}
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #f59e0b, #ea580c)',
                  border: 'none',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: '1.25rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 4px 18px rgba(245, 158, 11, 0.45)',
                  transition: 'transform 0.15s ease',
                }}
                title={isPlaying ? 'Tạm dừng (Space)' : 'Phát nhạc (Space)'}
              >
                {isPlaying ? '⏸' : '▶'}
              </button>

              <button
                type="button"
                onClick={() => nudgeTime(5)}
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  background: 'rgba(255,255,255,0.08)',
                  border: 'none',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                title="Tua 5 giây (→)"
              >
                ⏩
              </button>
            </div>

            {/* Right: Volume */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <button
                type="button"
                onClick={() => {
                  if (!audioRef.current) return;
                  const nextMuted = !isMuted;
                  setIsMuted(nextMuted);
                  audioRef.current.muted = nextMuted;
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'rgba(255,255,255,0.7)',
                  cursor: 'pointer',
                  fontSize: '1rem',
                }}
              >
                {isMuted || volume === 0 ? '🔇' : volume < 0.5 ? '🔉' : '🔊'}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : volume}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setVolume(val);
                  setIsMuted(false);
                  if (audioRef.current) {
                    audioRef.current.volume = val;
                    audioRef.current.muted = false;
                  }
                }}
                style={{ width: '80px', accentColor: '#f59e0b', cursor: 'pointer', height: '4px' }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Style & Background Modal */}
      {showStyleModal && (
        <StyleModal
          songId={songId}
          style={videoStyle}
          hasCustomBackground={hasCustomBackground}
          onStyleChange={(newStyle) => setVideoStyle(newStyle)}
          onBackgroundUpdated={(hasBg) => {
            setHasCustomBackground(hasBg);
            setBackgroundRevision((prev) => prev + 1);
          }}
          onClose={() => setShowStyleModal(false)}
        />
      )}
    </div>
  );
};

