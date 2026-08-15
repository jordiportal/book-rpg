// Rutas de historia — carga, parseo y gestión de capítulos/escenas
import { Router } from 'express';
import { saveStory, getStory, listStories, deleteStory, saveCharacter, listCharacters, saveEquipment, listEquipment } from '../db.js';
import { chatLLM } from '../llm.js';
import { generateCharacters, generateEquipment, storyToText } from '../entityGenerator.js';
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
    // Buscar contenido entre > y < (texto plano dentro de tags)
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
  // Fallback: tratar como texto
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

  // Extraer JSON de la respuesta
  try {
    const start = response.indexOf('{');
    const end = response.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('No JSON found');
    return JSON.parse(response.slice(start, end + 1));
  } catch (e) {
    // Fallback: estructura mínima
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

// GET /api/story — obtener la historia actual (la primera, o null)
router.get('/', (req, res) => {
  const stories = listStories();
  const story = stories[0] || null;
  res.json({ story });
});

// POST /api/story/upload — subir archivo (epub o txt)
router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se subió archivo' });
  try {
    const rawText = extractText(req.file.buffer, req.file.originalname);
    const structured = await llmStructureStory(rawText);

    // Asignar IDs a capítulos y escenas
    const chapters = (structured.chapters || []).map((ch, ci) => ({
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

    // Generación automática de personajes y equipamiento a partir del libro
    let charsSaved = 0;
    let itemsSaved = 0;
    try {
      const text = storyToText(story);
      const existingCharNames = listCharacters().map(c => c.name);
      const existingEqNames = listEquipment().map(e => e.name);

      const [newChars, newItems] = await Promise.all([
        generateCharacters(text, existingCharNames),
        generateEquipment(text, existingEqNames)
      ]);

      for (const c of newChars) {
        if (existingCharNames.includes(c.name)) continue;
        await saveCharacter(c);
        charsSaved++;
      }
      for (const e of newItems) {
        if (existingEqNames.includes(e.name)) continue;
        await saveEquipment(e);
        itemsSaved++;
      }
    } catch (genErr) {
      console.error('Error generando entidades en upload:', genErr.message);
    }

    res.status(201).json({ story, charsSaved, itemsSaved });
  } catch (err) {
    console.error('Error en story/upload:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/story/generate-entities — generar personajes y equipamiento con IA a partir de la historia
router.post('/generate-entities', async (req, res) => {
  const stories = listStories();
  const story = stories[0];
  if (!story) return res.status(404).json({ error: 'No hay historia cargada' });

  try {
    const text = storyToText(story);
    if (!text) return res.status(400).json({ error: 'La historia no tiene contenido' });

    const existingCharNames = listCharacters().map(c => c.name);
    const existingEqNames = listEquipment().map(e => e.name);

    const [newChars, newItems] = await Promise.all([
      generateCharacters(text, existingCharNames),
      generateEquipment(text, existingEqNames)
    ]);

    // Guardar personajes nuevos
    let charsSaved = 0;
    for (const c of newChars) {
      if (existingCharNames.includes(c.name)) continue;
      await saveCharacter(c);
      charsSaved++;
    }

    // Guardar items nuevos
    let itemsSaved = 0;
    for (const e of newItems) {
      if (existingEqNames.includes(e.name)) continue;
      await saveEquipment(e);
      itemsSaved++;
    }

    res.json({ characters: newChars, equipment: newItems, charsSaved, itemsSaved });
  } catch (err) {
    console.error('Error en story/generate-entities:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/story/parse — re-estructurar historia con IA
router.post('/parse', async (req, res) => {
  const stories = listStories();
  const story = stories[0];
  if (!story) return res.status(404).json({ error: 'No hay historia cargada' });

  try {
    // Reconstruir texto completo de los capítulos
    const fullText = story.chapters.map(ch => ch.content).join('\n\n');
    const structured = await llmStructureStory(fullText);

    story.chapters = (structured.chapters || []).map((ch, ci) => ({
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
    story.title = structured.title || story.title;
    story.updatedAt = now();
    saveStory(story);
    res.json({ story });
  } catch (err) {
    console.error('Error en story/parse:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/story — actualizar metadatos
router.put('/', (req, res) => {
  const stories = listStories();
  let story = stories[0];
  if (!story) return res.status(404).json({ error: 'No hay historia cargada' });
  const data = req.body || {};
  if (data.title !== undefined) story.title = data.title;
  if (data.language !== undefined) story.language = data.language;
  story.updatedAt = now();
  saveStory(story);
  res.json({ story });
});

// DELETE /api/story — borrar historia
router.delete('/', (req, res) => {
  const stories = listStories();
  const story = stories[0];
  if (story) deleteStory(story.id);
  res.json({ ok: true });
});

// GET /api/story/chapters — listar capítulos
router.get('/chapters', (req, res) => {
  const stories = listStories();
  const story = stories[0];
  if (!story) return res.json({ chapters: [] });
  res.json({ chapters: story.chapters || [] });
});

// GET /api/story/chapters/:id — obtener capítulo
router.get('/chapters/:id', (req, res) => {
  const stories = listStories();
  const story = stories[0];
  if (!story) return res.status(404).json({ error: 'No hay historia cargada' });
  const chapter = (story.chapters || []).find(c => c.id === req.params.id);
  if (!chapter) return res.status(404).json({ error: 'Capítulo no encontrado' });
  res.json({ chapter });
});

export default router;
