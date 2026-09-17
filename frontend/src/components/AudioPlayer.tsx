import React, { useRef, useState, useEffect } from 'react';

interface Props {
  songId: string;
  onTimeUpdate: (time: number) => void;
  audioRefCallback: (audio: HTMLAudioElement) => void;
}

export const AudioPlayer: React.FC<Props> = ({ songId, onTimeUpdate, audioRefCallback }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [track, setTrack] = useState<'original' | 'vocals' | 'instrumental'>('original');
  const [isHoveringVolume, setIsHoveringVolume] = useState(false);

  useEffect(() => {
    if (audioRef.current) {
      audioRefCallback(audioRef.current);
    }
  }, [audioRefCallback]);

  useEffect(() => {
    const handleSpace = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if (e.code === 'Space' && (e.target === document.body || (e.target as HTMLElement).tagName !== 'INPUT')) {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener('keydown', handleSpace);
    return () => window.removeEventListener('keydown', handleSpace);
  }, [isPlaying]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleTimeUpdate = () => {
    if (!audioRef.current) return;
    setCurrentTime(audioRef.current.currentTime);
    onTimeUpdate(audioRef.current.currentTime);
  };

  const handleLoadedMetadata = () => {
    if (!audioRef.current) return;
    setDuration(audioRef.current.duration);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!audioRef.current) return;
    const time = parseFloat(e.target.value);
    audioRef.current.currentTime = time;
    setCurrentTime(time);
  };

  const handleVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!audioRef.current) return;
    const vol = parseFloat(e.target.value);
    audioRef.current.volume = vol;
    setVolume(vol);
  };

  const formatTime = (time: number) => {
    const m = Math.floor(time / 60).toString().padStart(2, '0');
    const s = Math.floor(time % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const trackUrl = `http://localhost:8000/api/songs/${songId}/audio/${track}`;

  const changeTrack = (newTrack: typeof track) => {
    if (!audioRef.current) return;
    const time = audioRef.current.currentTime;
    const wasPlaying = !audioRef.current.paused;
    setTrack(newTrack);
    
    // Changing source will reload, need to restore state
    setTimeout(() => {
      if (audioRef.current) {
        audioRef.current.currentTime = time;
        if (wasPlaying) {
          audioRef.current.play();
        }
      }
    }, 50);
  };

  return (
    <div className="w-full flex flex-col gap-4">
      <audio
        ref={audioRef}
        src={trackUrl}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={() => setIsPlaying(false)}
      />
      
      <div className="flex justify-center gap-3 w-full max-w-sm mx-auto">
        {(['original', 'vocals', 'instrumental'] as const).map(t => (
          <button
            key={t}
            onClick={() => changeTrack(t)}
            className={`flex-1 py-1.5 rounded-full text-xs font-semibold transition-all duration-300 ${
              track === t 
                ? 'bg-amber-500 text-white shadow-md shadow-amber-500/30' 
                : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      
      <div className="flex items-center gap-4 w-full">
        <button 
          onClick={togglePlay}
          className="relative group w-12 h-12 flex-shrink-0 rounded-full flex items-center justify-center transition-all duration-300 active:scale-95 outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 focus:ring-offset-transparent"
        >
          <div className={`absolute inset-0 rounded-full bg-gradient-primary opacity-80 group-hover:opacity-100 transition-opacity ${isPlaying ? 'animate-pulse-glow' : 'shadow-lg'}`}></div>
          <div className="relative z-10 text-white">
            {isPlaying ? (
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
              </svg>
            ) : (
              <svg className="w-6 h-6 translate-x-0.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </div>
        </button>
        
        <div className="flex-1 flex flex-col gap-1.5 min-w-0">
          <div className="relative h-2 w-full group flex items-center cursor-pointer">
            <div className="absolute w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-primary transition-all duration-75"
                style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
              ></div>
            </div>
            <input
              type="range"
              min={0}
              max={duration || 100}
              value={currentTime}
              onChange={handleSeek}
              className="absolute w-full h-full opacity-0 cursor-pointer"
            />
            <div 
              className="absolute h-3 w-3 bg-white rounded-full shadow border border-gray-200 dark:border-gray-600 opacity-0 group-hover:opacity-100 transition-opacity transform -translate-x-1/2 pointer-events-none"
              style={{ left: `${duration ? (currentTime / duration) * 100 : 0}%` }}
            ></div>
          </div>
          <div className="flex justify-between text-xs font-mono text-gray-500 dark:text-gray-400">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        <div 
          className="relative flex items-center justify-center w-10 h-10 group"
          onMouseEnter={() => setIsHoveringVolume(true)}
          onMouseLeave={() => setIsHoveringVolume(false)}
        >
          <button className="text-gray-500 dark:text-gray-400 hover:text-amber-500 transition-colors">
            {volume === 0 ? (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              </svg>
            )}
          </button>

          {/* Vertical Volume Slider (appears on hover) */}
          <div className={`absolute bottom-full mb-2 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-3 flex flex-col items-center gap-2 transition-all duration-300 origin-bottom ${isHoveringVolume ? 'opacity-100 scale-100' : 'opacity-0 scale-75 pointer-events-none'}`}>
            <div className="relative h-24 w-1 flex justify-center bg-gray-200 dark:bg-gray-700 rounded-full">
              <div 
                className="absolute bottom-0 w-full bg-gradient-primary rounded-full transition-all duration-75"
                style={{ height: `${volume * 100}%` }}
              ></div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={handleVolume}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer -rotate-90 origin-center translate-y-[45px] w-[96px] h-[4px]"
                style={{ appearance: 'slider-vertical' as any }}
              />
            </div>
            <span className="text-[10px] font-mono font-medium text-gray-500">
              {Math.round(volume * 100)}
            </span>
          </div>
        </div>
      </div>
      
      {/* Visualizer animation */}
      {isPlaying && (
        <div className="flex items-center justify-center gap-1 h-6 mt-2 opacity-30">
          {Array.from({ length: 30 }).map((_, i) => (
            <div 
              key={i} 
              className="w-1 bg-amber-500 rounded-t-sm animate-wave" 
              style={{ 
                height: `${Math.random() * 100 + 20}%`,
                animationDuration: `${Math.random() * 0.5 + 0.5}s`,
                animationDelay: `${Math.random() * 0.5}s`
              }}
            ></div>
          ))}
        </div>
      )}
    </div>
  );
};
