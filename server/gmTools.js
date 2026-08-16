// Catálogo de herramientas (function calling) para el chat del Game Master.
// Permite que el LLM ejecute CUALQUIER operación que hoy se hace manualmente
// en la GUI del GM: CRUD de historias/capítulos, personajes, equipamiento,
// selección de historia activa, generación de entidades con IA, etc.
import {
  saveStory, getStory, listStories, deleteStory,
  saveCharacter, getCharacter, listCharacters, deleteCharacter,
  saveEquipment, getEquipment, listEquipment, deleteEquipment
} from './db.js';
import { getActiveStoryId, setActiveStoryId } from './session.js';
import { generateCharacters, generateEquipment, storyToText } from './entityGenerator.js';

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
function now() { return new Date().toISOString(); }

// ---- Helpers de resolución de historia activa ----
function resolveStory(storyId) {
  if (storyId) return getStory(storyId);
  const active = getActiveStoryId();
  const stories = listStories();
  return stories.find(s => s.id === active) || stories[0] || null;
}

// ---- Operaciones de historia/capítulos ----
function opListStories() {
  return { stories: listStories(), activeStoryId: getActiveStoryId() };
}

function opCreateStory(args) {
  const story = {
    id: makeId('story'),
    title: args.title || 'Nueva historia',
    source: 'manual',
    originalFile: null,
    language: args.language || 'es',
    chapters: [],
    createdAt: now(),
    updatedAt: now()
  };
  saveStory(story);
  setActiveStoryId(story.id);
  return { story, activeStoryId: story.id };
}

function opUpdateStory(args) {
  const story = getStory(args.storyId);
  if (!story) return { error: `Historia ${args.storyId} no encontrada` };
  if (args.title !== undefined) story.title = args.title;
  if (args.language !== undefined) story.language = args.language;
  story.updatedAt = now();
  saveStory(story);
  return { story };
}

function opDeleteStory(args) {
  const story = getStory(args.storyId);
  if (!story) return { error: `Historia ${args.storyId} no encontrada` };
  deleteStory(story.id);
  if (getActiveStoryId() === story.id) {
    const remaining = listStories();
    setActiveStoryId(remaining[0] ? remaining[0].id : null);
  }
  return { ok: true, deleted: story.title };
}

function opSelectStory(args) {
  const story = getStory(args.storyId);
  if (!story) return { error: `Historia ${args.storyId} no encontrada` };
  setActiveStoryId(story.id);
  return { ok: true, activeStoryId: story.id, story };
}

function opListChapters(args) {
  const story = resolveStory(args.storyId);
  if (!story) return { chapters: [] };
  return { storyId: story.id, storyTitle: story.title, chapters: story.chapters || [] };
}

function opCreateChapter(args) {
  const story = resolveStory(args.storyId);
  if (!story) return { error: 'No hay historia activa' };
  const chapters = story.chapters || [];
  const chapter = {
    id: makeId('cap'),
    index: args.index || chapters.length + 1,
    title: args.title || `Capítulo ${chapters.length + 1}`,
    summary: args.summary || '',
    content: args.content || '',
    scenes: (args.scenes || []).map((sc, i) => ({
      id: makeId('esc'),
      index: sc.index || i + 1,
      title: sc.title || `Escena ${i + 1}`,
      summary: sc.summary || '',
      content: sc.content || ''
    }))
  };
  chapters.push(chapter);
  story.chapters = chapters;
  story.updatedAt = now();
  saveStory(story);
  return { storyId: story.id, chapter };
}

