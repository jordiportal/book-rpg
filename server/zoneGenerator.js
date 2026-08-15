// Generador de zonas: el LLM crea el contenido (estancias, NPCs, monstruos, items)
// a partir de la historia (RAG). Devuelve JSON estructurado que el frontend materializa.
import { chatLLM } from './llm.js';
import { buildContext } from './rag.js';

// Prompt de sistema para generar una zona. Le pedimos JSON estricto.
function buildZonePrompt() {
  return `Eres el diseñador de mazmorras y mundo de un RPG basado en la novela japonesa "異世界迷宮でハーレムを" (Harem in the Labyrinth of Another World) de 蘇我捨恥.

Tu trabajo es GENERAR el contenido de una ZONA (estancia, sala o área) del mundo, fiel a la historia del libro.

Debes devolver SOLO un objeto JSON válido, sin texto adicional, con esta estructura EXACTA:

{
  "id": "identificador_unico_sin_espacios",
  "name": "Nombre de la zona",
  "theme": "dungeon | village | forest | town | cave",
  "ambient": "descripción breve de la atmósfera (1 frase)",
  "layout": {
    "width": 40,
    "depth": 40,
    "wallColor": "#4a4a55",
    "floorColor": "#3a3a42",
    "fogColor": "#0a0a12",
    "fogNear": 10,
    "fogFar": 60,
    "ambientLight": "#444466",
    "ambientIntensity": 0.7
  },
  "npcs": [
    {
      "name": "Nombre del NPC",
      "role": "descripción breve del rol",
      "color": "#c8a06a",
      "dialog": "qué dice o hace al hablar (1-2 frases)",
      "x": 0, "z": 0
    }
  ],
  "enemies": [
    {
      "name": "Nombre del monstruo",
      "level": 3,
      "hp": 30,
      "color": "#5a2a6a",
      "count": 4,
      "x": 0, "z": 0
    }
  ],
  "items": [
    {
      "name": "Nombre del objeto",
      "type": "heal | weapon | key | treasure | consumable",
      "value": 10,
      "x": 0, "z": 0
    }
  ],
  "exits": [
    {
      "direction": "north | south | east | west",
      "target": "id_de_la_zona_destino",
      "label": "texto visible del portal"
    }
  ]
}

REGLAS:
1. Responde SIEMPRE en español para nombres y descripciones.
2. Sé fiel al libro: usa el contexto que se te da. No inventes personajes que contradigan la historia.
3. El "theme" determina cómo se ve: dungeon (piedra oscura), village (madera, cielo), forest (verde, niebla), town (calles), cave (roca).
4. Los NPCs deben tener roles coherentes con el mundo (comerciante, herrero, anciano, mercader de esclavos, etc.).
5. Los enemigos deben ser monstruos del mundo (スローラビット, goblins, etc.) con nivel y vida coherentes.
6. "count" es cuántas copias del enemigo se colocan.
7. Las coordenadas x,z son relativas al centro de la zona (rango aprox -15 a 15).
8. El id debe ser único y descriptivo (ej: "laberinto_piso1", "pueblo_mercado").
9. Si es una zona del laberinto, los exits deben conectar con otras zonas coherentes.
10. NO añadas texto fuera del JSON.`;
}

// Parsea el JSON de la respuesta del LLM, tolerante a ruido
function parseZoneJSON(text) {
  if (!text) return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch (e) {
    return null;
  }
}

// Valida y normaliza la zona generada (rellena campos por defecto)
function normalizeZone(raw, fallbackId) {
  // El id SIEMPRE es el de la URL (fallbackId), no el que devuelva el LLM.
  // Así la persistencia en BD es estable: buscar por el id pedido siempre acierta.
  const zone = {
    id: String(fallbackId).replace(/\s+/g, '_'),
    name: raw.name || fallbackId,
    theme: raw.theme || 'dungeon',
    ambient: raw.ambient || '',
    layout: {
      width: raw.layout?.width || 40,
      depth: raw.layout?.depth || 40,
      wallColor: raw.layout?.wallColor || '#4a4a55',
      floorColor: raw.layout?.floorColor || '#3a3a42',
      fogColor: raw.layout?.fogColor || '#0a0a12',
      fogNear: raw.layout?.fogNear ?? 10,
      fogFar: raw.layout?.fogFar ?? 60,
      ambientLight: raw.layout?.ambientLight || '#444466',
      ambientIntensity: raw.layout?.ambientIntensity ?? 0.7
    },
    npcs: Array.isArray(raw.npcs) ? raw.npcs : [],
    enemies: Array.isArray(raw.enemies) ? raw.enemies : [],
    items: Array.isArray(raw.items) ? raw.items : [],
    exits: Array.isArray(raw.exits) ? raw.exits : []
  };
  return zone;
}

// Genera una zona nueva pidiendo al LLM
export async function generateZone(zoneId, locationHint = '') {
  const context = buildContext('迷宮 ダンジョン ' + (locationHint || zoneId));
  const system = buildZonePrompt();
  const userMsg = `Genera el contenido de la zona "${zoneId}"${locationHint ? ` (ubicación: ${locationHint})` : ''} del mundo del libro.

${context}

Devuelve SOLO el JSON de la zona.`;

  const response = await chatLLM({
    system,
    messages: [{ role: 'user', content: userMsg }],
    temperature: 0.9,
    maxTokens: 1200
  });

  const raw = parseZoneJSON(response);
  if (!raw) {
    throw new Error('El LLM no devolvió un JSON de zona válido');
  }
  return normalizeZone(raw, zoneId);
}
