import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, initDb, queryAll, queryOne, run } from './db.ts';
import {
  createScaleHttpHandlers,
  listSerialPorts,
  ScaleService,
  SUPPORTED_BAUD_RATES,
} from './scale/index.ts';
import {
  deleteItemAudio,
  downloadItemAudio,
  ensureTtsDirs,
  resolveNames,
  TTS_DIR,
} from './tts.ts';
import { roundOffWeight, roundTargetWeight } from '../shared/targetWeight.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 3001);

initDb();
ensureTtsDirs();

export const app = express();

// Hardening headers. A kiosk on a shop LAN, so no CDN, no cross-origin needs
// and nothing here should ever break the app when the API is same-origin.
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  next();
});

// Cross-origin access is denied by default. The two browser clients are served
// from this same process in production, so nothing needs it. CORS_ORIGIN exists
// for the cases that genuinely cross origins, and accepts a single origin or a
// comma separated allowlist (never '*'):
//
//  - http://localhost, https://localhost   the Capacitor shells
//  - capacitor://localhost                  the iOS shell
//  - http://192.168.x.x:5173 etc. a client served by a different dev machine
//
// This is a browser-side control only: it does not stop a device on the LAN from
// calling the API directly, so it must not be mistaken for authentication.
const CORS_ALWAYS_ALLOWED = ['http://localhost', 'https://localhost', 'capacitor://localhost'];
const corsOrigins = [
  ...CORS_ALWAYS_ALLOWED,
  ...(process.env.CORS_ORIGIN || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
];
// This must stay enabled: the Android app is a genuinely cross-origin client.
// Its WebView runs at http://localhost and calls the API at the LAN address
// typed into ServerScreen, so without these headers the WebView blocks every
// response and the app can never reach the server — while curl and the Vite dev
// clients (proxied, therefore same-origin) work fine and hide the problem.
app.use('/api', (req, res, next) => {
  const origin = req.headers.origin;
  if (!origin) return next();
  if (!corsOrigins.includes(origin)) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

app.use(express.json({ limit: '256kb' }));
app.use('/tts', (req, res, next) => {
  // The voice clips are fetched from the same server by the Android WebView,
  // so they need the same origin allowance as the API.
  const origin = req.headers.origin;
  if (origin && corsOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  next();
});
app.use(
  '/tts',
  express.static(TTS_DIR, {
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
  }),
);

/** An error carrying an HTTP status, so handlers can bail out with one. */
class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'HttpError';
  }
}

const httpError = (status: number, message: string): HttpError => new HttpError(status, message);

const errorStatus = (err: unknown, fallback: number): number =>
  err instanceof HttpError ? err.status : fallback;

const errorMessage = (err: unknown, fallback: string): string =>
  err instanceof Error ? err.message : fallback;

const parseOptionalWeight = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** `YYYY-MM-DDTHH:MM` with an optional `:SS`, matching localIsoNow(). */
const WEIGHED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

/**
 * Normalises a client-supplied timestamp, or returns null when it is not a
 * usable date. Every report buckets on substr(weighed_at, 1, 7), so a junk
 * value here permanently removes a bill from its month.
 */
const normalizeWeighedAt = (value: unknown): string | null => {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return null;
  const stamp = raw.slice(0, 19);
  if (!WEIGHED_AT_PATTERN.test(stamp)) return null;
  // Reject impossible calendar values such as 2026-13-45 or 25:90.
  const [datePart, timePart] = stamp.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm, ss] = timePart.split(':').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  if (hh > 23 || mm > 59 || ss > 59) return null;
  const parsed = new Date(y, m - 1, d, hh, mm, ss);
  if (
    parsed.getFullYear() !== y ||
    parsed.getMonth() + 1 !== m ||
    parsed.getDate() !== d
  ) {
    return null;
  }
  return stamp;
};

// ---------- Row shapes returned by SQLite ----------

interface ItemRow {
  id: number;
  slug: string;
  code: string;
  name: string;
  name_hi: string;
  name_bn: string;
  name_ta: string;
  created_at: string;
}

interface FormulaRow {
  id: number;
  name: string;
  item_count: number;
  total_weight: number;
  created_at: string;
}

interface FormulaLineRow {
  id: number;
  formulaId: number;
  itemId: number | null;
  itemName: string;
  requiredWeight: number;
  position: number;
}

interface WeighingRow {
  id: number;
  batch_no: string;
  weighed_at: string;
  formula_name: string | null;
  item_count: number;
  total_weight: number;
}

interface WeighingLineRow {
  id: number;
  weighing_id: number;
  item_id: number | null;
  item_name: string;
  required_weight: number;
  actual_weight: number | null;
}

interface CountRow {
  n: number;
}

interface CodeRow {
  code: string;
}

interface OverviewTotalsRow {
  bills: number;
  items: number;
  totalKg: number;
}

interface MonthBucketRow {
  month: string;
  bills: number;
  items: number;
  totalKg: number;
}

interface PerItemRow {
  itemName: string;
  times: number;
  totalKg: number;
}

interface PerFormulaRow {
  formulaName: string;
  bills: number;
  totalKg: number;
}

interface FormulaLineInput {
  itemId: number;
  itemName: string;
  requiredWeight: number;
}

interface WeighingLineInput {
  itemId: number | null;
  itemName: string;
  requiredWeight: number;
  /** Measured weight, when the client captured one. Null = not recorded. */
  actualWeight: number | null;
}

const MAX_NAME_LENGTH = 60;
const MAX_NATIVE_LENGTH = 60;
const MAX_FORMULA_LINES = 80;

const NATIVE_FIELD_LABELS = {
  name_hi: 'Hindi name',
  name_bn: 'Bengali name',
  name_ta: 'Tamil name',
};

const cleanName = (value: unknown, label: string): string => {
  const name = String(value || '').trim();
  if (!name) throw httpError(400, `${label} is required`);
  if (name.length > MAX_NAME_LENGTH) {
    throw httpError(400, `${label} must be ${MAX_NAME_LENGTH} characters or fewer`);
  }
  return name;
};

app.get('/api/health', (_req, res) => {
  try {
    db.prepare('SELECT 1 AS ok').get();
    res.json({ ok: true, db: 'connected' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, db: 'error' });
  }
});

// ---------------------------------------------------------------------------
// Weighing scale (YH-T7E / YAOHUA over serial).
// SCALE_ENABLED=0 keeps the reader dormant so the API can run on machines
// with no scale attached (the simulation mode does not need it).
// ---------------------------------------------------------------------------
const scaleEnabled = process.env.SCALE_ENABLED !== '0';
const scale = new ScaleService();
const scaleHandlers = createScaleHttpHandlers(scale);
if (scaleEnabled) scale.start();

app.get('/api/scale/ports', async (_req, res) => {
  const ports = await listSerialPorts();
  res.json({
    enabled: scaleEnabled,
    ports,
    baudRates: SUPPORTED_BAUD_RATES,
    current: scale.getStatus(),
  });
});

app.get('/api/scale/status', scaleHandlers.status);
app.get('/api/scale/stream', scaleHandlers.stream);

app.post('/api/scale/connect', async (req, res) => {
  if (!scaleEnabled) throw httpError(503, 'Scale support is disabled (SCALE_ENABLED=0)');
  const { port, baudRate } = (req.body || {}) as { port?: string; baudRate?: number };
  if (baudRate != null && !SUPPORTED_BAUD_RATES.includes(Number(baudRate))) {
    throw httpError(400, `Unsupported baud rate. Use one of: ${SUPPORTED_BAUD_RATES.join(', ')}`);
  }
  if (port != null && String(port).trim() === '') {
    throw httpError(400, 'Serial port is required');
  }
  const status = await scale.configure({ portPath: port, baudRate });
  if (!scale.isRunning) scale.start();
  res.json(status);
});

app.post('/api/scale/disconnect', (_req, res) => {
  scale.stop();
  res.json(scale.getStatus());
});

const toItemJson = (row: ItemRow) => ({
  id: row.id,
  slug: row.slug,
  code: row.code,
  name: row.name,
  names: { en: row.name, hi: row.name_hi, bn: row.name_bn, ta: row.name_ta },
  createdAt: row.created_at,
});

app.get('/api/items', (_req, res) => {
  res.json(queryAll<ItemRow>('SELECT * FROM items ORDER BY code ASC, name ASC').map(toItemJson));
});

const slugify = (text: string): string =>
  text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'item';

app.post('/api/items', async (req, res) => {
  const name = cleanName(req.body.name, 'Item name');

  for (const [field, label] of Object.entries(NATIVE_FIELD_LABELS)) {
    const val = String(req.body[field] || '').trim();
    if (val.length > MAX_NATIVE_LENGTH) {
      return res.status(400).json({ error: `${label} must be ${MAX_NATIVE_LENGTH} characters or fewer` });
    }
  }

  const existing = queryOne<CountRow>('SELECT COUNT(*) AS n FROM items WHERE name = ?', name);
  if (Number(existing?.n ?? 0) > 0) {
    return res.status(409).json({ error: `Item "${name}" already exists` });
  }

  const nextCodeRow = queryOne<CodeRow>(
    "SELECT code FROM items WHERE code LIKE 'RM-%' ORDER BY code DESC LIMIT 1",
  );
  const nextNum = nextCodeRow ? parseInt(nextCodeRow.code.slice(3), 10) + 1 : 1;
  const code = `RM-${String(nextNum).padStart(2, '0')}`;

  let slug = slugify(name);
  const slugExists = queryOne<CountRow>('SELECT COUNT(*) AS n FROM items WHERE slug = ?', slug);
  if (Number(slugExists?.n ?? 0) > 0) slug = `${slug}-${nextNum}`;

  let names: { hi: string; bn: string; ta: string };
  try {
    names = await resolveNames(name, {
      hi: req.body.name_hi,
      bn: req.body.name_bn,
      ta: req.body.name_ta,
    });
  } catch (err) {
    console.warn('name resolution failed, using English: ' + errorMessage(err, 'unknown error'));
    names = { hi: name, bn: name, ta: name };
  }

  const info = run(
    'INSERT INTO items (slug, code, name, name_hi, name_bn, name_ta) VALUES (?, ?, ?, ?, ?, ?)',
    slug,
    code,
    name,
    names.hi,
    names.bn,
    names.ta,
  );
  const row = queryOne<ItemRow>('SELECT * FROM items WHERE id = ?', info.lastInsertRowid);

  try {
    await downloadItemAudio(slug, { en: name, ...names });
  } catch (err) {
    console.warn('item audio download failed: ' + errorMessage(err, 'unknown error'));
  }

  res.status(201).json(toItemJson(row as ItemRow));
});

app.delete('/api/items/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = queryOne<{ slug: string }>('SELECT slug FROM items WHERE id = ?', id);
  if (!row) {
    return res.status(404).json({ error: 'Item not found' });
  }

  // Deleting an item used to leave formula_lines pointing at a row that no
  // longer exists, so the formula showed a line with no item behind it. Past
  // bills keep their own item_name snapshot, so refusing here is safe.
  const usedBy = queryAll<{ name: string }>(
    'SELECT f.name AS name FROM formula_lines fl JOIN formulas f ON f.id = fl.formula_id WHERE fl.item_id = ? ORDER BY f.name',
    id,
  );
  if (usedBy.length > 0) {
    const preview = usedBy.slice(0, 3).map((f) => f.name);
    return res.status(409).json({
      error: `This item is used by ${usedBy.length} formula${usedBy.length === 1 ? '' : 's'} (${preview.join(', ')}${usedBy.length > 3 ? ', …' : ''}). Delete or update those formulas first.`,
      formulas: usedBy.map((f) => f.name),
    });
  }

  run('DELETE FROM items WHERE id = ?', id);
  deleteItemAudio(row.slug);
  res.json({ ok: true });
});