function opUpdateChapter(args) {
  const story = resolveStory(args.storyId);
  if (!story) return { error: 'No hay historia activa' };
  const chapters = story.chapters || [];
  const idx = chapters.findIndex(c => c.id === args.chapterId);
  if (idx === -1) return { error: `Capítulo ${args.chapterId} no encontrado` };
  const ch = chapters[idx];
  if (args.title !== undefined) ch.title = args.title;
  if (args.summary !== undefined) ch.summary = args.summary;
  if (args.content !== undefined) ch.content = args.content;
  if (args.index !== undefined) ch.index = args.index;
  if (args.scenes !== undefined) {
    ch.scenes = args.scenes.map((sc, i) => ({
      id: sc.id || makeId('esc'),
      index: sc.index || i + 1,
      title: sc.title || `Escena ${i + 1}`,
      summary: sc.summary || '',
      content: sc.content || ''
    }));
  }
  story.chapters = chapters;
  story.updatedAt = now();
  saveStory(story);
  return { storyId: story.id, chapter: ch };
}

function opDeleteChapter(args) {
  const story = resolveStory(args.storyId);
  if (!story) return { error: 'No hay historia activa' };
  const chapters = story.chapters || [];
  const idx = chapters.findIndex(c => c.id === args.chapterId);
  if (idx === -1) return { error: `Capítulo ${args.chapterId} no encontrado` };
  const [removed] = chapters.splice(idx, 1);
  story.chapters = chapters;
  story.updatedAt = now();
  saveStory(story);
  return { ok: true, deleted: removed.title };
}

// ---- Operaciones de personajes ----
function opListCharacters() {
  const storyId = getActiveStoryId();
  return { characters: listCharacters(null, storyId) };
}

function opCreateCharacter(args) {
  const character = {
    id: makeId('char'),
    storyId: getActiveStoryId(),
    name: args.name || 'Sin nombre',
    race: args.race || '',
    class: args.class || '',
    description: args.description || '',
    stats: args.stats || { level: 1, hp: 100, maxHp: 100, mp: 50, maxMp: 50, str: 10, vit: 10, agi: 10, dex: 10, int: 10, luck: 10 },
    equipment: { weapon: null, armor: null, accessory: null },
    model3d: { status: 'none', url: null, imageUrl: null, generatedAt: null },
    tags: args.tags || [],
    createdAt: now(),
    updatedAt: now()
  };
  saveCharacter(character);
  return { character };
}

function opUpdateCharacter(args) {
  const char = getCharacter(args.characterId);
  if (!char) return { error: `Personaje ${args.characterId} no encontrado` };
  const allowed = ['name', 'race', 'class', 'description', 'stats', 'tags'];
  for (const key of allowed) {
    if (args[key] !== undefined) char[key] = args[key];
  }
  char.updatedAt = now();
  saveCharacter(char);
  return { character: char };
}

function opDeleteCharacter(args) {
  const char = getCharacter(args.characterId);
  if (!char) return { error: `Personaje ${args.characterId} no encontrado` };
  deleteCharacter(args.characterId);
  return { ok: true, deleted: char.name };
}

function opEquipCharacter(args) {
  const char = getCharacter(args.characterId);
  if (!char) return { error: `Personaje ${args.characterId} no encontrado` };
  const slot = args.slot;
  if (!['weapon', 'armor', 'accessory'].includes(slot)) {
    return { error: 'Slot inválido (weapon|armor|accessory)' };
  }
  if (args.equipmentId) {
    const item = getEquipment(args.equipmentId);
    if (!item) return { error: `Equipamiento ${args.equipmentId} no encontrado` };
    if (item.slot !== slot) return { error: `El item no encaja en slot ${slot}` };
  }
  char.equipment = char.equipment || {};
  char.equipment[slot] = args.equipmentId || null;
  char.updatedAt = now();
  saveCharacter(char);
  return { character: char };
}

function opUnequipCharacter(args) {
  const char = getCharacter(args.characterId);
  if (!char) return { error: `Personaje ${args.characterId} no encontrado` };
  const slot = args.slot;
  if (!['weapon', 'armor', 'accessory'].includes(slot)) {
    return { error: 'Slot inválido (weapon|armor|accessory)' };
  }
  char.equipment = char.equipment || {};
  char.equipment[slot] = null;
  char.updatedAt = now();
  saveCharacter(char);
  return { character: char };
}

