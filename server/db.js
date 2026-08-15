// Base de datos SQLite (sql.js / WASM) para persistir zonas generadas.
// El estado del jugador sigue en savegame.json; aquí solo van las zonas.
import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_FILE = join(__dirname, 'zones.db');

let db = null;
let SQL = null;

// Inicializa la base de datos (asíncrono por sql.js/WASM)
export async function initDb() {
  if (db) return db;
  SQL = await initSqlJs();
  if (existsSync(DB_FILE)) {
    try {
      const filebuffer = readFileSync(DB_FILE);
      db = new SQL.Database(filebuffer);
    } catch (e) {
      console.error('Error cargando BD, creando nueva:', e.message);
      db = new SQL.Database();
    }
  } else {
    db = new SQL.Database();
  }
  db.run(`
    CREATE TABLE IF NOT EXISTS zones (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      theme TEXT NOT NULL,
      seed INTEGER,
      data_json TEXT NOT NULL,
      generated_at TEXT NOT NULL
    );
  `);
  persist();
  return db;
}

// Guarda la BD en disco
export function persist() {
  if (!db) return;
  const data = db.export();
  writeFileSync(DB_FILE, Buffer.from(data));
}

// Guarda (o reemplaza) una zona generada
export function saveZone(zone) {
  if (!db) throw new Error('BD no inicializada');
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO zones (id, name, theme, seed, data_json, generated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run([
    zone.id,
    zone.name || zone.id,
    zone.theme || 'dungeon',
    zone.seed || null,
    JSON.stringify(zone),
    new Date().toISOString()
  ]);
  stmt.free();
  persist();
  return zone;
}

// Recupera una zona por id, o null si no existe
export function getZone(id) {
  if (!db) throw new Error('BD no inicializada');
  const stmt = db.prepare('SELECT data_json FROM zones WHERE id = ?');
  stmt.bind([id]);
  let zone = null;
  if (stmt.step()) {
    const row = stmt.getAsObject();
    try { zone = JSON.parse(row.data_json); } catch (e) { zone = null; }
  }
  stmt.free();
  return zone;
}

// Lista los ids de todas las zonas guardadas
export function listZones() {
  if (!db) throw new Error('BD no inicializada');
  const stmt = db.prepare('SELECT id, name, theme, generated_at FROM zones ORDER BY generated_at');
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}
