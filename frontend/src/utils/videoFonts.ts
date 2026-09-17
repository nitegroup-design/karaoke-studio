import { API_BASE_URL } from '../api/client';

/** These exact full Vietnamese font files are also passed to FFmpeg/libass. */
export const videoFonts: Record<string, string> = Object.fromEntries(Object.entries({
  'Be Vietnam Pro': 'BeVietnamPro-Bold.ttf',
  Montserrat: 'Montserrat-Bold.ttf',
  'Playfair Display': 'PlayfairDisplay-Bold.ttf',
  Lexend: 'Lexend-Bold.ttf',
  Oswald: 'Oswald-Bold.ttf',
  Roboto: 'Roboto-Bold.ttf',
}).map(([family, file]) => [family, `${API_BASE_URL}/api/fonts/${file}`]));

let loaded = false;
export function loadVideoFonts() {
  if (loaded) return;
  loaded = true;
  for (const [family, url] of Object.entries(videoFonts)) {
    const face = new FontFace(family, `url("${url}")`, { weight: '700' });
    void face.load().then((font) => document.fonts.add(font)).catch(() => { loaded = false; });
  }
}