// ---------- Formulas ----------

const toFormulaJson = (row: FormulaRow, lines: FormulaLineRow[]) => ({
  id: row.id,
  name: row.name,
  itemCount: row.item_count,
  totalWeight: row.total_weight,
  createdAt: row.created_at,
  lines,
});

const parseFormulaBody = (body: Record<string, unknown>) => {
  const name = cleanName(body.name, 'Formula name');

  const rawLines = Array.isArray(body.lines) ? body.lines : [];
  const lines: FormulaLineInput[] = [];
  const seenItems = new Set<number>();
  for (const raw of rawLines) {
    if (lines.length >= MAX_FORMULA_LINES) break;
    const itemId = Number(raw.itemId);
    const requiredWeight = parseOptionalWeight(raw.requiredWeight);
    if (!Number.isInteger(itemId) || itemId <= 0) continue;
    if (requiredWeight == null || requiredWeight <= 0) continue;
    if (seenItems.has(itemId)) continue;
    seenItems.add(itemId);
    const item = queryOne<{ id: number; name: string }>(
      'SELECT id, name FROM items WHERE id = ?',
      itemId,
    );
    if (!item) continue;
    lines.push({
      itemId,
      itemName: item.name,
      requiredWeight: roundTargetWeight(requiredWeight),
    });
  }
  if (lines.length === 0) {
    throw httpError(400, 'Formula needs at least one valid ingredient with a weight above zero');
  }
  return { name, lines };
};

