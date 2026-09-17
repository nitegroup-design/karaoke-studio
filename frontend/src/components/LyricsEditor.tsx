import React, { useState } from 'react';
import type { LyricsData, LyricLine, LyricWord } from '../types';

interface Props {
  lyrics: LyricsData;
  onChange: (newLyrics: LyricsData) => void;
}

const formatTime = (time: number | null) => {
  if (time === null) return '';
  const m = Math.floor(time / 60).toString().padStart(2, '0');
  const s = Math.floor(time % 60).toString().padStart(2, '0');
  const ms = Math.floor((time % 1) * 100).toString().padStart(2, '0');
  return `${m}:${s}.${ms}`;
};

const parseTime = (timeStr: string): number => {
  const parts = timeStr.split(':');
  if (parts.length === 1) return parseFloat(timeStr) || 0;
  
  const m = parseInt(parts[0]);
  const s = parseFloat(parts[1]);
  return (m * 60) + s;
};

export const LyricsEditor: React.FC<Props> = ({ lyrics, onChange }) => {
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  const toggleRow = (index: number) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedRows(newExpanded);
  };

  const updateLine = (index: number, field: keyof LyricLine, value: any) => {
    const newLines = [...lyrics.lines];
    newLines[index] = { ...newLines[index], [field]: value };
    onChange({ ...lyrics, lines: newLines });
  };

  const updateWord = (lineIndex: number, wordIndex: number, field: keyof LyricWord, value: any) => {
    const newLines = [...lyrics.lines];
    const newWords = [...newLines[lineIndex].words];
    newWords[wordIndex] = { ...newWords[wordIndex], [field]: value };
    newLines[lineIndex] = { ...newLines[lineIndex], words: newWords };
    onChange({ ...lyrics, lines: newLines });
  };

  const deleteLine = (index: number) => {
    const newLines = lyrics.lines.filter((_, i) => i !== index);
    onChange({ ...lyrics, lines: newLines });
  };

  const addLine = (index: number) => {
    const newLines = [...lyrics.lines];
    const newLine: LyricLine = {
      id: `line-${crypto.randomUUID()}`,
      start: null,
      end: null,
      text: 'New Line',
      locked: false,
      review_required: true,
      review_reasons: ['unaligned_text'],
      words: [
        { id: `word-${crypto.randomUUID()}`, word: 'New', start: null, end: null, review_required: true, review_reasons: ['unaligned_text'] },
        { id: `word-${crypto.randomUUID()}`, word: 'Line', start: null, end: null, review_required: true, review_reasons: ['unaligned_text'] }
      ]
    };
    newLines.splice(index + 1, 0, newLine);
    onChange({ ...lyrics, lines: newLines });
  };

  return (
    <div className="flex-1 overflow-auto rounded-xl">
      <table className="w-full text-left text-sm whitespace-nowrap">
        <thead className="sticky top-0 bg-gray-50/90 dark:bg-gray-900/90 backdrop-blur-md z-10 text-gray-500 dark:text-gray-400 text-xs uppercase font-semibold shadow-sm">
          <tr>
            <th className="px-6 py-4 w-12 rounded-tl-xl">#</th>
            <th className="px-4 py-4 w-28">Bắt đầu</th>
            <th className="px-4 py-4 w-28">Kết thúc</th>
            <th className="px-4 py-4 min-w-[300px]">Lời bài hát</th>
            <th className="px-6 py-4 w-24 text-right rounded-tr-xl">Thao tác</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
          {lyrics.lines.map((line, idx) => {
            const isExpanded = expandedRows.has(idx);
            return (
              <React.Fragment key={idx}>
                <tr className="group transition-colors duration-200 hover:bg-amber-50/50 dark:hover:bg-amber-500/5">
                  <td className="px-6 py-3 cursor-pointer" onClick={() => toggleRow(idx)}>
                    <div className="flex items-center gap-3">
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center transition-all duration-300 ${isExpanded ? 'bg-amber-500 text-white rotate-90' : 'bg-gray-200 dark:bg-gray-800 text-gray-500 group-hover:bg-amber-200 dark:group-hover:bg-amber-900/50 group-hover:text-amber-600'}`}>
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                      <span className="font-mono text-gray-400 text-xs">{String(idx + 1).padStart(3, '0')}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <input 
                      type="text" 
                      value={formatTime(line.start)}
                      onChange={(e) => updateLine(idx, 'start', parseTime(e.target.value))}
                      className="bg-transparent border border-transparent hover:border-gray-200 focus:border-amber-500 dark:hover:border-gray-700 dark:focus:border-amber-500 rounded px-2 py-1 w-20 text-sm font-mono transition-colors outline-none text-gray-600 dark:text-gray-300 focus:bg-white dark:focus:bg-gray-900"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <input 
                      type="text" 
                      value={formatTime(line.end)}
                      onChange={(e) => updateLine(idx, 'end', parseTime(e.target.value))}
                      className="bg-transparent border border-transparent hover:border-gray-200 focus:border-amber-500 dark:hover:border-gray-700 dark:focus:border-amber-500 rounded px-2 py-1 w-20 text-sm font-mono transition-colors outline-none text-gray-600 dark:text-gray-300 focus:bg-white dark:focus:bg-gray-900"
                    />
                  </td>
                  <td className="px-4 py-3 w-full">
                    <input 
                      type="text" 
                      value={line.text}
                      onChange={(e) => updateLine(idx, 'text', e.target.value)}
                      className="bg-transparent border border-transparent hover:border-gray-200 focus:border-amber-500 dark:hover:border-gray-700 dark:focus:border-amber-500 rounded px-3 py-1.5 w-full text-base font-medium text-gray-900 dark:text-white transition-colors outline-none focus:bg-white dark:focus:bg-gray-900"
                    />
                  </td>
                  <td className="px-6 py-3">
                    <div className="flex gap-2 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                        onClick={() => addLine(idx)} 
                        title="Thêm dòng bên dưới"
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-emerald-600 bg-emerald-100 hover:bg-emerald-200 dark:text-emerald-400 dark:bg-emerald-500/20 dark:hover:bg-emerald-500/30 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                      </button>
                      <button 
                        onClick={() => deleteLine(idx)} 
                        title="Xóa dòng này"
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-red-600 bg-red-100 hover:bg-red-200 dark:text-red-400 dark:bg-red-500/20 dark:hover:bg-red-500/30 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
                
                {isExpanded && (
                  <tr className="bg-gray-50/50 dark:bg-gray-900/30 border-b border-gray-100 dark:border-gray-800/50">
                    <td colSpan={5} className="px-6 py-6">
                      <div className="flex flex-wrap gap-4 pl-12 animate-slide-up" style={{ animationDuration: '0.3s' }}>
                        {line.words.map((word, wIdx) => (
                          <div key={wIdx} className="bg-white dark:bg-gray-800 p-3 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 flex flex-col gap-3 group/word hover:border-amber-500/50 hover:shadow-md transition-all">
                            <input 
                              type="text" 
                              value={word.word}
                              onChange={(e) => updateWord(idx, wIdx, 'word', e.target.value)}
                              className="bg-gray-50 dark:bg-gray-900 border border-transparent focus:border-amber-500 rounded px-2 py-1 text-sm font-bold w-full text-center text-amber-600 dark:text-amber-400 outline-none transition-colors"
                            />
                            <div className="flex gap-1.5 text-xs items-center justify-center">
                              <input 
                                type="text" 
                                value={formatTime(word.start)}
                                onChange={(e) => updateWord(idx, wIdx, 'start', parseTime(e.target.value))}
                                className="bg-transparent border-b border-dashed border-gray-300 dark:border-gray-600 focus:border-solid focus:border-amber-500 px-1 w-[4.5rem] text-center font-mono outline-none text-gray-500 dark:text-gray-400 transition-colors"
                              />
                              <span className="text-gray-300 dark:text-gray-600">-</span>
                              <input 
                                type="text" 
                                value={formatTime(word.end)}
                                onChange={(e) => updateWord(idx, wIdx, 'end', parseTime(e.target.value))}
                                className="bg-transparent border-b border-dashed border-gray-300 dark:border-gray-600 focus:border-solid focus:border-amber-500 px-1 w-[4.5rem] text-center font-mono outline-none text-gray-500 dark:text-gray-400 transition-colors"
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
