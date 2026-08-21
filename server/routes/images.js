// Rutas de generación y edición de imágenes con flux2 (vía litellm).
//
// CONTRATO CORRECTO DE FLUX 2 (multi-referencia):
//   NO usar /v1/images/generations ni /v1/images/edits (el contrato de OpenAI
//   no encaja con Flux 2 multi-referencia). Usar POST /v1/chat/completions con
//   model: "flux2":
//
//   - Ficha de personaje: 1 image_url (portada, data URI) + prompt de aislar
//     personaje, fondo liso, sin texto ni logos.
//   - Escena: 1 image_url (la ficha) + prompt de la escena (p.ej. estudiando en
//     una biblioteca). Con 2+ imágenes es multi-referencia (personaje + localización).
//
//   La respuesta NO es un PNG suelto: choices[0].message.content es un JSON con
//   { image_base64, width, height, references }. Decodificar el PNG ahí.
//
//   T2I puro (sin foto): el mismo chat sin imágenes, o flux2-img en /v1/images/generations.
//
// Las imágenes generadas se guardan en public/stories/<storyId>/generated/ y se
// sirven estáticamente. El GM las empareja manualmente con capítulos/escenas.
import { Router } from 'express';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { LLM_CONFIG } from '../llm.js';
import { getStory, saveStory, getCharacter, saveCharacter } from '../db.js';

const router = Router();
const __dirname = dirname(fileURLToPath(import.meta.url));
const STORIES_IMG_DIR = join(__dirname, '..', '..', 'public', 'stories');

function genDir(storyId) {
  return join(STORIES_IMG_DIR, storyId, 'generated');
}