const formulaLinesSql =
  'SELECT id, formula_id AS formulaId, item_id AS itemId, item_name AS itemName, required_weight AS requiredWeight, position FROM formula_lines WHERE formula_id = ? ORDER BY position ASC';

const formulaLinesInsertSql =
  'INSERT INTO formula_lines (formula_id, item_id, item_name, required_weight, position) VALUES (?, ?, ?, ?, ?)';

app.get('/api/formulas', (_req, res) => {
  const rows = queryAll<FormulaRow>('SELECT * FROM formulas ORDER BY name ASC');
  const lineRows = queryAll<FormulaLineRow>(
    'SELECT id, formula_id AS formulaId, item_id AS itemId, item_name AS itemName, required_weight AS requiredWeight, position FROM formula_lines ORDER BY formula_id ASC, position ASC',
  );
  const byFormula = new Map<number, FormulaLineRow[]>();
  for (const line of lineRows) {
    const key = Number(line.formulaId);
    if (!byFormula.has(key)) byFormula.set(key, []);
    byFormula.get(key)?.push(line);
  }
  res.json(rows.map((row) => toFormulaJson(row, byFormula.get(Number(row.id)) || [])));
});

app.post('/api/formulas', (req, res) => {
  let parsed: { name: string; lines: FormulaLineInput[] };
  try {
    parsed = parseFormulaBody(req.body ?? {});
  } catch (err) {
    return res.status(errorStatus(err, 400)).json({ error: errorMessage(err, 'Invalid formula') });
  }

  const existing = queryOne<CountRow>('SELECT COUNT(*) AS n FROM formulas WHERE name = ?', parsed.name);
  if (Number(existing?.n ?? 0) > 0) {
    return res.status(409).json({ error: `Formula "${parsed.name}" already exists` });
  }

  const itemCount = parsed.lines.length;
  const totalWeight =
    Math.round(parsed.lines.reduce((sum, line) => sum + line.requiredWeight, 0) * 1000) / 1000;

  const insertFormulaSql = 'INSERT INTO formulas (name, item_count, total_weight) VALUES (?, ?, ?)';
  const insertLineSql =
    'INSERT INTO formula_lines (formula_id, item_id, item_name, required_weight, position) VALUES (?, ?, ?, ?, ?)';

  db.exec('BEGIN');
  try {
    const info = run(insertFormulaSql, parsed.name, itemCount, totalWeight);
    const formulaId = Number(info.lastInsertRowid);
    parsed.lines.forEach((line, index) =>
      run(insertLineSql, formulaId, line.itemId, line.itemName, line.requiredWeight, index),
    );
    db.exec('COMMIT');
    const row = queryOne<FormulaRow>('SELECT * FROM formulas WHERE id = ?', formulaId);
    res.status(201).json(
      toFormulaJson(
        row as FormulaRow,
        parsed.lines.map((line, index) => ({ id: index, formulaId, ...line, position: index })),
      ),
    );
  } catch (err) {
    db.exec('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to save formula' });
  }
});

