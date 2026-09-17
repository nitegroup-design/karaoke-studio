import React, { useEffect, useRef } from 'react';
import type { LyricsData } from '../types';
import type { KaraokeState } from './KaraokeEngine';

interface Props {
  lyrics: LyricsData;
  state: KaraokeState;
}

export const MultiLineKaraoke: React.FC<Props> = ({ lyrics, state }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  
  const { currentLineIndex, currentWordIndex, wordProgress } = state;

  useEffect(() => {
    if (containerRef.current && currentLineIndex >= 0) {
      const activeElement = containerRef.current.querySelector('.active-line') as HTMLElement;
      if (activeElement) {
        // Custom smooth scroll formula for better visual feel
        activeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [currentLineIndex]);

  return (
    <div 
      ref={containerRef}
      className="w-full h-full rounded-lg shadow-lg overflow-y-auto overflow-x-hidden relative flex flex-col items-center py-[40vh] scrollbar-hide perspective-1000"
      style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
    >
      <style>{`
        .scrollbar-hide::-webkit-scrollbar {
            display: none;
        }
      `}</style>
      
      {lyrics.lines.map((line, lineIdx) => {
        const isActive = lineIdx === currentLineIndex;
        const distance = Math.abs(lineIdx - currentLineIndex);
        
        let opacity = 1;
        let scale = 1;
        let translateY = 0;
        
        if (!isActive) {
          opacity = Math.max(0.05, 0.5 - (distance * 0.15));
          scale = Math.max(0.6, 0.9 - (distance * 0.05));
          translateY = lineIdx < currentLineIndex ? -distance * 5 : distance * 5;
        }

        return (
          <div 
            key={lineIdx}
            className={`transition-all duration-700 ease-out my-5 text-center px-4 w-full max-w-5xl ${isActive ? 'active-line' : ''}`}
            style={{
              opacity: currentLineIndex === -1 ? 0.7 : opacity,
              transform: `scale(${currentLineIndex === -1 ? 1 : scale}) translateY(${translateY}px) translateZ(0)`,
              filter: isActive ? 'blur(0px)' : `blur(${Math.min(distance * 1.5, 8)}px)`,
              willChange: 'transform, opacity, filter'
            }}
          >
            <p className={`font-bold transition-all duration-500 flex flex-wrap justify-center gap-y-3 ${isActive ? 'text-[3.5rem] md:text-6xl text-white tracking-tight' : 'text-3xl md:text-4xl text-gray-400'}`}>
              {line.words.map((word, wordIdx) => {
                const isWordActive = isActive && wordIdx === currentWordIndex;
                const isWordPast = isActive && wordIdx < currentWordIndex;
                
                return (
                  <span key={wordIdx} className="relative inline-block mx-[0.15em]">
                    {/* Background word */}
                    <span className="opacity-40 transition-opacity duration-300">
                      {word.word}
                    </span>
                    
                    {/* Foreground highlighted word */}
                    {(isWordActive || isWordPast) && (
                      <span 
                        className="absolute left-0 top-0 overflow-hidden text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-orange-500 to-orange-600 drop-shadow-[0_0_15px_rgba(245,158,11,0.5)]"
                        style={{ 
                          width: isWordPast ? '100%' : `${wordProgress * 100}%`,
                          whiteSpace: 'nowrap',
                          transition: isWordActive ? 'width 0.1s linear' : 'none'
                        }}
                      >
                        {word.word}
                      </span>
                    )}
                  </span>
                );
              })}
            </p>
          </div>
        );
      })}
    </div>
  );
};
