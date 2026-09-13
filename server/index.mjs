import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, initDb } from './db.js';
import {
  deleteItemAudio,
  downloadItemAudio,
  ensureTtsDirs,
  resolveNames,
  TTS_DIR,
} from './tts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 3001);

initDb();
ensureTtsDirs();

export const app = express();
app.use(express.json());
app.use(
  '/tts',
  express.static(TTS_DIR, {
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
  }),
);

const parseOptionalWeight = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};



const toItemJson = (row) => ({
  id: row.id,
  slug: row.slug,
  code: row.code,
  name: row.name,
  names: { en: row.name, hi: row.name_hi, bn: row.name_bn, ta: row.name_ta },
  createdAt: row.created_at,
});

app.get('/api/items', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM items ORDER BY code ASC, name ASC')
    .all();
  res.json(rows.map(toItemJson));
});

const slugify = (text) =>
  text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'item';

app.post('/api/items', async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) {
    return res.status(400).json({ error: 'Item name is required' });
  }

  const existing = db.prepare('SELECT COUNT(*) AS n FROM items WHERE name = ?').get(name);
  if (existing.n > 0) {
    return res.status(409).json({ error: `Item "${name}" already exists` });
  }

  const nextCodeRow = db
    .prepare("SELECT code FROM items WHERE code LIKE 'RM-%' ORDER BY code DESC LIMIT 1")
    .get();
  const nextNum = nextCodeRow ? parseInt(nextCodeRow.code.slice(3), 10) + 1 : 1;
  const code = `RM-${String(nextNum).padStart(2, '0')}`;

  let slug = slugify(name);
  const slugExists = db.prepare('SELECT COUNT(*) AS n FROM items WHERE slug = ?').get(slug);
  if (slugExists.n > 0) slug = `${slug}-${nextNum}`;

  let names;
  try {
    names = await resolveNames(name, {
      hi: req.body.name_hi,
      bn: req.body.name_bn,
      ta: req.body.name_ta,
    });
  } catch (err) {
    console.warn('name resolution failed, using English: ' + err.message);
    names = { hi: name, bn: name, ta: name };
  }

  const info = db
    .prepare(
      'INSERT INTO items (slug, code, name, name_hi, name_bn, name_ta) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(slug, code, name, names.hi, names.bn, names.ta);
  const row = db.prepare('SELECT * FROM items WHERE id = ?').get(info.lastInsertRowid);

  try {
    await downloadItemAudio(slug, { en: name, ...names });
  } catch (err) {
    console.warn('item audio download failed: ' + err.message);
  }

  res.status(201).json(toItemJson(row));
});

app.delete('/api/items/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT slug FROM items WHERE id = ?').get(id);
  if (!row) {
    return res.status(404).json({ error: 'Item not found' });
  }
  db.prepare('DELETE FROM items WHERE id = ?').run(id);
  deleteItemAudio(row.slug);
  res.json({ ok: true });
});

// ---------- Recipes ----------

const httpError = (status, message) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const toRecipeJson = (row, lines) => ({
  id: row.id,
  name: row.name,
  itemCount: row.item_count,
  totalWeight: row.total_weight,
  createdAt: row.created_at,
  lines,
});

const parseRecipeBody = (body) => {
  const name = String(body.name || '').trim();
  if (!name) throw httpError(400, 'Recipe name is required');

  const rawLines = Array.isArray(body.lines) ? body.lines : [];
  const lines = [];
  for (const raw of rawLines) {
    const itemId = Number(raw.itemId);
    const requiredWeight = parseOptionalWeight(raw.requiredWeight);
    if (!Number.isInteger(itemId) || itemId <= 0) continue;
    if (requiredWeight == null || requiredWeight <= 0) continue;
    const item = db.prepare('SELECT id, name FROM items WHERE id = ?').get(itemId);
    if (!item) continue;
    lines.push({
      itemId,
      itemName: item.name,
      requiredWeight: Math.round(requiredWeight * 1000) / 1000,
    });
  }
  if (lines.length === 0) {
    throw httpError(400, 'Recipe needs at least one valid ingredient with a weight above zero');
  }
  return { name, lines };
};

const recipeLinesSql =
  'SELECT id, recipe_id AS recipeId, item_id AS itemId, item_name AS itemName, required_weight AS requiredWeight, position FROM recipe_lines WHERE recipe_id = ? ORDER BY position ASC';

app.get('/api/recipes', (req, res) => {
  const rows = db.prepare('SELECT * FROM recipes ORDER BY name ASC').all();
  const lineRows = db.prepare(
    'SELECT id, recipe_id AS recipeId, item_id AS itemId, item_name AS itemName, required_weight AS requiredWeight, position FROM recipe_lines ORDER BY recipe_id ASC, position ASC',
  ).all();
  const byRecipe = new Map();
  for (const line of lineRows) {
    if (!byRecipe.has(line.recipeId)) byRecipe.set(line.recipeId, []);
    byRecipe.get(line.recipeId).push(line);
  }
  res.json(rows.map((row) => toRecipeJson(row, byRecipe.get(row.id) || [])));
});