app.put('/api/formulas/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!queryOne<{ id: number }>('SELECT id FROM formulas WHERE id = ?', id)) {
    return res.status(404).json({ error: 'Formula not found' });
  }

  let parsed: { name: string; lines: FormulaLineInput[] };
  try {
    parsed = parseFormulaBody(req.body ?? {});
  } catch (err) {
    return res.status(errorStatus(err, 400)).json({ error: errorMessage(err, 'Invalid formula') });
  }

  const nameDup = queryOne<CountRow>(
    'SELECT COUNT(*) AS n FROM formulas WHERE name = ? AND id != ?',
    parsed.name,
    id,
  );
  if (Number(nameDup?.n ?? 0) > 0) {
    return res.status(409).json({ error: `Formula "${parsed.name}" already exists` });
  }

  const itemCount = parsed.lines.length;
  const totalWeight =
    Math.round(parsed.lines.reduce((sum, line) => sum + line.requiredWeight, 0) * 1000) / 1000;

  db.exec('BEGIN');
  try {
    run(
      'UPDATE formulas SET name = ?, item_count = ?, total_weight = ? WHERE id = ?',
      parsed.name,
      itemCount,
      totalWeight,
      id,
    );
    run('DELETE FROM formula_lines WHERE formula_id = ?', id);
    parsed.lines.forEach((line, index) =>
      run(
        formulaLinesInsertSql,
        id,
        line.itemId,
        line.itemName,
        line.requiredWeight,
        index,
      ),
    );
    db.exec('COMMIT');
    const row = queryOne<FormulaRow>('SELECT * FROM formulas WHERE id = ?', id);
    res.json(
      toFormulaJson(
        row as FormulaRow,
        queryAll<FormulaLineRow>(formulaLinesSql, id),
      ),
    );
  } catch (err) {
    db.exec('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to update formula' });
  }
});

