// Rutas de historia — multi-historia: listar, crear, seleccionar activa, CRUD por id.
// Cada historia es un juego independiente con su propio contexto (personajes,
// equipamiento, zonas) y estado aislado.
import { Router } from 'express';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { saveStory, getStory, listStories, deleteStory, saveCharacter, listCharacters, saveEquipment, listEquipment } from '../db.js';
import { chatLLM } from '../llm.js';
import { generateCharacters, generateEquipment, storyToText } from '../entityGenerator.js';
import { getActiveStoryId, setActiveStoryId } from '../session.js';
import multer from 'multer';
import AdmZip from 'adm-zip';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

const __dirname = dirname(fileURLToPath(import.meta.url));
// Carpeta donde se guardan las imágenes extraídas de los epubs, servida estáticamente en /stories/
// __dirname = server/routes → subimos 2 niveles hasta la raíz del proyecto → public/stories
const STORIES_IMG_DIR = join(__dirname, '..', '..', 'public', 'stories');

function makeId() {
  return 'story_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function now() { return new Date().toISOString(); }

// Extrae texto plano de un buffer (txt o epub)
function extractText(buffer, originalName) {
  const name = originalName.toLowerCase();
  if (name.endsWith('.txt')) {
    return buffer.toString('utf-8');
  }
  if (name.endsWith('.epub')) {
    // Un epub es un ZIP con XHTML. Lo descomprimimos y extraemos el texto real.
    try {
      const zip = new AdmZip(buffer);
      const entries = zip.getEntries();
      const texts = [];
      for (const entry of entries) {
        const en = entry.entryName.toLowerCase();
        // Solo contenido XHTML/HTML (no cubiertas, estilos, etc.)
        if (!en.endsWith('.xhtml') && !en.endsWith('.html') && !en.endsWith('.htm')) continue;
        if (en.includes('toc') || en.includes('nav') || en.includes('cover')) continue;
        let html;
        try {
          html = entry.getData().toString('utf-8');
        } catch {
          continue;
        }
        // Quitar etiquetas y entidades HTML para quedarnos con el texto
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<\/p>/gi, '\n\n')
          .replace(/<\/h[1-6]>/gi, '\n\n')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/gi, ' ')
          .replace(/&amp;/gi, '&')
          .replace(/&lt;/gi, '<')
          .replace(/&gt;/gi, '>')
          .replace(/&quot;/gi, '"')
          .replace(/&#39;/gi, "'")
          .replace(/[ \t]+/g, ' ')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
        if (text.length > 20) texts.push(text);
      }
      const joined = texts.join('\n\n');
      if (joined.trim().length > 0) return joined;
    } catch (err) {
      console.error('Error descomprimiendo epub:', err.message);
    }
    return buffer.toString('utf-8');
  }
  return buffer.toString('utf-8');
}

// Extrae el título real del epub desde el OPF (<dc:title>), que es la fuente fiable.
function extractEpubTitle(buffer) {
  try {
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries();
    const opf = entries.find(e => e.entryName.toLowerCase().endsWith('.opf'));
    if (opf) {
      const content = opf.getData().toString('utf-8');
      const m = content.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i);
      if (m) {
        const title = m[1]
          .replace(/<[^>]+>/g, '')
          .replace(/&amp;/gi, '&')
          .replace(/&lt;/gi, '<')
          .replace(/&gt;/gi, '>')
          .replace(/&quot;/gi, '"')
          .replace(/&#39;/gi, "'")
          .trim();
        if (title) return title;
      }
    }
  } catch (err) {
    console.error('Error extrayendo título del OPF:', err.message);
  }
  return null;
}

// Extrae las imágenes del epub y las guarda en public/stories/<storyId>/.
// Devuelve la lista de URLs servibles (/stories/<storyId>/<nombre>).
function extractEpubImages(buffer, storyId) {
  const saved = [];
  try {
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries();
    const imgEntries = entries.filter(e => /\.(png|jpe?g|gif|webp|svg)$/i.test(e.entryName));
    if (imgEntries.length === 0) return saved;

    const dir = join(STORIES_IMG_DIR, storyId);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    for (const entry of imgEntries) {
      try {
        const data = entry.getData();
        if (!data || data.length === 0) continue;
        // Nombre de archivo seguro: basado en el nombre original
        const base = entry.entryName.split('/').pop();
        const safeName = base.replace(/[^a-zA-Z0-9._-]/g, '_');
        const filePath = join(dir, safeName);
        writeFileSync(filePath, data);
        saved.push(`/stories/${storyId}/${safeName}`);
      } catch (e) {
        console.error('Error guardando imagen epub:', e.message);
      }
    }
  } catch (err) {
    console.error('Error extrayendo imágenes del epub:', err.message);
  }
  return saved;
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
    gameType: data.gameType || 'open_world', // 'open_world' | 'visual_novel'
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

    const isEpub = req.file.originalname.toLowerCase().endsWith('.epub');
    const storyId = makeId();
    // Título fiable: primero el del OPF (epub), luego el del LLM, luego el nombre del archivo
    let title = null;
    if (isEpub) title = extractEpubTitle(req.file.buffer);
    title = title || structured.title || req.file.originalname.replace(/\.[^.]+$/, '');

    // Extraer y guardar las imágenes del epub (portada + ilustraciones)
    let images = [];
    if (isEpub) images = extractEpubImages(req.file.buffer, storyId);

    const story = {
      id: storyId,
      title,
      source: isEpub ? 'epub' : 'text',
      originalFile: req.file.originalname,
      language: 'ja',
      gameType: 'open_world', // por defecto; el GM puede cambiarlo a 'visual_novel'
      chapters,
      images,
      coverImage: images.length > 0 ? images[0] : null,
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
  if (data.gameType !== undefined) story.gameType = data.gameType;
  if (data.chapters !== undefined) story.chapters = data.chapters;
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
