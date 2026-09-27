import { localizedName } from './items.ts';
import type { LangCode, NameBearing } from './types.ts';

// Web Speech keeps speaking after the terminal unmounts unless every pending
// utterance is cancelled, so a screen change alone must stop the voice.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    try {
      window.speechSynthesis?.cancel();
    } catch {
      // nothing to cancel
    }
  });
}

const LANG_CODES: Record<string, string> = {
  en: 'en-US',
  hi: 'hi-IN',
  bn: 'bn-IN',
  ta: 'ta-IN',
};

const audioCache = new Map<string, HTMLAudioElement>();
let currentAudio: HTMLAudioElement | null = null;
let speakTimer: number | null = null;

if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
}

/** Prefers an exact BCP-47 voice, then any voice for the same language. */
function pickVoice(langCode: string): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  const exactly = langCode.toLowerCase().replace('_', '-');
  const prefix = exactly.split('-')[0];
  return (
    voices.find((v) => v.lang && v.lang.toLowerCase().replace('_', '-') === exactly) ||
    voices.find((v) => v.lang && v.lang.toLowerCase().replace('_', '-').startsWith(prefix)) ||
    null
  );
}

function speakWithSystemVoice(text: string, lang: string): void {
  const code = LANG_CODES[lang] || 'en-US';
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = code;
  const voice = pickVoice(code);
  if (voice) utterance.voice = voice;
  utterance.rate = 0.95;
  // The small delay lets a cancelled audio file stop before the fallback
  // voice starts. The handle is kept so stopSpeaking() can cancel it —
  // otherwise navigating away mid-delay leaves the name spoken afterwards.
  clearSpeakTimer();
  speakTimer = window.setTimeout(() => {
    speakTimer = null;
    try {
      window.speechSynthesis.speak(utterance);
    } catch {
      // speech synthesis unavailable
    }
  }, 80);
}

function clearSpeakTimer(): void {
  if (speakTimer != null) {
    window.clearTimeout(speakTimer);
    speakTimer = null;
  }
}

function getCached(lang: string, id: string): HTMLAudioElement {
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

/** Warms the audio cache so the first play is not delayed by a download. */
export function preloadAll(
  items: NameBearing[],
  langs: Array<{ code: LangCode }>,
): void {
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

/**
 * Drops every cached audio element. Called when a component unmounts so the
 * cache does not pin dozens of media elements (and their decoded buffers) for
 * the life of the page.
 */
export function disposeAudioCache(): void {
  clearSpeakTimer();
  stopSpeaking();
  for (const element of audioCache.values()) {
    try {
      element.onended = null;
      element.onerror = null;
      element.removeAttribute('src');
      element.load();
    } catch {
      // element already released
    }
  }
  audioCache.clear();
}

export function speakItem(item: NameBearing | null | undefined, lang: LangCode = 'en'): void {
  if (!item) return;
  stopSpeaking();

  const text = localizedName(item, lang);
  if (!item.slug) {
    speakWithSystemVoice(text, lang);
    return;
  }
  let element: HTMLAudioElement;
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

  // Start muted: a play() that is rejected by autoplay policy is recoverable,
  // but one that blasts audio before the user gesture is not.
  const unmute = () => {
    element.muted = false;
  };

  element.onerror = fallback;
  element.muted = true;
  element.currentTime = 0;

  const promise = element.play();
  if (promise && typeof promise.then === 'function') {
    promise
      .then(() => {
        unmute();
        // The error handler is per-attempt: leaving it attached would let a
        // later preload failure speak a stale name at a random moment.
        if (currentAudio === element) element.onerror = null;
      })
      .catch(() => {
        unmute();
        fallback();
      });
  } else {
    unmute();
    element.onerror = null;
  }
}

export function voiceEngine(): string {
  return 'LOCAL';
}

export function stopSpeaking(): void {
  clearSpeakTimer();
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
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