function opGenerateCharacter3D(args) {
  const char = getCharacter(args.characterId);
  if (!char) return { error: `Personaje ${args.characterId} no encontrado` };
  char.model3d = { status: 'pending', url: null, imageUrl: null, generatedAt: now() };
  char.updatedAt = now();
  saveCharacter(char);
  return { character: char, note: 'Modelo 3D en cola (pending)' };
}

// ---- Operaciones de equipamiento ----
function opListEquipment() {
  const storyId = getActiveStoryId();
  return { equipment: listEquipment(null, storyId) };
}

function opCreateEquipment(args) {
  const item = {
    id: makeId('eq'),
    storyId: getActiveStoryId(),
    name: args.name || 'Sin nombre',
    slot: args.slot || 'weapon',
    type: args.type || '',
    rarity: args.rarity || 'common',
    stats: args.stats || { str: 0, vit: 0, agi: 0, dex: 0, int: 0, luck: 0, hp: 0, mp: 0 },
    value: typeof args.value === 'number' ? args.value : 0,
    description: args.description || '',
    model3d: { status: 'none', url: null, imageUrl: null, generatedAt: null },
    createdAt: now(),
    updatedAt: now()
  };
  saveEquipment(item);
  return { equipment: item };
}

function opUpdateEquipment(args) {
  const item = getEquipment(args.equipmentId);
  if (!item) return { error: `Equipamiento ${args.equipmentId} no encontrado` };
  const allowed = ['name', 'slot', 'type', 'rarity', 'stats', 'value', 'description'];
  for (const key of allowed) {
    if (args[key] !== undefined) item[key] = args[key];
  }
  item.updatedAt = now();
  saveEquipment(item);
  return { equipment: item };
}

function opDeleteEquipment(args) {
  const item = getEquipment(args.equipmentId);
  if (!item) return { error: `Equipamiento ${args.equipmentId} no encontrado` };
  deleteEquipment(args.equipmentId);
  return { ok: true, deleted: item.name };
}

// ---- Operaciones con IA (reestructurar, generar entidades) ----
async function opGenerateEntities(args) {
  const story = resolveStory(args.storyId);
  if (!story) return { error: 'No hay historia cargada' };
  const text = storyToText(story);
  if (!text) return { error: 'La historia no tiene contenido' };
  const existingCharNames = listCharacters(null, story.id).map(c => c.name);
  const existingEqNames = listEquipment(null, story.id).map(e => e.name);
  const [newChars, newItems] = await Promise.all([
    generateCharacters(text, existingCharNames),
    generateEquipment(text, existingEqNames)
  ]);
  let charsSaved = 0;
  for (const c of newChars) {
    if (existingCharNames.includes(c.name)) continue;
    c.storyId = story.id;
    await saveCharacter(c);
    charsSaved++;
  }
  let itemsSaved = 0;
  for (const e of newItems) {
    if (existingEqNames.includes(e.name)) continue;
    e.storyId = story.id;
    await saveEquipment(e);
    itemsSaved++;
  }
  return { charsSaved, itemsSaved, characters: newChars, equipment: newItems };
}

