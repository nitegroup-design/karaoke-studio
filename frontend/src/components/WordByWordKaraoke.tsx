import React, { useRef, useEffect } from 'react';
import type { LyricsData } from '../types';
import type { KaraokeState } from './KaraokeEngine';

interface Props {
  lyrics: LyricsData;
  state: KaraokeState;
  width: number;
  height: number;
}

export const WordByWordKaraoke: React.FC<Props> = ({ lyrics, state, width, height }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    const { currentLineIndex, currentWordIndex, wordProgress } = state;
    
    const drawLine = (lineIndex: number, y: number, isActive: boolean) => {
      if (lineIndex < 0 || lineIndex >= lyrics.lines.length) return;
      const line = lyrics.lines[lineIndex];
      
      const fontSize = isActive ? 56 : 48;
      ctx.font = `bold ${fontSize}px "Inter", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      
      const fullText = line.words.map(w => w.word).join(' ');
      const textWidth = ctx.measureText(fullText).width;
      let startX = (width - textWidth) / 2;

      // Base layer (unfilled text)
      line.words.forEach((word) => {
        const wordText = word.word + ' ';
        const wordWidth = ctx.measureText(wordText).width;
        
        ctx.fillStyle = isActive ? 'rgba(255, 255, 255, 0.4)' : 'rgba(255, 255, 255, 0.2)';
        
        // Add subtle shadow to base text
        ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 2;
        
        ctx.fillText(word.word, startX + wordWidth / 2 - ctx.measureText(' ').width/2, y);
        startX += wordWidth;
      });

      // Highlight layer
      if (isActive) {
        let hStartX = (width - textWidth) / 2;
        
        line.words.forEach((word, idx) => {
          const wordText = word.word + ' ';
          const wordWidth = ctx.measureText(wordText).width;
          
          if (idx <= currentWordIndex) {
            ctx.save();
            ctx.beginPath();
            let fillWidth = wordWidth;
            if (idx === currentWordIndex) {
              fillWidth = wordWidth * wordProgress;
            }
            ctx.rect(hStartX, y - fontSize, fillWidth, fontSize * 2);
            ctx.clip();
            
            // Amber/Orange gradient for active word
            const gradient = ctx.createLinearGradient(hStartX, y - fontSize/2, hStartX + wordWidth, y + fontSize/2);
            gradient.addColorStop(0, '#f59e0b'); // amber-500
            gradient.addColorStop(0.5, '#f97316'); // orange-500
            gradient.addColorStop(1, '#ea580c'); // orange-600
            
            ctx.fillStyle = gradient;
            
            // Strong glow effect for active text
            ctx.shadowColor = 'rgba(245, 158, 11, 0.6)';
            ctx.shadowBlur = 15;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;
            
            ctx.fillText(word.word, hStartX + wordWidth / 2 - ctx.measureText(' ').width/2, y);
            ctx.restore();
          }
          
          hStartX += wordWidth;
        });
      }
    };

    if (currentLineIndex >= 0) {
      drawLine(currentLineIndex, height / 2 - 50, true);
      drawLine(currentLineIndex + 1, height / 2 + 50, false);
    } else {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.font = 'bold 48px "Inter", system-ui, sans-serif';
      ctx.textAlign = 'center';
      
      ctx.shadowColor = 'rgba(245, 158, 11, 0.5)';
      ctx.shadowBlur = 10;
      
      const dotsCount = Math.floor(Date.now() / 500) % 4;
      ctx.fillText('Đang chuẩn bị' + '.'.repeat(dotsCount), width / 2, height / 2);
    }
  }, [lyrics, state, width, height]);

  return (
    <canvas 
      ref={canvasRef} 
      width={width} 
      height={height}
      className="w-full h-full bg-transparent"
    />
  );
};