app.delete('/api/formulas/:id', (req, res) => {
  const info = run('DELETE FROM formulas WHERE id = ?', Number(req.params.id));
  if (info.changes === 0) {
    return res.status(404).json({ error: 'Formula not found' });
  }
  res.json({ ok: true });
});

// ---------- Weighings (bills) ----------

const pad = (n: number) => String(n).padStart(2, '0');
const localIsoNow = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

app.post('/api/weighings', (req, res) => {
  const body = req.body || {};
  const rawLines = Array.isArray(body.lines) ? body.lines : [];
  if (rawLines.length > MAX_FORMULA_LINES) {
    return res
      .status(400)
      .json({ error: `A bill can hold at most ${MAX_FORMULA_LINES} line items` });
  }
  const lines: WeighingLineInput[] = [];
  for (const raw of rawLines) {
    const itemId = Number.isFinite(Number(raw.itemId)) ? Math.floor(Number(raw.itemId)) : null;
    const name = String(raw.itemName || '').trim() || 'Item';
    const weight = parseOptionalWeight(raw.requiredWeight);
    if (weight == null || weight <= 0) continue;
    const actual = parseOptionalWeight(raw.actualWeight);
    lines.push({
      itemId,
      itemName: name.slice(0, MAX_NAME_LENGTH),
      requiredWeight: roundTargetWeight(weight),
      // Rounded like the target, so a bill shows the same whole kilograms the
      // operator was shown when the line was accepted.
      actualWeight: actual != null && actual >= 0 ? roundOffWeight(actual) : null,
    });
  }
  if (lines.length === 0) {
    return res.status(400).json({
      error: 'A completed weighing needs at least one line item with a weight above zero',
    });
  }

  const itemCount = lines.length;
  const totalWeight = lines.reduce((sum, line) => sum + line.requiredWeight, 0);
  // weighed_at is the axis every report groups on, so a malformed value would
  // silently drop a bill out of its month forever. Accept only a real
  // YYYY-MM-DDTHH:MM[:SS] stamp (or an ISO string we can truncate to one).
  const weighedAt =
    (body.weighedAt ? normalizeWeighedAt(body.weighedAt) : localIsoNow()) || null;
  if (!weighedAt) {
    return res
      .status(400)
      .json({ error: 'weighedAt must look like 2026-09-27T14:30 (YYYY-MM-DDTHH:MM:SS)' });
  }
  const formulaName = String(body.formulaName || '').trim().slice(0, MAX_NAME_LENGTH) || null;

  const insertWeighingSql =
    'INSERT INTO weighings (batch_no, weighed_at, item_count, total_weight, formula_name) VALUES (?, ?, ?, ?, ?)';
  const insertLineSql =
    'INSERT INTO weighing_lines (weighing_id, item_id, item_name, required_weight, actual_weight) VALUES (?, ?, ?, ?, ?)';

  db.exec('BEGIN');
  try {
    const info = run(insertWeighingSql, '', weighedAt, itemCount, Math.round(totalWeight * 1000) / 1000, formulaName);
    const id = Number(info.lastInsertRowid);
    const batchNo = `WS-${String(id).padStart(5, '0')}`;
    run('UPDATE weighings SET batch_no = ? WHERE id = ?', batchNo, id);
    for (const line of lines) {
      run(insertLineSql, id, line.itemId, line.itemName, line.requiredWeight, line.actualWeight ?? null);
    }
    db.exec('COMMIT');
    const bill = queryOne<WeighingRow>('SELECT * FROM weighings WHERE id = ?', id);
    res.status(201).json({ ...toBillJson(bill as WeighingRow), lines });
  } catch (err) {
    db.exec('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to save weighing' });
  }
});

