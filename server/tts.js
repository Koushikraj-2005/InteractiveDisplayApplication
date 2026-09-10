import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const TTS_DIR = path.join(__dirname, 'storage', 'tts');

const TARGET_LANGS = ['en', 'hi', 'bn', 'ta'];
const UA = { 'User-Agent': 'Mozilla/5.0' };
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function ensureTtsDirs() {
  for (const lang of TARGET_LANGS) {
    fs.mkdirSync(path.join(TTS_DIR, lang), { recursive: true });
  }
}

async function translateText(text, target) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${target}&dt=t&q=${encodeURIComponent(text)}`;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`translate http ${res.status}`);
  const data = await res.json();
  const translated = (data[0] || []).map((segment) => segment[0]).join('').trim();
  return translated || text;
}

export async function resolveNames(name, provided = {}) {
  const base = { hi: '', bn: '', ta: '' };
  for (const lang of ['hi', 'bn', 'ta']) {
    const given = String(provided[lang] || '').trim();
    if (given) {
      base[lang] = given;
    } else {
      try {
        base[lang] = await translateText(name, lang);
      } catch (err) {
        console.warn(`translate fallback ${lang}: ${err.message}`);
        base[lang] = name;
      }
    }
  }
  return base;
}

async function downloadMp3(text, lang, filePath) {
  const url = `https://translate.googleapis.com/translate_tts?ie=UTF-8&client=gtx&tl=${lang}&q=${encodeURIComponent(text)}`;
  const res = await fetch(url, { headers: UA });
  const buffer = Buffer.from(await res.arrayBuffer());
  const type = res.headers.get('content-type') || '';
  if (!res.ok || buffer.length < 2000 || !type.includes('audio')) {
    throw new Error(`bad tts http=${res.status} type=${type} bytes=${buffer.length}`);
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buffer);
}

export async function downloadItemAudio(slug, names) {
  for (const lang of TARGET_LANGS) {
    const filePath = path.join(TTS_DIR, lang, `${slug}.mp3`);
    try {
      await downloadMp3(names[lang] || names.en || slug, lang, filePath);
      console.log(`TTS OK  ${lang}/${slug}`);
    } catch (err) {
      console.warn(`TTS FAIL ${lang}/${slug}: ${err.message}`);
    }
    await delay(300);
  }
}

export function deleteItemAudio(slug) {
  for (const lang of TARGET_LANGS) {
    try {
      fs.rmSync(path.join(TTS_DIR, lang, `${slug}.mp3`), { force: true });
    } catch {
      // ignore removal errors
    }
  }
}