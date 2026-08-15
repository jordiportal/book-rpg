// Servidor del juego: sirve el frontend y expone la API del game master
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createInitialState } from './gameState.js';
import { processAction, identifyTarget } from './gameMaster.js';
import { initDb, getZone, saveZone, listZones } from './db.js';
import { generateZone } from './zoneGenerator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 4200;
const SAVE_FILE = join(__dirname, 'savegame.json');

app.use(express.json());
app.use(express.static(join(__dirname, '..', 'public')));

// --- Persistencia: cargar partida guardada o crear una nueva ---
function loadState() {
  try {
    if (existsSync(SAVE_FILE)) {
      const raw = readFileSync(SAVE_FILE, 'utf-8');
      const saved = JSON.parse(raw);
      // Merge con el estado inicial para no perder campos nuevos
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
    writeFileSync(SAVE_FILE, JSON.stringify(gameState, null, 2));
  } catch (err) {
    console.error('Error guardando partida:', err.message);
  }
}

let gameState = loadState();

// Inicializar la base de datos de zonas al arrancar
initDb().then(() => {
  console.log('🗄️  Base de datos de zonas lista');
}).catch((err) => {
  console.error('Error inicializando BD:', err.message);
});

// GET /api/state -> estado actual
app.get('/api/state', (req, res) => {
  res.json(gameState);
});

// POST /api/action -> el jugador realiza una acción
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

// POST /api/identify -> usar 鑑定
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

// POST /api/reset -> reiniciar partida
app.post('/api/reset', (req, res) => {
  gameState = createInitialState();
  saveState();
  res.json(gameState);
});

// POST /api/save -> guardar partida manualmente
app.post('/api/save', (req, res) => {
  saveState();
  res.json({ ok: true, savedAt: new Date().toISOString() });
});

// GET /api/zones -> lista las zonas generadas guardadas
app.get('/api/zones', (req, res) => {
  res.json({ zones: listZones() });
});

// GET /api/zone/:id -> devuelve una zona (de BD si existe, si no la genera y guarda)
app.get('/api/zone/:id', async (req, res) => {
  const id = req.params.id;
  try {
    // 1. Buscar en BD
    let zone = getZone(id);
    let generated = false;
    // 2. Si no existe, generarla con el LLM y guardarla
    if (!zone) {
      zone = await generateZone(id, gameState.location);
      saveZone(zone);
      generated = true;
    }
    res.json({ zone, generated });
  } catch (err) {
    console.error('Error en /api/zone:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/zone/:id/stream -> genera una zona con progreso en tiempo real (SSE)
// Emite eventos con los pasos reales: buscar BD, generar LLM, guardar, listo.
app.get('/api/zone/:id/stream', async (req, res) => {
  const id = req.params.id;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Helper para enviar un evento SSE
  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // Paso 1: buscar en BD
    send('step', { key: 'db', label: 'Consultando la base de datos...' });
    let zone = getZone(id);
    let generated = false;

    if (zone) {
      // Zona ya guardada: no hace falta generar
      send('step', { key: 'db', label: 'Zona encontrada en la base de datos ✔' });
      send('step', { key: 'done', label: 'Cargando zona guardada...' });
      send('zone', { zone, generated: false });
      return res.end();
    }

    // Paso 2: generar con el LLM
    send('step', { key: 'llm', label: 'Consultando la historia del libro (RAG)...' });
    send('step', { key: 'llm', label: 'El Game Master está generando la zona...' });
    zone = await generateZone(id, gameState.location);
    send('step', { key: 'llm', label: 'Zona generada por el LLM ✔' });

    // Paso 3: guardar en BD
    send('step', { key: 'save', label: 'Guardando la zona en la base de datos...' });
    saveZone(zone);
    send('step', { key: 'save', label: 'Zona persistida ✔' });

    // Paso 4: listo
    send('step', { key: 'done', label: 'Materializando el mundo...' });
    send('zone', { zone, generated: true });
    res.end();
  } catch (err) {
    console.error('Error en /api/zone/stream:', err.message);
    send('error', { message: err.message });
    res.end();
  }
});

// POST /api/zone/generate -> fuerza la regeneración de una zona (borra la guardada)
app.post('/api/zone/generate', async (req, res) => {
  const { id, location } = req.body;
  if (!id) return res.status(400).json({ error: 'Falta id' });
  try {
    const zone = await generateZone(id, location || gameState.location);
    saveZone(zone);
    res.json({ zone, generated: true });
  } catch (err) {
    console.error('Error regenerando zona:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎮 Book-RPG servidor escuchando en http://0.0.0.0:${PORT}`);
});