const toBillJson = (row: WeighingRow) => ({
  id: row.id,
  batchNo: row.batch_no,
  weighedAt: row.weighed_at,
  formulaName: row.formula_name || null,
  itemCount: row.item_count,
  totalWeight: row.total_weight,
});

app.get('/api/weighings', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const rows = queryAll<WeighingRow>(
    'SELECT * FROM weighings ORDER BY weighed_at DESC, id DESC LIMIT ?',
    limit,
  );
  res.json(rows.map(toBillJson));
});

app.get('/api/weighings/:id', (req, res) => {
  const bill = queryOne<WeighingRow>('SELECT * FROM weighings WHERE id = ?', Number(req.params.id));
  if (!bill) return res.status(404).json({ error: 'Bill not found' });
  const lines = queryAll<Omit<WeighingLineRow, 'weighing_id'>>(
    'SELECT id, item_id AS itemId, item_name AS itemName, required_weight AS requiredWeight, actual_weight AS actualWeight FROM weighing_lines WHERE weighing_id = ? ORDER BY id ASC',
    bill.id,
  );
  res.json({ ...toBillJson(bill), lines });
});

// ---------- Reports ----------

app.get('/api/reports/overview', (_req, res) => {
  const totals = queryOne<OverviewTotalsRow>(
    'SELECT COUNT(*) AS bills, COALESCE(SUM(item_count), 0) AS items, ROUND(COALESCE(SUM(total_weight), 0), 3) AS totalKg FROM weighings',
  );

  const now = new Date();
  const months: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
    months.push(key);
  }

  const grouped = queryAll<MonthBucketRow>(
    `SELECT substr(weighed_at, 1, 7) AS month,
            COUNT(*) AS bills,
            COALESCE(SUM(item_count), 0) AS items,
            ROUND(COALESCE(SUM(total_weight), 0), 3) AS totalKg
     FROM weighings
     WHERE substr(weighed_at, 1, 7) >= ?
     GROUP BY month`,
    months[0],
  );

  const map = new Map<string, MonthBucketRow>(grouped.map((row) => [row.month, row]));
  const series = months.map((month) => map.get(month) || { month, bills: 0, items: 0, totalKg: 0 });

  res.json({ totals, series });
});

