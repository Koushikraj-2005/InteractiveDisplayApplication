import { localizedName } from './items.js';

const LANG_CODES = {
  en: 'en-US',
  hi: 'hi-IN',
  bn: 'bn-IN',
  ta: 'ta-IN',
};

const audioCache = new Map();
let currentAudio = null;

if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
}

function pickVoice(langCode) {
  const voices = window.speechSynthesis.getVoices();
  const exactly = langCode.toLowerCase().replace('_', '-');
  const prefix = exactly.split('-')[0];
  return (
    voices.find((v) => v.lang && v.lang.toLowerCase().replace('_', '-') === exactly) ||
    voices.find((v) => v.lang && v.lang.toLowerCase().replace('_', '-').startsWith(prefix)) ||
    null
  );
}

function speakWithSystemVoice(text, lang) {
  const code = LANG_CODES[lang] || 'en-US';
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = code;
  const voice = pickVoice(code);
  if (voice) utterance.voice = voice;
  utterance.rate = 0.95;
  window.setTimeout(() => window.speechSynthesis.speak(utterance), 80);
}

function getCached(lang, id) {
  const key = `${lang}/${id}`;
  let element = audioCache.get(key);
  if (!element) {
    element = new Audio(`/tts/${lang}/${id}.mp3`);
    element.preload = 'auto';
    element.onended = () => {
      if (currentAudio === element) currentAudio = null;
    };
    audioCache.set(key, element);
  }
  return element;
}

export function preloadAll(items, langs) {
  if (typeof window === 'undefined') return;
  for (const lang of langs) {
    for (const item of items) {
      if (!item.slug) continue;
      try {
        getCached(lang.code, item.slug).load();
      } catch {
        // ignore per-file failures
      }
    }
  }
}

export function speakItem(item, lang = 'en') {
  if (!item) return;
  stopSpeaking();

  const text = localizedName(item, lang);
  let element;
  try {
    element = getCached(lang, item.slug);
  } catch {
    speakWithSystemVoice(text, lang);
    return;
  }
  currentAudio = element;

  const fallback = () => {
    if (currentAudio !== element) return;
    currentAudio = null;
    speakWithSystemVoice(text, lang);
  };

  const unmute = () => {
    element.muted = false;
  };

  element.onerror = fallback;
  element.muted = true;
  element.currentTime = 0;

  const promise = element.play();
  if (promise && typeof promise.then === 'function') {
    promise.then(unmute).catch(() => {
      unmute();
      fallback();
    });
  } else {
    unmute();
  }
}

export function voiceEngine() {
  return 'LOCAL';
}

export function stopSpeaking() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  if (currentAudio) {
    try {
      currentAudio.pause();
      currentAudio.currentTime = 0;
    } catch {
      // element already gone
    }
    currentAudio = null;
  }
}