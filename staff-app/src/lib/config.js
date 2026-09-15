const ROOT = (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '');

export const API_BASE = `${ROOT}/api`;
export const TTS_BASE = `${ROOT}/tts`;