app.get('/api/reports/monthly', (req, res) => {
  const year = Number(req.query.year);
  const month = Number(req.query.month);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return res.status(400).json({ error: 'year and month (1-12) are required' });
  }
  const key = `${year}-${pad(month)}`;

  const summary = queryOne<OverviewTotalsRow>(
    `SELECT COUNT(*) AS bills,
            COALESCE(SUM(item_count), 0) AS items,
            ROUND(COALESCE(SUM(total_weight), 0), 3) AS totalKg
     FROM weighings WHERE substr(weighed_at, 1, 7) = ?`,
    key,
  );

  const perItem = queryAll<PerItemRow>(
    `SELECT item_name AS itemName,
            COUNT(*) AS times,
            ROUND(SUM(required_weight), 3) AS totalKg
     FROM weighing_lines
     WHERE weighing_id IN (SELECT id FROM weighings WHERE substr(weighed_at, 1, 7) = ?)
     GROUP BY item_name
     ORDER BY totalKg DESC, itemName ASC`,
    key,
  );

  const perFormula = queryAll<PerFormulaRow>(
    `SELECT formula_name AS formulaName,
            COUNT(*) AS bills,
            ROUND(SUM(total_weight), 3) AS totalKg
     FROM weighings
     WHERE substr(weighed_at, 1, 7) = ? AND formula_name IS NOT NULL
     GROUP BY formula_name
     ORDER BY totalKg DESC, formulaName ASC`,
    key,
  );

  res.json({ year, month, key, summary, perItem, perFormula });
});

app.get('/api/reports/yearly', (req, res) => {
  const year = Number(req.query.year);
  if (!Number.isInteger(year)) {
    return res.status(400).json({ error: 'year is required' });
  }

  const rows = queryAll<MonthBucketRow>(
    `SELECT substr(weighed_at, 1, 7) AS month,
            COUNT(*) AS bills,
            COALESCE(SUM(item_count), 0) AS items,
            ROUND(COALESCE(SUM(total_weight), 0), 3) AS totalKg
     FROM weighings WHERE substr(weighed_at, 1, 4) = ?
     GROUP BY month`,
    String(year),
  );

  const filled: MonthBucketRow[] = [];
  for (let m = 1; m <= 12; m++) {
    const key = `${year}-${pad(m)}`;
    const row = rows.find((r) => r.month === key);
    filled.push(row || { month: key, bills: 0, items: 0, totalKg: 0 });
  }

  const totals = filled.reduce<OverviewTotalsRow>(
    (acc, m) => {
      acc.bills += Number(m.bills ?? 0);
      acc.items += Number(m.items ?? 0);
      acc.totalKg =
        Math.round((Number(acc.totalKg ?? 0) + Number(m.totalKg ?? 0)) * 1000) / 1000;
      return acc;
    },
    { bills: 0, items: 0, totalKg: 0 },
  );

  res.json({ year, months: filled, totals });
});

// ---------- Static serving (production) ----------

const dist = path.join(ROOT, 'dist');
const staffDist = path.join(ROOT, 'staff-app', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  if (fs.existsSync(staffDist)) {
    app.get('/staff', (_req, res) => {
      res.sendFile(path.join(staffDist, 'index.html'));
    });
    app.use('/staff', express.static(staffDist));
  }
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api') && !req.path.startsWith('/staff')) {
      return res.sendFile(path.join(dist, 'index.html'));
    }
    next();
  });
}

// An unknown /api path used to fall through to Express's default HTML 404,
// which the clients then surfaced as "Unexpected token < in JSON".
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Unknown API endpoint' });
});

app.use(
  (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    const status = errorStatus(err, 500);
    res
      .status(status)
      .json({ error: status === 500 ? 'Server error' : errorMessage(err, 'Server error') });
  },
);

if (process.env.NODE_ENV !== 'test') {
  const server = app.listen(PORT, () => {
    console.log(`Weighing server listening on http://localhost:${PORT}`);
    console.log(`DB: ${process.env.DB_PATH || path.join(__dirname, 'data.db')}`);
  });
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use — is another server already running?`);
      process.exit(1);
    }
    throw err;
  });

  // A kiosk gets restarted, suspended and unplugged. Without this the process
  // dies holding the serial port and an open SQLite handle, which makes the
  // next boot fail or silently keep stale readings.
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${signal} received, shutting down…`);
    scale.stop();
    server.close(() => {
      try {
        db.close();
      } catch {
        // already closed
      }
      console.log('Closed cleanly');
      process.exit(0);
    });
    // Don't hang a supervised restart on a lingering keep-alive socket.
    server.closeIdleConnections?.();
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
