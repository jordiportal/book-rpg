// Servidor del juego: sirve el frontend y expone la API del game master
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { createInitialState } from './gameState.js';
import { processAction, identifyTarget } from './gameMaster.js';
import { initDb, getZone, saveZone, listZones } from './db.js';
import { generateZone } from './zoneGenerator.js';
import { initSession, getActiveStoryId, setActiveStoryId } from './session.js';
import charactersRouter from './routes/characters.js';
import equipmentRouter from './routes/equipment.js';
import storyRouter from './routes/story.js';
import gmRouter from './routes/gm.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 4200;
const SAVE_DIR = join(__dirname, 'saves');
const SAVE_FILE = join(__dirname, 'savegame.json');

app.use(express.json());

// GUI del Game Master (panel de administración) — ANTES de static para evitar el 301 del directorio
app.get('/gm', (req, res) => {
  res.sendFile(join(__dirname, '..', 'public', 'gm', 'index.html'));
});

app.use(express.static(join(__dirname, '..', 'public')));

// GUI del Game Master — panel de administración
app.get('/gm', (req, res) => {
  res.sendFile(join(__dirname, '..', 'public', 'gm', 'index.html'));
});

// --- Persistencia: cargar partida guardada o crear una nueva ---
// El estado del jugador se guarda POR HISTORIA (cada historia es un juego independiente).
function saveFileForStory() {
  const storyId = getActiveStoryId();
  if (storyId) return join(SAVE_DIR, `${storyId}.json`);
  return SAVE_FILE;
}

function loadState() {
  try {
    const file = saveFileForStory();
    if (existsSync(file)) {
      const raw = readFileSync(file, 'utf-8');
      const saved = JSON.parse(raw);
      const base = createInitialState();
      return { ...base, ...saved, player: { ...base.player, ...saved.player } };
    }
  } catch (err) {
    console.error('Error cargando partida:', err.message);
  }
  return createInitialState();
}

function saveState() {
  try {
    const file = saveFileForStory();
    if (!existsSync(SAVE_DIR)) {
      mkdirSync(SAVE_DIR, { recursive: true });
    }
    writeFileSync(file, JSON.stringify(gameState, null, 2));
  } catch (err) {
    console.error('Error guardando partida:', err.message);
  }
}

let gameState = loadState();

// Inicializar sesión (historia activa) y BD, y sembrar datos de ejemplo
initSession();
initDb().then(async () => {
  console.log('🗄️  Base de datos lista');
  await migrateLegacyData();
  await seedMockData();
}).catch((err) => {
  console.error('Error inicializando BD:', err.message);
});

// Migra los datos existentes sin storyId (creados antes del aislamiento por historia)
// asignándolos a la historia 'main' (la historia por defecto sembrada).
async function migrateLegacyData() {
  const { listCharacters, saveCharacter, listEquipment, saveEquipment, listZones, saveZone } = await import('./db.js');
  let migrated = 0;

  const chars = listCharacters();
  for (const c of chars) {
    if (!c.storyId) {
      c.storyId = 'main';
      saveCharacter(c);
      migrated++;
    }
  }

  const items = listEquipment();
  for (const e of items) {
    if (!e.storyId) {
      e.storyId = 'main';
      saveEquipment(e);
      migrated++;
    }
  }

  const zones = listZones();
  for (const z of zones) {
    if (!z.storyId) {
      z.storyId = 'main';
      saveZone(z);
      migrated++;
    }
  }

  if (migrated > 0) console.log(`🔄 Migrados ${migrated} datos legacy a la historia 'main'`);
}

