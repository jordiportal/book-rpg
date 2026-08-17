// Rutas de generación y edición de imágenes con flux2 (vía litellm).
// Modelos disponibles en litellm:
//   - flux2-img   → creador de imágenes (POST /v1/images/generations, devuelve b64_json)
//   - flux2-edit  → editor de imágenes (POST /v1/images/edits, multipart: image + prompt)
// Las imágenes generadas se guardan en public/stories/<storyId>/generated/ y se
// sirven estáticamente. El GM las empareja manualmente con capítulos/escenas.
import { Router } from 'express';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { LLM_CONFIG } from '../llm.js';
import { getStory, saveStory } from '../db.js';

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

// POST /api/images/generate — genera imagen(s) con flux2-img.
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
      body: JSON.stringify(body)
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

    // Emparejado manual: si se indica capítulo/escena, asignar la primera
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

// POST /api/images/edit — edita una imagen existente con flux2-edit.
// body: { prompt, imageUrl, storyId, chapterId?, sceneId? }
// imageUrl debe ser una URL servida por /stories/... (ruta local).
router.post('/edit', async (req, res) => {
  const { prompt, imageUrl, storyId, chapterId, sceneId } = req.body || {};
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: 'Falta el prompt' });
  }
  if (!imageUrl || !storyId) {
    return res.status(400).json({ error: 'Faltan imageUrl y storyId' });
  }

  // Resolver la ruta local del archivo (imageUrl es /stories/...)
  const rel = imageUrl.replace(/^\/stories\//, '');
  const filePath = join(STORIES_IMG_DIR, rel);
  if (!existsSync(filePath)) {
    return res.status(404).json({ error: 'Imagen de origen no encontrada' });
  }

  try {
    // flux2-edit espera multipart: image (archivo) + prompt + model
    const form = new FormData();
    form.append('model', 'flux2-edit');
    form.append('prompt', prompt.trim());
    form.append('image', new Blob([readFileSync(filePath)], { type: 'image/png' }), 'edit.png');

    const r = await fetch(`${LLM_CONFIG.baseUrl}/images/edits`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${LLM_CONFIG.apiKey}` },
      body: form
    });
    if (!r.ok) {
      const errText = await r.text();
      throw new Error(`flux2-edit ${r.status}: ${errText.slice(0, 400)}`);
    }
    const data = await r.json();
    const item = (data.data || [])[0];
    if (!item || !item.b64_json) throw new Error('flux2-edit no devolvió imagen');

    const url = saveB64(storyId, item.b64_json);
    let story = null;
    if (chapterId) {
      story = attachImage(storyId, url, { chapterId, sceneId });
    }
    res.json({ image: url, story });
  } catch (err) {
    console.error('Error editando imagen:', err.message);
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
