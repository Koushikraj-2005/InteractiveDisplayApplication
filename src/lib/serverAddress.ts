import { Capacitor } from '@capacitor/core';

/**
 * Where the app finds the weighing server.
 *
 * On a desktop browser the whole app is served by that same server, so a
 * same-origin relative URL ('/api') is correct and needs no configuration.
 *
 * Inside the Android build the page is served by the WebView from
 * https://localhost, so 'localhost' would mean the phone itself. There the
 * address of the machine holding the scale has to be entered once and kept in
 * localStorage, because the LAN address a router hands out will change sooner
 * or later and a baked-in URL would leave the app dead until it is rebuilt.
 */

const STORAGE_KEY = 'koushi.serverUrl';
export const DEFAULT_PORT = 3001;

export interface ParsedAddress {
  host: string;
  port: number;
}

/** True when running inside the Android/iOS shell rather than a browser tab. */
export const isNativeApp = (): boolean => Capacitor.isNativePlatform();

const normalizeHost = (raw: string): string =>
  (typeof raw === 'string' ? raw : '')
    .trim()
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/\/.*$/, '')
    .trim();

/**
 * Accepts what an operator would actually type — '192.168.1.23',
 * '192.168.1.23:3001', 'http://192.168.1.23:3001' — and returns a canonical
 * http origin, or null when the input cannot be used.
 */
export function parseAddress(input: string): ParsedAddress | null {
  const host = normalizeHost(input);
  if (!host) return null;
  // A bracketed IPv6 literal, or a bare one, may carry a port after a colon.
  const match = /^(.*?)(?::(\d{1,5}))?$/.exec(host);
  if (!match) return null;
  const parsedHost = match[1];
  if (!parsedHost) return null;
  const port = match[2] ? Number(match[2]) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (/\s/.test(parsedHost)) return null;
  return { host: parsedHost, port };
}

/** Canonical origin for an address, e.g. 'http://192.168.1.23:3001'. */
export const addressOrigin = ({ host, port }: ParsedAddress): string =>
  `http://${host.includes(':') ? `[${host}]` : host}:${port}`;

function readStored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private mode or storage disabled; the app then runs same-origin only.
    return null;
  }
}

let current: string | null = readStored();
const listeners = new Set<() => void>();

const emit = (): void => {
  for (const listener of listeners) listener();
};

/** Subscribe to address changes; returns an unsubscribe function. */
export function subscribeToServerAddress(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Current stored origin, or null when running same-origin. */
export function getServerOrigin(): string | null {
  if (!isNativeApp()) return null;
  return current;
}

/** Persist (or clear) the address. Throws on an unusable input. */
export function setServerOrigin(value: string | null): void {
  if (value == null || value.trim() === '') {
    current = null;
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // nothing persisted
    }
    emit();
    return;
  }
  const parsed = parseAddress(value);
  if (!parsed) throw new Error('That server address is not valid.');
  const origin = addressOrigin(parsed);
  current = origin;
  try {
    window.localStorage.setItem(STORAGE_KEY, origin);
  } catch {
    // Not persisted, but it still works for this session.
  }
  emit();
}

/** The configured origin, or '' for same-origin requests. */
export function serverBase(): string {
  if (!isNativeApp()) return '';
  return current ?? '';
}

/** Full URL for an API path, honouring the configured server. */
export function apiUrl(path: string): string {
  return `${serverBase()}/api${path}`;
}

/** Base for generated voice clips. */
export function ttsBase(): string {
  return `${serverBase()}/tts`;
}

/**
 * True when the app still needs a server address before it can do anything.
 * In the Android build that is exactly "nothing stored yet".
 */
export function needsServerAddress(): boolean {
  return isNativeApp() && !current;
}