// ── Datos mock de ejemplo ─────────────────────────────────────────────────
async function seedMockData() {
  const { saveCharacter, listCharacters, saveEquipment, listEquipment, saveStory, listStories } = await import('./db.js');

  if (listCharacters().length === 0) {
    await saveCharacter({
      id: 'roxanne',
      name: 'ロクサーヌ',
      race: 'inu-mimi (perro)',
      class: 'esclava',
      description: 'Chica perro de 16 años, esclava en el mercado de esclavos de la ciudad de Beil.',
      stats: { level: 1, hp: 100, maxHp: 100, mp: 50, maxMp: 50, str: 8, vit: 9, agi: 12, dex: 10, int: 6, luck: 10 },
      equipment: { weapon: null, armor: null, accessory: null },
      model3d: { status: 'none', url: null, imageUrl: null, generatedAt: null },
      tags: ['companion', 'main'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    await saveCharacter({
      id: 'michio',
      name: '加賀道夫',
      race: 'humano',
      class: '無職',
      description: 'El protagonista. Estudiante japonés de 17 años transportado a otro mundo.',
      stats: { level: 1, hp: 100, maxHp: 100, mp: 50, maxMp: 50, str: 10, vit: 10, agi: 10, dex: 10, int: 10, luck: 10 },
      equipment: { weapon: null, armor: null, accessory: null },
      model3d: { status: 'none', url: null, imageUrl: null, generatedAt: null },
      tags: ['main', 'protagonist'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    console.log('🌱 Sembrados 2 personajes de ejemplo');
  }

  if (listEquipment().length === 0) {
    await saveEquipment({
      id: 'durandal',
      name: 'デュランダル',
      slot: 'weapon',
      type: 'espada',
      rarity: 'legendary',
      stats: { str: 15, vit: 0, agi: 5, dex: 0, int: 0, luck: 0, hp: 0, mp: 0 },
      value: 50000,
      description: 'Espada legendaria forjada con metal del laberinto.',
      model3d: { status: 'none', url: null, imageUrl: null, generatedAt: null },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    console.log('🌱 Sembrado 1 item de equipamiento');
  }

  if (listStories().length === 0) {
    await saveStory({
      id: 'main',
      title: '異世界迷宮でハーレムを',
      source: 'manual',
      originalFile: null,
      language: 'ja',
      chapters: [
        {
          id: 'cap-1',
          index: 1,
          title: 'El despertar en otro mundo',
          summary: 'Michio despierta en un mundo de fantasía con habilidades de identificación.',
          content: 'Michio se despierta en un prado desconocido. Descubre que tiene la habilidad de 鑑定...',
          scenes: [
            { id: 'esc-1-1', index: 1, title: 'Despertar', summary: 'Michio abre los ojos en otro mundo.', content: 'Michio se despierta en un prado.' },
            { id: 'esc-1-2', index: 2, title: 'Descubrimiento', summary: 'Descubre su habilidad de identificación.', content: 'Michio descubre que puede ver el nivel de cualquier persona.' }
          ]
        },
        {
          id: 'cap-2',
          index: 2,
          title: 'La primera aldea',
          summary: 'Michio llega al primer pueblo y conoce el sistema de este mundo.',
          content: 'Michio camina hasta llegar a un pequeño pueblo.',
          scenes: [
            { id: 'esc-2-1', index: 1, title: 'Llegada al pueblo', summary: 'Michio entra en el pueblo.', content: 'El pueblo es pequeño pero acogedor.' },
            { id: 'esc-2-2', index: 2, title: 'El gremio', summary: 'Michio se registra en el gremio.', content: 'En el gremio, Michio aprende sobre los trabajos.' }
          ]
        }
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    console.log('🌱 Sembrada la historia inicial');
  }
}

// ── Estado del jugador (existente) ───────────────────────────────────────
app.get('/api/state', (req, res) => {
  // Recargar el estado de la historia activa (por si cambió)
  gameState = loadState();
  res.json(gameState);
});

// Recargar el estado del jugador desde el archivo de la historia activa
// (se llama al cambiar de historia activa)
app.post('/api/state/reload', (req, res) => {
  gameState = loadState();
  res.json(gameState);
});

app.post('/api/action', async (req, res) => {
  const { action } = req.body;
  if (!action || typeof action !== 'string' || action.trim() === '') {
    return res.status(400).json({ error: 'Acción vacía' });
  }
  try {
    const result = await processAction(gameState, action);
    saveState();
    res.json(result);
  } catch (err) {
    console.error('Error en action:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/identify', async (req, res) => {
  const { target } = req.body;
  if (!target || typeof target !== 'string' || target.trim() === '') {
    return res.status(400).json({ error: 'Objetivo vacío' });
  }
  try {
    const result = await identifyTarget(gameState, target);
    res.json(result);
  } catch (err) {
    console.error('Error en identify:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/reset', (req, res) => {
  gameState = createInitialState();
  saveState();
  res.json(gameState);
});

app.post('/api/save', (req, res) => {
  saveState();
  res.json({ ok: true, savedAt: new Date().toISOString() });
});

// ── Zonas (existente) ────────────────────────────────────────────────────
app.get('/api/zones', (req, res) => {
  const storyId = getActiveStoryId();
  res.json({ zones: listZones(storyId) });
});

app.get('/api/zone/:id', async (req, res) => {
  const id = req.params.id;
  const storyId = getActiveStoryId();
  try {
    let zone = getZone(id);
    let generated = false;
    // Solo usar la zona si pertenece a la historia activa
    if (zone && zone.storyId && zone.storyId !== storyId) zone = null;
    if (!zone) {
      zone = await generateZone(id, gameState.location);
      zone.storyId = storyId;
      saveZone(zone);
      generated = true;
    }
    res.json({ zone, generated });
  } catch (err) {
    console.error('Error en /api/zone:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/zone/:id/stream', async (req, res) => {
  const id = req.params.id;
  const storyId = getActiveStoryId();
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    send('step', { key: 'db', label: 'Consultando la base de datos...' });
    let zone = getZone(id);
    let generated = false;

    if (zone && (!zone.storyId || zone.storyId === storyId)) {
      send('step', { key: 'db', label: 'Zona encontrada en la base de datos ✔' });
      send('step', { key: 'done', label: 'Cargando zona guardada...' });
      send('zone', { zone, generated: false });
      return res.end();
    }

    send('step', { key: 'llm', label: 'Consultando la historia del libro (RAG)...' });
    send('step', { key: 'llm', label: 'El Game Master está generando la zona...' });
    zone = await generateZone(id, gameState.location);
    zone.storyId = storyId;
    send('step', { key: 'llm', label: 'Zona generada por el LLM ✔' });

    send('step', { key: 'save', label: 'Guardando la zona en la base de datos...' });
    saveZone(zone);
    send('step', { key: 'save', label: 'Zona persistida ✔' });

    send('step', { key: 'done', label: 'Materializando el mundo...' });
    send('zone', { zone, generated: true });
    res.end();
  } catch (err) {
    console.error('Error en /api/zone/stream:', err.message);
    send('error', { message: err.message });
    res.end();
  }
});

app.post('/api/zone/generate', async (req, res) => {
  const { id, location } = req.body;
  if (!id) return res.status(400).json({ error: 'Falta id' });
  const storyId = getActiveStoryId();
  try {
    const zone = await generateZone(id, location || gameState.location);
    zone.storyId = storyId;
    saveZone(zone);
    res.json({ zone, generated: true });
  } catch (err) {
    console.error('Error regenerando zona:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Nuevas rutas del contrato ────────────────────────────────────────────
app.use('/api/characters', charactersRouter);
app.use('/api/equipment', equipmentRouter);
app.use('/api/story', storyRouter);
app.use('/api/gm', gmRouter);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎮 Book-RPG servidor escuchando en http://0.0.0.0:${PORT}`);
});
