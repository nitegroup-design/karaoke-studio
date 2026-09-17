import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import type { LyricsData } from '../types';
import { KaraokeEngine, type KaraokeState } from '../components/KaraokeEngine';
import { WordByWordKaraoke } from '../components/WordByWordKaraoke';
import { MultiLineKaraoke } from '../components/MultiLineKaraoke';
import { AudioPlayer } from '../components/AudioPlayer';

export const PreviewPage: React.FC = () => {
  const { songId } = useParams<{ songId: string }>();
  const navigate = useNavigate();
  const [lyrics, setLyrics] = useState<LyricsData | null>(null);
  const [mode, setMode] = useState<1 | 2>(1);
  const [karaokeState, setKaraokeState] = useState<KaraokeState>({ currentLineIndex: -1, currentWordIndex: -1, wordProgress: 0 });
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const engineRef = useRef<KaraokeEngine | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    const fetchLyrics = async () => {
      try {
        const res = await axios.get(`http://localhost:8000/api/lyrics/${songId}`);
        setLyrics(res.data);
      } catch (err) {
        console.error('Failed to fetch lyrics', err);
      }
    };
    if (songId) fetchLyrics();
  }, [songId]);

  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight
        });
      }
    };
    window.addEventListener('resize', updateDimensions);
    updateDimensions();
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  useEffect(() => {
    if (lyrics && audioElement) {
      if (!engineRef.current) {
        engineRef.current = new KaraokeEngine();
      }
      engineRef.current.init(lyrics, audioElement, setKaraokeState);
      
      const handlePlay = () => setIsPlaying(true);
      const handlePause = () => setIsPlaying(false);
      
      audioElement.addEventListener('play', handlePlay);
      audioElement.addEventListener('pause', handlePause);
      
      return () => {
        audioElement.removeEventListener('play', handlePlay);
        audioElement.removeEventListener('pause', handlePause);
      }
    }
    return () => {
      if (engineRef.current) {
        engineRef.current.stop();
      }
    };
  }, [lyrics, audioElement]);

  return (
    <div className="h-screen w-screen bg-[#0b0b0f] flex flex-col relative overflow-hidden group">
      
      {/* Dynamic Background Glow */}
      <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full blur-[150px] transition-all duration-[3s] pointer-events-none ${isPlaying ? 'bg-amber-500/10 scale-110' : 'bg-orange-600/5 scale-100'}`}></div>

      {/* Top overlay controls */}
      <div className="absolute top-0 left-0 right-0 p-6 flex justify-between items-center z-20 opacity-0 group-hover:opacity-100 transition-all duration-500 bg-gradient-to-b from-black/90 to-transparent">
        <button 
          onClick={() => navigate(`/editor/${songId}`)} 
          className="flex items-center gap-2 text-white/70 hover:text-white bg-white/5 hover:bg-white/10 px-4 py-2 rounded-full backdrop-blur-md transition-all duration-300"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Quay lại
        </button>
        
        <div className="flex gap-1 bg-white/10 p-1.5 rounded-full backdrop-blur-md border border-white/10 shadow-xl">
          <button 
            onClick={() => setMode(1)}
            className={`px-6 py-2 rounded-full font-medium transition-all duration-300 ${mode === 1 ? 'bg-gradient-primary text-white shadow-lg' : 'text-gray-300 hover:text-white hover:bg-white/5'}`}
          >
            Classic
          </button>
          <button 
            onClick={() => setMode(2)}
            className={`px-6 py-2 rounded-full font-medium transition-all duration-300 ${mode === 2 ? 'bg-gradient-primary text-white shadow-lg' : 'text-gray-300 hover:text-white hover:bg-white/5'}`}
          >
            Modern
          </button>
        </div>

        <button 
          onClick={() => {
            axios.post(`http://localhost:8000/api/export/${songId}`);
            alert('Đang xuất video...');
          }} 
          className="flex items-center gap-2 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-white px-6 py-2.5 rounded-full font-medium transition-all duration-300 shadow-lg shadow-emerald-500/20"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Export
        </button>
      </div>

      {/* Main Karaoke View */}
      <div ref={containerRef} className="flex-1 w-full h-full relative z-10">
        {lyrics ? (
          mode === 1 ? (
            <WordByWordKaraoke lyrics={lyrics} state={karaokeState} width={dimensions.width} height={dimensions.height} />
          ) : (
            <MultiLineKaraoke lyrics={lyrics} state={karaokeState} />
          )
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-white/50">
            <div className="w-12 h-12 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mb-4"></div>
            Đang tải dữ liệu...
          </div>
        )}
      </div>

      {/* Bottom overlay audio controls */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 w-full max-w-3xl z-20 opacity-0 group-hover:opacity-100 transition-all duration-500 px-6 transform translate-y-4 group-hover:translate-y-0">
        <div className="glass-card rounded-2xl shadow-2xl border border-white/10 bg-black/60 backdrop-blur-xl p-4">
          {songId && (
            <AudioPlayer 
              songId={songId} 
              onTimeUpdate={() => {}}
              audioRefCallback={setAudioElement}
            />
          )}
        </div>
      </div>
    </div>
  );
};
