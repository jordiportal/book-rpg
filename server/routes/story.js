// Rutas de historia — multi-historia: listar, crear, seleccionar activa, CRUD por id.
// Cada historia es un juego independiente con su propio contexto (personajes,
// equipamiento, zonas) y estado aislado.
import { Router } from 'express';
import { saveStory, getStory, listStories, deleteStory, saveCharacter, listCharacters, saveEquipment, listEquipment } from '../db.js';
import { chatLLM } from '../llm.js';
import { generateCharacters, generateEquipment, storyToText } from '../entityGenerator.js';
import { getActiveStoryId, setActiveStoryId } from '../session.js';
import multer from 'multer';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

function makeId() {
  return 'story_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function now() { return new Date().toISOString(); }

// Extrae texto plano de un buffer (txt o epub crudo)
function extractText(buffer, originalName) {
  const name = originalName.toLowerCase();
  if (name.endsWith('.txt')) {
    return buffer.toString('utf-8');
  }
  if (name.endsWith('.epub')) {
    // Hack: extraer texto entre tags HTML dentro del ZIP crudo
    const raw = buffer.toString('utf-8');
    const texts = [];
    const regex = />([^<]{3,})</g;
    let m;
    while ((m = regex.exec(raw)) !== null) {
      const t = m[1].trim();
      if (t.length > 10 && !t.startsWith('<?xml') && !t.startsWith('<!')) {
        texts.push(t);
      }
    }
    return texts.join('\n\n');
  }
  return buffer.toString('utf-8');
}

// Usa el LLM para estructurar texto en capítulos y escenas
async function llmStructureStory(fullText) {
  const system = `Eres un asistente de estructuración literaria. Tu trabajo es dividir un texto en capítulos y escenas. Responde ÚNICAMENTE con un JSON válido y nada más.`;
  const prompt = `Divide el siguiente texto en capítulos y escenas. Devuelve un JSON con esta estructura exacta:
{
  "title": "Título de la obra",
  "chapters": [
    {
      "index": 1,
      "title": "Título del capítulo",
      "summary": "Resumen breve del capítulo",
      "scenes": [
        { "index": 1, "title": "Título de la escena", "summary": "Resumen breve", "content": "Texto completo de la escena" }
      ]
    }
  ]
}

REGLAS:
- Cada capítulo debe tener al menos una escena.
- El contenido de cada escena debe ser una porción real del texto original.
- No inventes texto que no esté en la fuente.
- Si el texto es muy largo, divide en capítulos lógicos (por cambios de escena, saltos temporales, o números de capítulo).
- El JSON debe ser válido, sin comentarios, sin markdown.

TEXTO A ESTRUCTURAR (primeros 8000 caracteres):
${fullText.slice(0, 8000)}
${fullText.length > 8000 ? '\n[...texto truncado para estructuración inicial...]' : ''}`;

  const response = await chatLLM({
    system,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    maxTokens: 2000
  });

  try {
    const start = response.indexOf('{');
    const end = response.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('No JSON found');
    return JSON.parse(response.slice(start, end + 1));
  } catch (e) {
    return {
      title: 'Historia sin título',
      chapters: [{
        index: 1,
        title: 'Capítulo único',
        summary: 'Texto completo',
        scenes: [{
          index: 1,
          title: 'Escena única',
          summary: 'Texto completo',
          content: fullText.slice(0, 5000)
        }]
      }]
    };
  }
}

// Normaliza los capítulos con IDs
function normalizeChapters(structured) {
  return (structured.chapters || []).map((ch, ci) => ({
    id: `cap-${ci + 1}`,
    index: ch.index || ci + 1,
    title: ch.title || `Capítulo ${ci + 1}`,
    summary: ch.summary || '',
    content: ch.content || '',
    scenes: (ch.scenes || []).map((sc, si) => ({
      id: `esc-${ci + 1}-${si + 1}`,
      index: sc.index || si + 1,
      title: sc.title || `Escena ${si + 1}`,
      summary: sc.summary || '',
      content: sc.content || ''
    }))
  }));
}

// GET /api/story — listar todas las historias + la activa
router.get('/', (req, res) => {
  const stories = listStories();
  const activeId = getActiveStoryId();
  const active = stories.find(s => s.id === activeId) || stories[0] || null;
  res.json({ stories, activeStoryId: active ? active.id : null, story: active });
});

// GET /api/story/active — obtener la historia activa
router.get('/active', (req, res) => {
  const stories = listStories();
  const activeId = getActiveStoryId();
  const active = stories.find(s => s.id === activeId) || stories[0] || null;
  res.json({ story: active, activeStoryId: active ? active.id : null });
});

// POST /api/story/select — seleccionar la historia activa
router.post('/select', (req, res) => {
  const { storyId } = req.body || {};
  const story = getStory(storyId);
  if (!story) return res.status(404).json({ error: 'Historia no encontrada' });
  setActiveStoryId(storyId);
  res.json({ ok: true, activeStoryId: storyId, story });
});

// POST /api/story — crear una historia nueva (vacía, para luego subir contenido)
router.post('/', (req, res) => {
  const data = req.body || {};
  const story = {
    id: makeId(),
    title: data.title || 'Nueva historia',
    source: 'manual',
    originalFile: null,
    language: data.language || 'es',
    chapters: [],
    createdAt: now(),
    updatedAt: now()
  };
  saveStory(story);
  setActiveStoryId(story.id);
  res.status(201).json({ story, activeStoryId: story.id });
});

// POST /api/story/upload — subir archivo (epub o txt) y crear una historia nueva
router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se subió archivo' });
  try {
    const rawText = extractText(req.file.buffer, req.file.originalname);
    const structured = await llmStructureStory(rawText);
    const chapters = normalizeChapters(structured);

    const story = {
      id: makeId(),
      title: structured.title || req.file.originalname.replace(/\.[^.]+$/, ''),
      source: req.file.originalname.toLowerCase().endsWith('.epub') ? 'epub' : 'text',
      originalFile: req.file.originalname,
      language: 'ja',
      chapters,
      createdAt: now(),
      updatedAt: now()
    };

    saveStory(story);
    setActiveStoryId(story.id);

    // Generación automática de personajes y equipamiento a partir del libro
    let charsSaved = 0;
    let itemsSaved = 0;
    try {
      const text = storyToText(story);
      const existingCharNames = listCharacters(null, story.id).map(c => c.name);
      const existingEqNames = listEquipment(null, story.id).map(e => e.name);

      const [newChars, newItems] = await Promise.all([
        generateCharacters(text, existingCharNames),
        generateEquipment(text, existingEqNames)
      ]);

      for (const c of newChars) {
        if (existingCharNames.includes(c.name)) continue;
        c.storyId = story.id;
        await saveCharacter(c);
        charsSaved++;
      }
      for (const e of newItems) {
        if (existingEqNames.includes(e.name)) continue;
        e.storyId = story.id;
        await saveEquipment(e);
        itemsSaved++;
      }
    } catch (genErr) {
      console.error('Error generando entidades en upload:', genErr.message);
    }

    res.status(201).json({ story, activeStoryId: story.id, charsSaved, itemsSaved });
  } catch (err) {
    console.error('Error en story/upload:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/story/generate-entities — generar personajes y equipamiento con IA
// para la historia activa (o la indicada por body.storyId)
router.post('/generate-entities', async (req, res) => {
  const { storyId } = req.body || {};
  const stories = listStories();
  const story = storyId ? getStory(storyId) : (stories.find(s => s.id === getActiveStoryId()) || stories[0]);
  if (!story) return res.status(404).json({ error: 'No hay historia cargada' });

  try {
    const text = storyToText(story);
    if (!text) return res.status(400).json({ error: 'La historia no tiene contenido' });

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

    res.json({ characters: newChars, equipment: newItems, charsSaved, itemsSaved });
  } catch (err) {
    console.error('Error en story/generate-entities:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/story/parse — re-estructurar historia con IA (la activa o la indicada)
router.post('/parse', async (req, res) => {
  const { storyId } = req.body || {};
  const stories = listStories();
  const story = storyId ? getStory(storyId) : (stories.find(s => s.id === getActiveStoryId()) || stories[0]);
  if (!story) return res.status(404).json({ error: 'No hay historia cargada' });

  try {
    const fullText = story.chapters.map(ch => ch.content).join('\n\n');
    const structured = await llmStructureStory(fullText);
    story.chapters = normalizeChapters(structured);
    story.title = structured.title || story.title;
    story.updatedAt = now();
    saveStory(story);
    res.json({ story });
  } catch (err) {
    console.error('Error en story/parse:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/story/:id — obtener una historia por id
router.get('/:id', (req, res) => {
  const story = getStory(req.params.id);
  if (!story) return res.status(404).json({ error: 'Historia no encontrada' });
  res.json({ story });
});

// PUT /api/story/:id — actualizar metadatos de una historia
router.put('/:id', (req, res) => {
  const story = getStory(req.params.id);
  if (!story) return res.status(404).json({ error: 'Historia no encontrada' });
  const data = req.body || {};
  if (data.title !== undefined) story.title = data.title;
  if (data.language !== undefined) story.language = data.language;
  story.updatedAt = now();
  saveStory(story);
  res.json({ story });
});

// DELETE /api/story/:id — borrar una historia y sus datos asociados
router.delete('/:id', (req, res) => {
  const story = getStory(req.params.id);
  if (!story) return res.status(404).json({ error: 'Historia no encontrada' });
  deleteStory(story.id);
  // Si era la activa, pasar a otra
  if (getActiveStoryId() === story.id) {
    const remaining = listStories();
    setActiveStoryId(remaining[0] ? remaining[0].id : null);
  }
  res.json({ ok: true });
});

// GET /api/story/:id/chapters — listar capítulos de una historia
router.get('/:id/chapters', (req, res) => {
  const story = getStory(req.params.id);
  if (!story) return res.json({ chapters: [] });
  res.json({ chapters: story.chapters || [] });
});

// GET /api/story/:id/chapters/:cid — obtener capítulo
router.get('/:id/chapters/:cid', (req, res) => {
  const story = getStory(req.params.id);
  if (!story) return res.status(404).json({ error: 'Historia no encontrada' });
  const chapter = (story.chapters || []).find(c => c.id === req.params.cid);
  if (!chapter) return res.status(404).json({ error: 'Capítulo no encontrado' });
  res.json({ chapter });
});

export default router;