// ---- Registro de tools: nombre -> { schema, handler } ----
export const GM_TOOLS = [
  {
    name: 'list_stories',
    description: 'Lista todas las historias cargadas y cuál es la activa.',
    parameters: { type: 'object', properties: {}, required: [] },
    handler: opListStories
  },
  {
    name: 'create_story',
    description: 'Crea una historia nueva (vacía). La deja como activa.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Título de la historia' },
        language: { type: 'string', description: 'Idioma (es, ja, en...)' }
      },
      required: ['title']
    },
    handler: opCreateStory
  },
  {
    name: 'update_story',
    description: 'Actualiza el título o idioma de una historia.',
    parameters: {
      type: 'object',
      properties: {
        storyId: { type: 'string', description: 'ID de la historia' },
        title: { type: 'string' },
        language: { type: 'string' }
      },
      required: ['storyId']
    },
    handler: opUpdateStory
  },
  {
    name: 'delete_story',
    description: 'Borra una historia y todos sus datos asociados.',
    parameters: {
      type: 'object',
      properties: { storyId: { type: 'string' } },
      required: ['storyId']
    },
    handler: opDeleteStory
  },
  {
    name: 'select_story',
    description: 'Selecciona la historia activa (la que se está jugando/editando).',
    parameters: {
      type: 'object',
      properties: { storyId: { type: 'string' } },
      required: ['storyId']
    },
    handler: opSelectStory
  },
  {
    name: 'list_chapters',
    description: 'Lista los capítulos de la historia activa (o de la indicada).',
    parameters: {
      type: 'object',
      properties: { storyId: { type: 'string', description: 'Opcional. Si se omite, usa la activa' } },
      required: []
    },
    handler: opListChapters
  },
  {
    name: 'create_chapter',
    description: 'Añade un capítulo nuevo a la historia activa (o la indicada).',
    parameters: {
      type: 'object',
      properties: {
        storyId: { type: 'string', description: 'Opcional. Si se omite, usa la activa' },
        title: { type: 'string', description: 'Título del capítulo' },
        summary: { type: 'string', description: 'Resumen breve' },
        content: { type: 'string', description: 'Texto completo del capítulo' },
        index: { type: 'number', description: 'Número de capítulo (opcional)' },
        scenes: {
          type: 'array',
          description: 'Escenas del capítulo (opcional)',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              summary: { type: 'string' },
              content: { type: 'string' }
            }
          }
        }
      },
      required: ['title']
    },
    handler: opCreateChapter
  },
  {
    name: 'update_chapter',
    description: 'Actualiza el título, resumen, contenido o escenas de un capítulo.',
    parameters: {
      type: 'object',
      properties: {
        storyId: { type: 'string', description: 'Opcional. Si se omite, usa la activa' },
        chapterId: { type: 'string', description: 'ID del capítulo' },
        title: { type: 'string' },
        summary: { type: 'string' },
        content: { type: 'string' },
        index: { type: 'number' },
        scenes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              summary: { type: 'string' },
              content: { type: 'string' }
            }
          }
        }
      },
      required: ['chapterId']
    },
    handler: opUpdateChapter
  },
  {
    name: 'delete_chapter',
    description: 'Borra un capítulo de la historia activa (o la indicada).',
    parameters: {
      type: 'object',
      properties: {
        storyId: { type: 'string', description: 'Opcional. Si se omite, usa la activa' },
        chapterId: { type: 'string' }
      },
      required: ['chapterId']
    },
    handler: opDeleteChapter
  },
  {
    name: 'list_characters',
    description: 'Lista los personajes de la historia activa.',
    parameters: { type: 'object', properties: {}, required: [] },
    handler: opListCharacters
  },
  {
    name: 'create_character',
    description: 'Crea un personaje nuevo en la historia activa.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        race: { type: 'string' },
        class: { type: 'string' },
        description: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        stats: {
          type: 'object',
          properties: {
            level: { type: 'number' }, hp: { type: 'number' }, maxHp: { type: 'number' },
            mp: { type: 'number' }, maxMp: { type: 'number' }, str: { type: 'number' },
            vit: { type: 'number' }, agi: { type: 'number' }, dex: { type: 'number' },
            int: { type: 'number' }, luck: { type: 'number' }
          }
        }
      },
      required: ['name']
    },
    handler: opCreateCharacter
  },
  {
    name: 'update_character',
    description: 'Actualiza los datos de un personaje (nombre, raza, clase, descripción, stats, tags).',
    parameters: {
      type: 'object',
      properties: {
        characterId: { type: 'string' },
        name: { type: 'string' },
        race: { type: 'string' },
        class: { type: 'string' },
        description: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        stats: { type: 'object' }
      },
      required: ['characterId']
    },
    handler: opUpdateCharacter
  },
  {
    name: 'delete_character',
    description: 'Borra un personaje.',
    parameters: {
      type: 'object',
      properties: { characterId: { type: 'string' } },
      required: ['characterId']
    },
    handler: opDeleteCharacter
  },
  {
    name: 'equip_character',
    description: 'Equipa un item a un personaje en un slot (weapon|armor|accessory).',
    parameters: {
      type: 'object',
      properties: {
        characterId: { type: 'string' },
        slot: { type: 'string', enum: ['weapon', 'armor', 'accessory'] },
        equipmentId: { type: 'string', description: 'ID del item. Vacío para desequipar' }
      },
      required: ['characterId', 'slot']
    },
    handler: opEquipCharacter
  },
  {
    name: 'unequip_character',
    description: 'Desequipa un slot de un personaje.',
    parameters: {
      type: 'object',
      properties: {
        characterId: { type: 'string' },
        slot: { type: 'string', enum: ['weapon', 'armor', 'accessory'] }
      },
      required: ['characterId', 'slot']
    },
    handler: opUnequipCharacter
  },
  {
    name: 'generate_character_3d',
    description: 'Marca un personaje para generación de modelo 3D (queda en cola/pending).',
    parameters: {
      type: 'object',
      properties: { characterId: { type: 'string' } },
      required: ['characterId']
    },
    handler: opGenerateCharacter3D
  },
  {
    name: 'list_equipment',
    description: 'Lista el equipamiento de la historia activa.',
    parameters: { type: 'object', properties: {}, required: [] },
    handler: opListEquipment
  },
  {
    name: 'create_equipment',
    description: 'Crea un item de equipamiento en la historia activa.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        slot: { type: 'string', enum: ['weapon', 'armor', 'accessory'] },
        type: { type: 'string' },
        rarity: { type: 'string', enum: ['common', 'uncommon', 'rare', 'epic', 'legendary'] },
        value: { type: 'number' },
        description: { type: 'string' },
        stats: { type: 'object' }
      },
      required: ['name']
    },
    handler: opCreateEquipment
  },
  {
    name: 'update_equipment',
    description: 'Actualiza los datos de un item de equipamiento.',
    parameters: {
      type: 'object',
      properties: {
        equipmentId: { type: 'string' },
        name: { type: 'string' },
        slot: { type: 'string', enum: ['weapon', 'armor', 'accessory'] },
        type: { type: 'string' },
        rarity: { type: 'string' },
        value: { type: 'number' },
        description: { type: 'string' },
        stats: { type: 'object' }
      },
      required: ['equipmentId']
    },
    handler: opUpdateEquipment
  },
  {
    name: 'delete_equipment',
    description: 'Borra un item de equipamiento.',
    parameters: {
      type: 'object',
      properties: { equipmentId: { type: 'string' } },
      required: ['equipmentId']
    },
    handler: opDeleteEquipment
  },
  {
    name: 'generate_entities',
    description: 'Genera personajes y equipamiento automáticamente con IA a partir del texto de la historia.',
    parameters: {
      type: 'object',
      properties: { storyId: { type: 'string', description: 'Opcional. Si se omite, usa la activa' } },
      required: []
    },
    handler: opGenerateEntities
  }
];

// Mapa nombre -> tool (para resolución rápida)
export const GM_TOOL_MAP = Object.fromEntries(GM_TOOLS.map(t => [t.name, t]));

// Ejecuta una tool por nombre con sus argumentos. Devuelve { ok, result } o { ok:false, error }.
export async function executeTool(name, args) {
  const tool = GM_TOOL_MAP[name];
  if (!tool) return { ok: false, error: `Tool desconocida: ${name}` };
  try {
    const result = await tool.handler(args || {});
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
