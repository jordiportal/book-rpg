// Pruebas e2e del Book-RPG: validan los flujos del backend sin necesidad de WebGL.
// Cubre: estado, acción, identificación, generación de zonas, persistencia, SSE,
// personajes, equipamiento e historia.
//
// Uso:
//   node test/e2e.js            # asume servidor en http://127.0.0.1:4200
//   PORT=4300 node test/e2e.js  # servidor en otro puerto
//   node test/e2e.js --spawn    # arranca el servidor él mismo y lo cierra al final
//
// Salida: 0 si todo pasa, 1 si algo falla.

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4200;
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, cond, extra = '') {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  ❌ ${name} ${extra}`);
  }
}

async function get(path) {
  const res = await fetch(BASE + path);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* no JSON */ }
  return { status: res.status, json, text };
}

async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* no JSON */ }
  return { status: res.status, json, text };
}

async function put(path, body) {
  const res = await fetch(BASE + path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* no JSON */ }
  return { status: res.status, json, text };
}

// Lee un stream SSE y devuelve los eventos {event, data} recibidos.
async function readSSE(path, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    fetch(BASE + path, { signal: controller.signal })
      .then(async (res) => {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const events = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            let event = 'message';
            let data = '';
            block.split('\n').forEach(line => {
              if (line.startsWith('event:')) event = line.slice(6).trim();
              else if (line.startsWith('data:')) data += line.slice(5).trim();
            });
            let parsed = null;
            try { parsed = JSON.parse(data); } catch { parsed = data; }
            events.push({ event, data: parsed });
          }
        }
        clearTimeout(timer);
        resolve(events);
      })
      .catch(err => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

async function main() {
  console.log(`\n🧪 Book-RPG e2e — servidor en ${BASE}\n`);

  // ---- 1. Estado ----
  console.log('1) Estado del juego');
  const state = await get('/api/state');
  ok('GET /api/state responde 200', state.status === 200);
  ok('El estado tiene jugador', !!(state.json && state.json.player));
  ok('El jugador tiene nombre', !!(state.json && state.json.player.name));
  ok('El estado tiene dinero', typeof (state.json && state.json.money) === 'number');
  ok('El estado tiene días restantes', typeof (state.json && state.json.daysRemaining) === 'number');

  // ---- 2. Acción ----
  console.log('2) Acción del jugador');
  const action = await post('/api/action', { action: 'Miro a mi alrededor en el pueblo' });
  ok('POST /api/action responde 200', action.status === 200);
  ok('La acción devuelve narrativa', !!(action.json && action.json.narrative));
  ok('La acción devuelve estado', !!(action.json && action.json.state));

  // ---- 3. Identificación ----
  console.log('3) Identificación (鑑定)');
  const ident = await post('/api/identify', { target: 'un monstruo' });
  ok('POST /api/identify responde 200', ident.status === 200);
  ok('La identificación devuelve narrativa', !!(ident.json && ident.json.narrative));

  // ---- 4. Generación de zona ----
  console.log('4) Generación de zona (LLM)');
  const zoneId = 'e2e_zona_prueba_' + Date.now();
  const zone = await get(`/api/zone/${zoneId}`);
  ok('GET /api/zone/:id responde 200', zone.status === 200);
  ok('La zona se generó (generated=true)', zone.json && zone.json.generated === true);
  ok('La zona tiene id', !!(zone.json && zone.json.zone && zone.json.zone.id));
  ok('La zona tiene nombre', !!(zone.json && zone.json.zone && zone.json.zone.name));
  ok('La zona tiene theme', !!(zone.json && zone.json.zone && zone.json.zone.theme));
  ok('La zona tiene layout', !!(zone.json && zone.json.zone && zone.json.zone.layout));
  ok('La zona tiene arrays npcs/enemies/items/exits',
    zone.json && zone.json.zone &&
    Array.isArray(zone.json.zone.npcs) &&
    Array.isArray(zone.json.zone.enemies) &&
    Array.isArray(zone.json.zone.items) &&
    Array.isArray(zone.json.zone.exits));

  // ---- 5. Persistencia (no regenera) ----
  console.log('5) Persistencia en BD');
  const zone2 = await get(`/api/zone/${zoneId}`);
  ok('Segunda llamada NO regenera (generated=false)', zone2.json && zone2.json.generated === false);
  ok('La zona persistida es la misma', zone2.json && zone2.json.zone && zone2.json.zone.id === zone.json.zone.id);

  // ---- 6. Listar zonas ----
  console.log('6) Listar zonas');
  const zones = await get('/api/zones');
  ok('GET /api/zones responde 200', zones.status === 200);
  ok('La zona aparece en la lista', zones.json && Array.isArray(zones.json.zones) &&
    zones.json.zones.some(z => z.id === zoneId));

  // ---- 7. SSE con progreso (zona nueva) ----
  console.log('7) SSE progreso (zona nueva)');
  const newId = 'e2e_sse_' + Date.now();
  const sseNew = await readSSE(`/api/zone/${newId}/stream`);
  const stepEvents = sseNew.filter(e => e.event === 'step');
  const zoneEvents = sseNew.filter(e => e.event === 'zone');
  ok('SSE emite pasos de progreso', stepEvents.length > 0);
  ok('SSE emite el evento zone', zoneEvents.length === 1);
  ok('La zona del SSE se generó', zoneEvents[0] && zoneEvents[0].data && zoneEvents[0].data.generated === true);
  ok('SSE tiene paso de BD', stepEvents.some(e => e.data && e.data.key === 'db'));
  ok('SSE tiene paso de LLM', stepEvents.some(e => e.data && e.data.key === 'llm'));
  ok('SSE tiene paso de guardado', stepEvents.some(e => e.data && e.data.key === 'save'));

  // ---- 8. SSE con progreso (zona ya guardada) ----
  console.log('8) SSE progreso (zona guardada)');
  const sseSaved = await readSSE(`/api/zone/${newId}/stream`);
  const zoneSaved = sseSaved.filter(e => e.event === 'zone');
  ok('Zona guardada NO regenera en SSE', zoneSaved[0] && zoneSaved[0].data && zoneSaved[0].data.generated === false);

  // ---- 9. PERSONAJES ----
  console.log('9) Personajes (API nueva)');
  const chars = await get('/api/characters');
  ok('GET /api/characters responde 200', chars.status === 200);
  ok('Hay personajes mock', chars.json && Array.isArray(chars.json.characters) && chars.json.characters.length > 0);
  ok('Personaje Roxanne existe', chars.json && chars.json.characters.some(c => c.id === 'roxanne'));
  ok('Personaje Michio existe', chars.json && chars.json.characters.some(c => c.id === 'michio'));

  // Personaje individual
  const roxanne = await get('/api/characters/roxanne');
  ok('GET /api/characters/:id responde 200', roxanne.status === 200);
  ok('Roxanne tiene stats', roxanne.json && roxanne.json.character && roxanne.json.character.stats);
  ok('Roxanne tiene tags', roxanne.json && roxanne.json.character && roxanne.json.character.tags);

  // Crear personaje
  const newChar = await post('/api/characters', {
    name: 'Test Character',
    race: 'elfo',
    class: 'mago',
    stats: { level: 1, hp: 80, maxHp: 80, mp: 60, maxMp: 60, str: 6, vit: 7, agi: 9, dex: 10, int: 14, luck: 8 }
  });
  ok('POST /api/characters crea personaje (201)', newChar.status === 201);
  ok('Personaje creado tiene id', newChar.json && newChar.json.character && newChar.json.character.id);

  // Actualizar personaje
  const charId = newChar.json.character.id;
  const updated = await put(`/api/characters/${charId}`, { class: 'mago de hielo' });
  ok('PUT /api/characters/:id actualiza', updated.status === 200);
  ok('Clase actualizada', updated.json && updated.json.character && updated.json.character.class === 'mago de hielo');

  // Borrar personaje
  const deleted = await fetch(BASE + `/api/characters/${charId}`, { method: 'DELETE' });
  ok('DELETE /api/characters/:id borra', deleted.status === 200);

  // ---- 10. EQUIPAMIENTO ----
  console.log('10) Equipamiento (API nueva)');
  const eq = await get('/api/equipment');
  ok('GET /api/equipment responde 200', eq.status === 200);
  ok('Hay equipamiento mock', eq.json && Array.isArray(eq.json.equipment) && eq.json.equipment.length > 0);
  ok('Durandal existe', eq.json && eq.json.equipment.some(e => e.id === 'durandal'));

  // Equipar personaje
  const equipRoxanne = await post('/api/characters/roxanne/equip', { slot: 'weapon', equipmentId: 'durandal' });
  ok('POST /api/characters/:id/equip funciona', equipRoxanne.status === 200);
  ok('Roxanne tiene Durandal equipada', equipRoxanne.json && equipRoxanne.json.character && equipRoxanne.json.character.equipment && equipRoxanne.json.character.equipment.weapon === 'durandal');

  // Desequipar
  const unequipRoxanne = await post('/api/characters/roxanne/unequip', { slot: 'weapon' });
  ok('POST /api/characters/:id/unequip funciona', unequipRoxanne.status === 200);
  ok('Roxanne ya no tiene arma', unequipRoxanne.json && unequipRoxanne.json.character && unequipRoxanne.json.character.equipment && unequipRoxanne.json.character.equipment.weapon === null);

  // ---- 11. HISTORIA ----
  console.log('11) Historia (API nueva)');
  const story = await get('/api/story');
  ok('GET /api/story responde 200', story.status === 200);
  ok('Hay historia mock', story.json && story.json.story && story.json.story.chapters);
  ok('Historia tiene capítulos', story.json && story.json.story && Array.isArray(story.json.story.chapters) && story.json.story.chapters.length > 0);

  // Capítulos
  const chapters = await get('/api/story/chapters');
  ok('GET /api/story/chapters responde 200', chapters.status === 200);
  ok('Lista de capítulos', chapters.json && Array.isArray(chapters.json.chapters));

  // Capítulo individual
  const ch1 = await get('/api/story/chapters/cap-1');
  ok('GET /api/story/chapters/:id responde 200', ch1.status === 200);
  ok('Capítulo tiene escenas', ch1.json && ch1.json.chapter && Array.isArray(ch1.json.chapter.scenes));

  // ---- 12. GM Suggest ----
  console.log('12) Asistencia IA GM');
  const suggest = await post('/api/gm/suggest', { kind: 'name', context: 'personaje femenino' });
  ok('POST /api/gm/suggest responde 200', suggest.status === 200);
  ok('Sugerencia devuelve algo', suggest.json && suggest.json.suggestion);

  // ---- Resumen ----
  console.log(`\n📊 Resultado: ${passed} pasaron, ${failed} fallaron`);
  if (failed > 0) {
    console.log('Fallos:');
    failures.forEach(f => console.log(`  - ${f}`));
    process.exit(1);
  }
  console.log('🎉 Todas las pruebas e2e pasaron.');
  process.exit(0);
}

// Si --spawn, arranca el servidor y lo cierra al final
if (process.argv.includes('--spawn')) {
  const server = spawn('node', ['server/index.js'], {
    cwd: join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore'
  });
  const wait = async () => {
    for (let i = 0; i < 50; i++) {
      try {
        const res = await fetch(BASE + '/api/state');
        if (res.ok) return;
      } catch { /* aún no */ }
      await new Promise(r => setTimeout(r, 200));
    }
    throw new Error('El servidor no arrancó a tiempo');
  };
  wait()
    .then(main)
    .catch(err => { console.error('❌', err.message); process.exit(1); })
    .finally(() => server.kill());
} else {
  main().catch(err => {
    console.error('❌ Error en e2e:', err.message);
    process.exit(1);
  });
}