app.post('/api/recipes', (req, res) => {
  let parsed;
  try {
    parsed = parseRecipeBody(req.body);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }

  const existing = db.prepare('SELECT COUNT(*) AS n FROM recipes WHERE name = ?').get(parsed.name);
  if (existing.n > 0) {
    return res.status(409).json({ error: `Recipe "${parsed.name}" already exists` });
  }

  const itemCount = parsed.lines.length;
  const totalWeight =
    Math.round(parsed.lines.reduce((sum, line) => sum + line.requiredWeight, 0) * 1000) / 1000;

  const insertRecipe = db.prepare(
    'INSERT INTO recipes (name, item_count, total_weight) VALUES (?, ?, ?)',
  );
  const insertLine = db.prepare(
    'INSERT INTO recipe_lines (recipe_id, item_id, item_name, required_weight, position) VALUES (?, ?, ?, ?, ?)',
  );

  db.exec('BEGIN');
  try {
    const info = insertRecipe.run(parsed.name, itemCount, totalWeight);
    const recipeId = Number(info.lastInsertRowid);
    parsed.lines.forEach((line, index) =>
      insertLine.run(recipeId, line.itemId, line.itemName, line.requiredWeight, index),
    );
    db.exec('COMMIT');
    const row = db.prepare('SELECT * FROM recipes WHERE id = ?').get(recipeId);
    res.status(201).json(toRecipeJson(row, parsed.lines));
  } catch (err) {
    db.exec('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to save recipe' });
  }
});

app.put('/api/recipes/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT id FROM recipes WHERE id = ?').get(id)) {
    return res.status(404).json({ error: 'Recipe not found' });
  }

  let parsed;
  try {
    parsed = parseRecipeBody(req.body);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }

  const nameDup = db
    .prepare('SELECT COUNT(*) AS n FROM recipes WHERE name = ? AND id != ?')
    .get(parsed.name, id);
  if (nameDup.n > 0) {
    return res.status(409).json({ error: `Recipe "${parsed.name}" already exists` });
  }

  const itemCount = parsed.lines.length;
  const totalWeight =
    Math.round(parsed.lines.reduce((sum, line) => sum + line.requiredWeight, 0) * 1000) / 1000;

  db.exec('BEGIN');
  try {
    db.prepare('UPDATE recipes SET name = ?, item_count = ?, total_weight = ? WHERE id = ?').run(
      parsed.name,
      itemCount,
      totalWeight,
      id,
    );
    db.prepare('DELETE FROM recipe_lines WHERE recipe_id = ?').run(id);
    const insertLine = db.prepare(
      'INSERT INTO recipe_lines (recipe_id, item_id, item_name, required_weight, position) VALUES (?, ?, ?, ?, ?)',
    );
    parsed.lines.forEach((line, index) =>
      insertLine.run(id, line.itemId, line.itemName, line.requiredWeight, index),
    );
    db.exec('COMMIT');
    const row = db.prepare('SELECT * FROM recipes WHERE id = ?').get(id);
    res.json(toRecipeJson(row, db.prepare(recipeLinesSql).all(id)));
  } catch (err) {
    db.exec('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to update recipe' });
  }
});

app.delete('/api/recipes/:id', (req, res) => {
  const info = db.prepare('DELETE FROM recipes WHERE id = ?').run(Number(req.params.id));
  if (info.changes === 0) {
    return res.status(404).json({ error: 'Recipe not found' });
  }
  res.json({ ok: true });
});

// ---------- Weighings (bills) ----------

const pad = (n) => String(n).padStart(2, '0');
const localIsoNow = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

app.post('/api/weighings', (req, res) => {
  const body = req.body || {};
  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (lines.length === 0) {
    return res.status(400).json({ error: 'A completed weighing needs at least one line item' });
  }

  const itemCount = lines.length;
  const totalWeight = lines.reduce((sum, line) => sum + (parseOptionalWeight(line.requiredWeight) || 0), 0);
  const weighedAt = String(body.weighedAt || localIsoNow()).slice(0, 19);
  const recipeName = String(body.recipeName || '').trim() || null;

  const insertWeighing = db.prepare(
    'INSERT INTO weighings (batch_no, weighed_at, item_count, total_weight, recipe_name) VALUES (?, ?, ?, ?, ?)',
  );
  const insertLine = db.prepare(
    'INSERT INTO weighing_lines (weighing_id, item_id, item_name, required_weight) VALUES (?, ?, ?, ?)',
  );

  db.exec('BEGIN');
  try {
    const info = insertWeighing.run('', weighedAt, itemCount, Math.round(totalWeight * 1000) / 1000, recipeName);
    const id = Number(info.lastInsertRowid);
    const batchNo = `WS-${String(id).padStart(5, '0')}`;
    db.prepare('UPDATE weighings SET batch_no = ? WHERE id = ?').run(batchNo, id);
    for (const line of lines) {
      const itemId = Number.isFinite(Number(line.itemId)) ? Number(line.itemId) : null;
      const name = String(line.itemName || 'Item').trim();
      const weight = parseOptionalWeight(line.requiredWeight) || 0;
      insertLine.run(id, itemId, name, Math.round(weight * 1000) / 1000);
    }
    db.exec('COMMIT');
    const bill = db.prepare('SELECT * FROM weighings WHERE id = ?').get(id);
    res.status(201).json({ ...bill, lines });
  } catch (err) {
    db.exec('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to save weighing' });
  }
});

