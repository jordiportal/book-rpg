// Generador de entidades (personajes y equipamiento) a partir del texto del libro.
// Usa el LLM para extraer y estructurar personajes y objetos del contenido narrativo.
import { chatLLM } from './llm.js';

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function now() { return new Date().toISOString(); }

// Extrae el JSON de una respuesta del LLM (tolera markdown y texto alrededor)
function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No se encontró JSON en la respuesta');
  return JSON.parse(text.slice(start, end + 1));
}

// Reconstruye el texto completo del libro a partir de la historia estructurada
export function storyToText(story) {
  if (!story) return '';
  return (story.chapters || [])
    .map(ch => {
      const scenesText = (ch.scenes || [])
        .map(sc => sc.content || '')
        .join('\n\n');
      return scenesText || ch.content || '';
    })
    .join('\n\n');
}

// Normaliza un personaje extraído por el LLM al formato del contrato
function normalizeCharacter(raw, index) {
  const stats = raw.stats || {};
  return {
    id: makeId('char'),
    name: raw.name || `Personaje ${index + 1}`,
    race: raw.race || 'humano',
    class: raw.class || raw.className || 'aventurero',
    description: raw.description || '',
    stats: {
      level: stats.level || 1,
      hp: stats.hp || 100,
      maxHp: stats.maxHp || stats.hp || 100,
      mp: stats.mp || 50,
      maxMp: stats.maxMp || stats.mp || 50,
      str: stats.str || 10,
      vit: stats.vit || 10,
      agi: stats.agi || 10,
      dex: stats.dex || 10,
      int: stats.int || 10,
      luck: stats.luck || 10
    },
    equipment: { weapon: null, armor: null, accessory: null },
    model3d: { status: 'none', url: null, imageUrl: null, generatedAt: null },
    tags: Array.isArray(raw.tags) ? raw.tags : (raw.role ? [raw.role] : []),
    createdAt: now(),
    updatedAt: now()
  };
}

// Normaliza un item de equipamiento extraído por el LLM al formato del contrato
function normalizeEquipment(raw, index) {
  const stats = raw.stats || {};
  return {
    id: makeId('eq'),
    name: raw.name || `Item ${index + 1}`,
    slot: raw.slot || 'weapon',
    type: raw.type || 'objeto',
    rarity: raw.rarity || 'common',
    stats: {
      str: stats.str || 0,
      vit: stats.vit || 0,
      agi: stats.agi || 0,
      dex: stats.dex || 0,
      int: stats.int || 0,
      luck: stats.luck || 0,
      hp: stats.hp || 0,
      mp: stats.mp || 0
    },
    value: raw.value || 0,
    description: raw.description || '',
    model3d: { status: 'none', url: null, imageUrl: null, generatedAt: null },
    createdAt: now(),
    updatedAt: now()
  };
}

// Extrae personajes del texto con el LLM
export async function generateCharacters(text, existingNames = []) {
  const system = `Eres un analizador literario experto. Extraes los personajes de una novela y los conviertes en fichas de RPG. Responde ÚNICAMENTE con un JSON válido, sin markdown, sin comentarios.`;

  const prompt = `Analiza el siguiente fragmento de novela y extrae los personajes principales que aparecen (protagonista, aliados, antagonistas, personajes relevantes).

Devuelve un JSON con esta estructura EXACTA:
{
  "characters": [
    {
      "name": "Nombre del personaje",
      "race": "raza (humano, elfo, inu-mimi, etc.)",
      "class": "clase/ocupación (aventurero, mago, esclava, etc.)",
      "description": "Descripción breve de 1-2 frases basada en el texto",
      "stats": { "level": 1, "hp": 100, "mp": 50, "str": 10, "vit": 10, "agi": 10, "dex": 10, "int": 10, "luck": 10 },
      "tags": ["protagonista", "aliado"]
    }
  ]
}

REGLAS:
- Extrae SOLO personajes que realmente aparezcan en el texto.
- Los stats deben ser coherentes con el rol del personaje (guerrero = str alto, mago = int alto).
- No inventes personajes que no estén en el texto.
- Máximo 8 personajes.
${existingNames.length > 0 ? `\nEVITA duplicar estos personajes que ya existen: ${existingNames.join(', ')}` : ''}

TEXTO DEL LIBRO:
${text.slice(0, 12000)}`;

  const response = await chatLLM({
    system,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.5,
    maxTokens: 2500
  });

  try {
    const parsed = extractJson(response);
    const chars = parsed.characters || [];
    return chars.map(normalizeCharacter);
  } catch (e) {
    console.error('Error parseando personajes del LLM:', e.message);
    return [];
  }
}

// Extrae equipamiento del texto con el LLM
export async function generateEquipment(text, existingNames = []) {
  const system = `Eres un analizador literario experto. Extraes los objetos y equipamiento mencionados en una novela y los conviertes en items de RPG. Responde ÚNICAMENTE con un JSON válido, sin markdown, sin comentarios.`;

  const prompt = `Analiza el siguiente fragmento de novela y extrae los objetos de equipamiento que se mencionan (armas, armaduras, accesorios, objetos mágicos).

Devuelve un JSON con esta estructura EXACTA:
{
  "equipment": [
    {
      "name": "Nombre del objeto",
      "slot": "weapon | armor | accessory",
      "type": "tipo (espada, arco, armadura, anillo, etc.)",
      "rarity": "common | uncommon | rare | epic | legendary",
      "stats": { "str": 0, "vit": 0, "agi": 0, "dex": 0, "int": 0, "luck": 0, "hp": 0, "mp": 0 },
      "value": 100,
      "description": "Descripción breve basada en el texto"
    }
  ]
}

REGLAS:
- Extrae SOLO objetos que realmente se mencionen en el texto.
- Los stats deben ser coherentes con el tipo de objeto (espada = str, arco = agi/dex, anillo mágico = int).
- La rareza debe ser coherente con cómo se describe el objeto en el texto.
- No inventes objetos que no estén en el texto.
- Máximo 8 objetos.

TEXTO DEL LIBRO:
${text.slice(0, 12000)}`;

  const response = await chatLLM({
    system,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.5,
    maxTokens: 2500
  });

  try {
    const parsed = extractJson(response);
    const items = parsed.equipment || [];
    return items.map(normalizeEquipment);
  } catch (e) {
    console.error('Error parseando equipamiento del LLM:', e.message);
    return [];
  }
}

// Genera ambas entidades a la vez y devuelve { characters, equipment }
export async function generateEntitiesFromStory(story) {
  const text = storyToText(story);
  if (!text) return { characters: [], equipment: [] };

  const [characters, equipment] = await Promise.all([
    generateCharacters(text),
    generateEquipment(text)
  ]);

  return { characters, equipment };
}
