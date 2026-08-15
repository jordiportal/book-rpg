// Base de datos SQLite (sql.js / WASM) para persistir zonas, personajes,
// equipamiento e historia. El estado del jugador sigue en savegame.json.
// Cada entidad se guarda como JSON en su columna data_json (patrón de zones),
// así el esquema evoluciona sin migraciones.
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
    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS equipment (
      id TEXT PRIMARY KEY,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS story (
      id TEXT PRIMARY KEY,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
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

// ---- Zonas (existente) ----

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

// ---- CRUD genérico para entidades JSON (characters, equipment, story) ----

// Guarda (inserta o reemplaza) una entidad en la tabla dada
function saveEntity(table, entity) {
  if (!db) throw new Error('BD no inicializada');
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO ${table} (id, data_json, created_at, updated_at)
    VALUES (?, ?, COALESCE((SELECT created_at FROM ${table} WHERE id = ?), ?), ?)
  `);
  stmt.run([entity.id, JSON.stringify(entity), entity.id, now, now]);
  stmt.free();
  persist();
  return entity;
}

// Recupera una entidad por id, o null
function getEntity(table, id) {
  if (!db) throw new Error('BD no inicializada');
  const stmt = db.prepare(`SELECT data_json FROM ${table} WHERE id = ?`);
  stmt.bind([id]);
  let entity = null;
  if (stmt.step()) {
    const row = stmt.getAsObject();
    try { entity = JSON.parse(row.data_json); } catch (e) { entity = null; }
  }
  stmt.free();
  return entity;
}

// Lista todas las entidades de una tabla (opcionalmente filtradas por una fn)
function listEntities(table, filterFn) {
  if (!db) throw new Error('BD no inicializada');
  const stmt = db.prepare(`SELECT data_json FROM ${table} ORDER BY created_at`);
  const rows = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    try {
      const e = JSON.parse(row.data_json);
      if (!filterFn || filterFn(e)) rows.push(e);
    } catch (e) { /* ignorar fila corrupta */ }
  }
  stmt.free();
  return rows;
}

// Borra una entidad por id. Devuelve true si existía.
function deleteEntity(table, id) {
  if (!db) throw new Error('BD no inicializada');
  const stmt = db.prepare(`DELETE FROM ${table} WHERE id = ?`);
  stmt.bind([id]);
  stmt.step();
  const changes = db.getRowsModified();
  stmt.free();
  if (changes > 0) persist();
  return changes > 0;
}

// ---- Personajes ----
export function saveCharacter(c) { return saveEntity('characters', c); }
export function getCharacter(id) { return getEntity('characters', id); }
export function listCharacters(tag) {
  return listEntities('characters', (c) => !tag || (c.tags || []).includes(tag));
}
export function deleteCharacter(id) { return deleteEntity('characters', id); }

// ---- Equipamiento ----
export function saveEquipment(e) { return saveEntity('equipment', e); }
export function getEquipment(id) { return getEntity('equipment', id); }
export function listEquipment(slot) {
  return listEntities('equipment', (e) => !slot || e.slot === slot);
}
export function deleteEquipment(id) { return deleteEntity('equipment', id); }

// ---- Historia ----
export function saveStory(s) { return saveEntity('story', s); }
export function getStory(id) { return getEntity('story', id); }
export function listStories() { return listEntities('story'); }
export function deleteStory(id) { return deleteEntity('story', id); }