// Guarda un b64 (PNG) en disco y devuelve la URL servible.
function saveB64(storyId, b64) {
  const dir = genDir(storyId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const name = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
  writeFileSync(join(dir, name), Buffer.from(b64, 'base64'));
  return `/stories/${storyId}/generated/${name}`;
}

// ── Helper: llamada a Flux 2 vía chat/completions ────────────────────────
// images: array de data URIs (referencias). prompt: texto. Devuelve la URL
// servible de la imagen generada (guardada en disco).
async function flux2Chat({ storyId, images = [], prompt }) {
  // Construye los mensajes: un mensaje de sistema + un mensaje de usuario con
  // el prompt y las imágenes de referencia (content multimodal).
  const userContent = [
    { type: 'text', text: prompt },
    ...images.map(src => ({ type: 'image_url', image_url: { url: src } }))
  ];

  const body = {
    model: 'flux2',
    messages: [
      { role: 'system', content: 'Genera la imagen solicitada. Devuelve SOLO un JSON con el campo image_base64 (PNG en base64).' },
      { role: 'user', content: userContent }
    ],
    stream: false
  };

  const r = await fetch(`${LLM_CONFIG.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${LLM_CONFIG.apiKey}`
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(600000) // 10 min: Flux 2 con imagen de referencia puede tardar >5 min
  });
  if (!r.ok) {
    const errText = await r.text();
    // Intentar extraer un mensaje legible del error de litellm/ComfyUI
    let msg = `flux2 ${r.status}`;
    try {
      const j = JSON.parse(errText);
      const m = j?.error?.message || '';
      // El mensaje de litellm suele ser "litellm.X: ... exception_message: '...'"
      // (puede venir con backslashes escapados). Extraer el texto tras exception_message.
      const idx = m.indexOf('exception_message');
      if (idx >= 0) {
        let rest = m.slice(idx + 'exception_message'.length);
        // saltar "': \" o "': ' o "':" y comillas
        rest = rest.replace(/^[^A-Za-z0-9]{0,4}/, '');
        rest = rest.replace(/^["']/, '').replace(/^\\["']/, '');
        // cortar en el cierre de comillas (", ' o \")
        const end = rest.search(/["']\s*[,}\]]/);
        msg = (end > 0 ? rest.slice(0, end) : rest).slice(0, 200);
      } else if (m) {
        msg = m.slice(0, 300);
      }
    } catch { /* no JSON */ }
    throw new Error(msg);
  }
  const data = await r.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('flux2 no devolvió contenido');

  // El contenido es un JSON con image_base64
  let parsed;
  if (typeof content === 'string') {
    try {
      parsed = JSON.parse(content);
    } catch {
      // Si no es JSON puro, intentar extraer el primer objeto JSON
      const m = content.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]);
      else throw new Error('flux2 no devolvió un JSON válido');
    }
  } else {
    parsed = content;
  }

  const b64 = parsed.image_base64 || parsed.image_b64 || parsed.b64_json;
  if (!b64) throw new Error('flux2 no devolvió image_base64');
  return saveB64(storyId, b64);
}

// Convierte una URL servida por /stories/... a data URI (para usarla como referencia).
function urlToDataUri(imageUrl) {
  const rel = imageUrl.replace(/^\/stories\//, '');
  const filePath = join(STORIES_IMG_DIR, rel);
  if (!existsSync(filePath)) return null;
  const buf = readFileSync(filePath);
  return `data:image/png;base64,${buf.toString('base64')}`;
}

// Empareja una URL de imagen con una escena o capítulo de la historia.
function attachImage(storyId, url, { chapterId, sceneId }) {
  const story = getStory(storyId);
  if (!story) return null;
  const ch = (story.chapters || []).find(c => c.id === chapterId);
  if (!ch) return null;
  if (sceneId) {
    const sc = (ch.scenes || []).find(s => s.id === sceneId);
    if (sc) sc.image = url;
  } else {
    ch.image = url;
  }
  story.updatedAt = new Date().toISOString();
  saveStory(story);
  return story;
}

// ── FICHA DE PERSONAJE ───────────────────────────────────────────────────
// POST /api/images/portrait — genera la ficha de un personaje a partir de una
// ilustración original (data URI) + prompt de aislar personaje, fondo liso.
// body: { storyId, characterId, imageData (data URI), prompt? }
// Guarda la ficha en character.portrait y devuelve { portrait, character }.
router.post('/portrait', async (req, res) => {
  const { storyId, characterId, imageData, prompt } = req.body || {};
  if (!storyId || !characterId) {
    return res.status(400).json({ error: 'Faltan storyId y characterId' });
  }
  if (!imageData || typeof imageData !== 'string' || !imageData.startsWith('data:image')) {
    return res.status(400).json({ error: 'Falta imageData (data URI de la ilustración original)' });
  }

  const char = getCharacter(characterId);
  if (!char) return res.status(404).json({ error: 'Personaje no encontrado' });

  const defaultPrompt = `Aísla al personaje sobre un fondo liso y limpio (color sólido neutro). Retrato de cuerpo entero o medio, centrado. Sin texto, sin logos, sin marcas de agua. Mantén la identidad exacta del personaje: cara, peinado, color de pelo, ojos, ropa y accesorios.`;

  try {
    const url = await flux2Chat({
      storyId,
      images: [imageData],
      prompt: (prompt && prompt.trim()) || defaultPrompt
    });
    char.portrait = url;
    char.updatedAt = new Date().toISOString();
    saveCharacter(char);
    res.json({ portrait: url, character: char });
  } catch (err) {
    console.error('Error generando ficha:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── ESCENA (multi-referencia) ────────────────────────────────────────────
// POST /api/images/scene — genera una imagen de escena usando la ficha del
// personaje como referencia (multi-referencia). Empareja con capítulo/escena.
// body: { storyId, characterId?, chapterId?, sceneId?, prompt?, references?: [dataURI...] }
// Si characterId tiene portrait, se usa como referencia. Se pueden pasar más
// referencias (localización) en `references`.
router.post('/scene', async (req, res) => {
  const { storyId, characterId, chapterId, sceneId, prompt, references } = req.body || {};
  if (!storyId) return res.status(400).json({ error: 'Falta storyId' });
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: 'Falta el prompt' });
  }

  // Referencias: la ficha del personaje + referencias extra (localización)
  const refs = [];
  if (characterId) {
    const char = getCharacter(characterId);
    if (char && char.portrait) {
      const uri = urlToDataUri(char.portrait);
      if (uri) refs.push(uri);
    }
  }
  if (Array.isArray(references)) {
    for (const r of references) {
      if (typeof r === 'string' && r.startsWith('data:image')) refs.push(r);
      else if (typeof r === 'string' && r.startsWith('/stories/')) {
        const uri = urlToDataUri(r);
        if (uri) refs.push(uri);
      }
    }
  }

  try {
    const url = await flux2Chat({ storyId, images: refs, prompt: prompt.trim() });
    let story = null;
    if (chapterId) {
      story = attachImage(storyId, url, { chapterId, sceneId });
    }
    res.json({ image: url, story, references: refs.length });
  } catch (err) {
    console.error('Error generando escena:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── T2I puro (sin referencia) ────────────────────────────────────────────
// POST /api/images/generate — genera imagen(s) con flux2-img (T2I puro).
// body: { prompt, storyId, n?, chapterId?, sceneId? }
// Devuelve { images: [url...] } y, si se indica chapterId/sceneId, las empareja.
router.post('/generate', async (req, res) => {
  const { prompt, storyId, n, chapterId, sceneId } = req.body || {};
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: 'Falta el prompt' });
  }
  if (!storyId) return res.status(400).json({ error: 'Falta storyId' });
  const count = Math.min(Math.max(parseInt(n, 10) || 1, 1), 4);

  try {
    const body = {
      model: 'flux2-img',
      prompt: prompt.trim(),
      n: count,
      size: '768x768'
    };
    const r = await fetch(`${LLM_CONFIG.baseUrl}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LLM_CONFIG.apiKey}`
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(600000)
    });
    if (!r.ok) {
      const errText = await r.text();
      throw new Error(`flux2-img ${r.status}: ${errText.slice(0, 400)}`);
    }
    const data = await r.json();
    const items = data.data || [];
    if (items.length === 0) throw new Error('flux2 no devolvió imágenes');

    const urls = [];
    for (const it of items) {
      if (!it.b64_json) continue;
      const url = saveB64(storyId, it.b64_json);
      urls.push(url);
    }
    if (urls.length === 0) throw new Error('No se pudo guardar ninguna imagen');

    let story = null;
    if (chapterId) {
      story = attachImage(storyId, urls[0], { chapterId, sceneId });
    }
    res.json({ images: urls, story });
  } catch (err) {
    console.error('Error generando imagen:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/images/attach — empareja una imagen (URL ya existente) con una escena/capítulo.
// body: { storyId, url, chapterId, sceneId? }
router.post('/attach', (req, res) => {
  const { storyId, url, chapterId, sceneId } = req.body || {};
  if (!storyId || !url || !chapterId) {
    return res.status(400).json({ error: 'Faltan storyId, url y chapterId' });
  }
  const story = attachImage(storyId, url, { chapterId, sceneId });
  if (!story) return res.status(404).json({ error: 'Capítulo no encontrado' });
  res.json({ story });
});

export default router;