const toBillJson = (row) => ({
  id: row.id,
  batchNo: row.batch_no,
  weighedAt: row.weighed_at,
  recipeName: row.recipe_name || null,
  itemCount: row.item_count,
  totalWeight: row.total_weight,
});

app.get('/api/weighings', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const rows = db
    .prepare('SELECT * FROM weighings ORDER BY weighed_at DESC, id DESC LIMIT ?')
    .all(limit);
  res.json(rows.map(toBillJson));
});

app.get('/api/weighings/:id', (req, res) => {
  const bill = db.prepare('SELECT * FROM weighings WHERE id = ?').get(Number(req.params.id));
  if (!bill) return res.status(404).json({ error: 'Bill not found' });
  const lines = db
    .prepare(
      'SELECT id, item_id AS itemId, item_name AS itemName, required_weight AS requiredWeight FROM weighing_lines WHERE weighing_id = ? ORDER BY id ASC',
    )
    .all(bill.id);
  res.json({ ...toBillJson(bill), lines });
});

// ---------- Reports ----------

app.get('/api/reports/overview', (req, res) => {
  const totals = db
    .prepare(
      'SELECT COUNT(*) AS bills, COALESCE(SUM(item_count), 0) AS items, ROUND(COALESCE(SUM(total_weight), 0), 3) AS totalKg FROM weighings',
    )
    .get();

  const now = new Date();
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
    months.push(key);
  }

  const grouped = db
    .prepare(
      `SELECT substr(weighed_at, 1, 7) AS month,
              COUNT(*) AS bills,
              COALESCE(SUM(item_count), 0) AS items,
              ROUND(COALESCE(SUM(total_weight), 0), 3) AS totalKg
       FROM weighings
       WHERE substr(weighed_at, 1, 7) >= ?
       GROUP BY month`,
    )
    .all(months[0]);

  const map = new Map(grouped.map((row) => [row.month, row]));
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

  const summary = db
    .prepare(
      `SELECT COUNT(*) AS bills,
              COALESCE(SUM(item_count), 0) AS items,
              ROUND(COALESCE(SUM(total_weight), 0), 3) AS totalKg
       FROM weighings WHERE substr(weighed_at, 1, 7) = ?`,
    )
    .get(key);

  const perItem = db
    .prepare(
      `SELECT item_name AS itemName,
              COUNT(*) AS times,
              ROUND(SUM(required_weight), 3) AS totalKg
       FROM weighing_lines
       WHERE weighing_id IN (SELECT id FROM weighings WHERE substr(weighed_at, 1, 7) = ?)
       GROUP BY item_name
       ORDER BY totalKg DESC, itemName ASC`,
    )
    .all(key);

  const perRecipe = db
    .prepare(
      `SELECT recipe_name AS recipeName,
              COUNT(*) AS bills,
              ROUND(SUM(total_weight), 3) AS totalKg
       FROM weighings
       WHERE substr(weighed_at, 1, 7) = ? AND recipe_name IS NOT NULL
       GROUP BY recipe_name
       ORDER BY totalKg DESC, recipeName ASC`,
    )
    .all(key);

  res.json({ year, month, key, summary, perItem, perRecipe });
});

app.get('/api/reports/yearly', (req, res) => {
  const year = Number(req.query.year);
  if (!Number.isInteger(year)) {
    return res.status(400).json({ error: 'year is required' });
  }

  const rows = db
    .prepare(
      `SELECT substr(weighed_at, 1, 7) AS month,
              COUNT(*) AS bills,
              COALESCE(SUM(item_count), 0) AS items,
              ROUND(COALESCE(SUM(total_weight), 0), 3) AS totalKg
       FROM weighings WHERE substr(weighed_at, 1, 4) = ?
       GROUP BY month`,
    )
    .all(String(year));

  const filled = [];
  for (let m = 1; m <= 12; m++) {
    const key = `${year}-${pad(m)}`;
    const row = rows.find((r) => r.month === key);
    filled.push(row || { month: key, bills: 0, items: 0, totalKg: 0 });
  }

  const totals = filled.reduce(
    (acc, m) => {
      acc.bills += m.bills;
      acc.items += m.items;
      acc.totalKg = Math.round((acc.totalKg + m.totalKg) * 1000) / 1000;
      return acc;
    },
    { bills: 0, items: 0, totalKg: 0 },
  );

  res.json({ year, months: filled, totals });
});

// ---------- Static serving (production) ----------

const dist = path.join(ROOT, 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      return res.sendFile(path.join(dist, 'index.html'));
    }
    next();
  });
}

app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({ error: status === 500 ? 'Server error' : err.message });
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`Weighing server listening on http://localhost:${PORT}`);
    console.log(`DB: ${process.env.DB_PATH || path.join(__dirname, 'data.db')}`);
  });
}