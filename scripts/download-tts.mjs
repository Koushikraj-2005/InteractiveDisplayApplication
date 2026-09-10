import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SEED_ITEMS } from '../server/seedData.js';
import { VOICE_LANGS } from '../src/lib/items.js';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'storage', 'tts');

const NAMES = { en: 'name', hi: 'hi', bn: 'bn', ta: 'ta' };

const seedName = (item, lang) => item[NAMES[lang]] || item.name;

const ttsUrl = (text, lang) =>
  `https://translate.googleapis.com/translate_tts?ie=UTF-8&client=gtx&tl=${lang}&q=${encodeURIComponent(text)}`;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let ok = 0;
let fail = 0;

for (const lang of VOICE_LANGS) {
  for (const item of SEED_ITEMS) {
    const text = seedName(item, lang.code);
    const file = path.join(OUT, lang.code, `${item.slug}.mp3`);
    await mkdir(path.dirname(file), { recursive: true });

    let done = false;
    for (let attempt = 1; attempt <= 3 && !done; attempt++) {
      try {
        const res = await fetch(ttsUrl(text, lang.code), {
          headers: { 'User-Agent': 'Mozilla/5.0' },
        });
        const buffer = Buffer.from(await res.arrayBuffer());
        const type = res.headers.get('content-type') || '';
        if (res.ok && buffer.length > 2000 && type.includes('audio')) {
          await writeFile(file, buffer);
          console.log(`OK   ${lang.code}/${item.slug}  (${buffer.length}B)`);
          ok += 1;
          done = true;
        } else {
          console.warn(
            `BAD  ${lang.code}/${item.slug}  http=${res.status} type=${type} bytes=${buffer.length}`,
          );
        }
      } catch (error) {
        console.warn(`ERR  ${lang.code}/${item.slug}  attempt ${attempt}: ${error.message}`);
      }
      if (!done) await delay(800);
    }
    if (!done) {
      fail += 1;
      console.error(`FAIL ${lang.code}/${item.slug}`);
    }
    await delay(250);
  }
}

console.log(`\nDone. ${ok} downloaded, ${fail} failed.`);