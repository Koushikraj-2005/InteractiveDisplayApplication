import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SEED_ITEMS } from './seedData.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.db');

export const db = new DatabaseSync(DB_PATH);

const hasTable = (name) =>
  !!db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);

const hasCol = (table, column) =>
  db.prepare(`PRAGMA table_info(${table})`).all().some((col) => col.name === column);

function migrateLegacyRecipeTables() {
  if (hasTable('recipes') && !hasTable('formulas')) {
    db.exec('ALTER TABLE recipes RENAME TO formulas');
    console.log('Migrated table recipes -> formulas');
  }
  if (hasTable('recipe_lines') && !hasTable('formula_lines')) {
    db.exec('ALTER TABLE recipe_lines RENAME TO formula_lines');
    console.log('Migrated table recipe_lines -> formula_lines');
  }
  if (hasTable('formula_lines') && hasCol('formula_lines', 'recipe_id') && !hasCol('formula_lines', 'formula_id')) {
    db.exec('ALTER TABLE formula_lines RENAME COLUMN recipe_id TO formula_id');
    console.log('Migrated column formula_lines.recipe_id -> formula_id');
  }
  db.exec('DROP INDEX IF EXISTS idx_recipe_lines_recipe');
}

export function initDb() {
  db.exec('PRAGMA journal_mode = WAL;');

  migrateLegacyRecipeTables();

  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      name_hi TEXT NOT NULL DEFAULT '',
      name_bn TEXT NOT NULL DEFAULT '',
      name_ta TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS weighings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_no TEXT NOT NULL,
      weighed_at TEXT NOT NULL,
      item_count INTEGER NOT NULL,
      total_weight REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS weighing_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      weighing_id INTEGER NOT NULL REFERENCES weighings(id) ON DELETE CASCADE,
      item_id INTEGER,
      item_name TEXT NOT NULL,
      required_weight REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS formulas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      item_count INTEGER NOT NULL DEFAULT 0,
      total_weight REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS formula_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      formula_id INTEGER NOT NULL REFERENCES formulas(id) ON DELETE CASCADE,
      item_id INTEGER,
      item_name TEXT NOT NULL,
      required_weight REAL NOT NULL,
      position INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_weighings_weighed_at ON weighings(weighed_at);
    CREATE INDEX IF NOT EXISTS idx_lines_weighing ON weighing_lines(weighing_id);
    CREATE INDEX IF NOT EXISTS idx_formula_lines_formula ON formula_lines(formula_id);
  `);

  const weighingCols = db.prepare('PRAGMA table_info(weighings)').all().map((col) => col.name);
  if (!weighingCols.includes('formula_name')) {
    if (weighingCols.includes('recipe_name')) {
      db.exec('ALTER TABLE weighings RENAME COLUMN recipe_name TO formula_name');
      console.log('Migrated weighings: recipe_name -> formula_name');
    } else {
      db.exec('ALTER TABLE weighings ADD COLUMN formula_name TEXT');
      console.log('Migrated weighings: added formula_name column');
    }
  }

  const count = db.prepare('SELECT COUNT(*) AS n FROM items').get().n;
  if (count === 0) {
    const insert = db.prepare(
      'INSERT INTO items (slug, code, name, name_hi, name_bn, name_ta) VALUES (?, ?, ?, ?, ?, ?)',
    );
    SEED_ITEMS.forEach((item, index) => {
      const code = `RM-${String(index + 1).padStart(2, '0')}`;
      insert.run(item.slug, code, item.name, item.hi, item.bn, item.ta);
    });
    console.log('Seeded item master with', SEED_ITEMS.length, 'items');
  } else {
    console.log('Item master already seeded:', count, 'items');
  }
}