// Rutas de voces — configuración global de TTS (fish-speech).
// Cada voz tiene: nombre, seiyu (actor/actriz de voz), descripción y un sample
// de audio de referencia (URL o base64). Los personajes referencian una voz por
// su id en el campo `voice`.
//
// Fish-speech soporta clonación de voz: se registra un sample (WAV) por multipart
// en /v1/audio/voices con un slug ASCII (name), y luego se sintetiza con
// `voice: <slug>`. Este módulo expone el registro y listado de voces en Fish.
import { Router } from 'express';
import { saveVoice, getVoice, listVoices, deleteVoice } from '../db.js';
import { LLM_CONFIG } from '../llm.js';

const router = Router();

function makeId() {
  return 'voice_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}
function now() { return new Date().toISOString(); }

// Convierte un nombre a slug ASCII válido para Fish (solo [a-z0-9-_])
function toSlug(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quitar acentos
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'voz';
}

// Baja el sample de audio de una voz (desde URL o base64) y devuelve un Buffer.
async function fetchSample(voice) {
  if (voice.sampleBase64) {
    // Formato: data:audio/wav;base64,XXXX o base64 puro
    const b64 = voice.sampleBase64.includes(',')
      ? voice.sampleBase64.split(',')[1]
      : voice.sampleBase64;
    return Buffer.from(b64, 'base64');
  }
  if (voice.sampleUrl) {
    const res = await fetch(voice.sampleUrl);
    if (!res.ok) throw new Error(`No se pudo bajar el sample (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }
  throw new Error('La voz no tiene sample (URL o base64)');
}

// GET /api/voices — listar todas las voces configuradas
router.get('/', (req, res) => {
  res.json({ voices: listVoices() });
});

// POST /api/voices — crear una voz
router.post('/', (req, res) => {
  const data = req.body || {};
  if (!data.name || !data.name.trim()) {
    return res.status(400).json({ error: 'El nombre de la voz es obligatorio' });
  }
  const voice = {
    id: makeId(),
    name: data.name.trim(),
    slug: data.slug || toSlug(data.name),
    seiyu: data.seiyu || '',
    description: data.description || '',
    sampleUrl: data.sampleUrl || '',
    sampleBase64: data.sampleBase64 || '',
    refText: data.refText || '',
    consent: data.consent || '',
    registered: false,
    fishName: null,
    createdAt: now(),
    updatedAt: now()
  };
  saveVoice(voice);
  res.status(201).json({ voice });
});

// GET /api/voices/:id — obtener una voz
router.get('/:id', (req, res) => {
  const voice = getVoice(req.params.id);
  if (!voice) return res.status(404).json({ error: 'Voz no encontrada' });
  res.json({ voice });
});

// PUT /api/voices/:id — actualizar
router.put('/:id', (req, res) => {
  const voice = getVoice(req.params.id);
  if (!voice) return res.status(404).json({ error: 'Voz no encontrada' });
  const data = req.body || {};
  const allowed = ['name', 'seiyu', 'description', 'sampleUrl', 'sampleBase64', 'refText', 'consent', 'slug'];
  for (const key of allowed) {
    if (data[key] !== undefined) voice[key] = data[key];
  }
  if (data.name !== undefined && data.name !== voice.name) {
    voice.slug = toSlug(data.name);
    voice.registered = false;
    voice.fishName = null;
  }
  voice.updatedAt = now();
  saveVoice(voice);
  res.json({ voice });
});

// POST /api/voices/:id/register — registra la voz en Fish (clonación de voz).
// Baja el sample (URL o base64) y lo sube por multipart a /v1/audio/voices.
router.post('/:id/register', async (req, res) => {
  const voice = getVoice(req.params.id);
  if (!voice) return res.status(404).json({ error: 'Voz no encontrada' });
  try {
    const sampleBuffer = await fetchSample(voice);
    const slug = voice.slug || toSlug(voice.name);
    const refText = voice.refText || 'Muestra de voz para clonación.';
    const consent = voice.consent || 'muestra sintetica generada por el propio modelo, sin persona real';
    const speakerDescription = voice.description || voice.seiyu || 'Voz configurada';

    // Subir por multipart a Fish
    const form = new FormData();
    form.append('name', slug);
    form.append('audio_sample', new Blob([sampleBuffer], { type: 'audio/wav' }), `${slug}.wav`);
    form.append('ref_text', refText);
    form.append('consent', consent);
    form.append('speaker_description', speakerDescription);

    const resFish = await fetch(`${LLM_CONFIG.baseUrl}/audio/voices`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${LLM_CONFIG.apiKey}` },
      body: form
    });
    if (!resFish.ok) {
      const errText = await resFish.text();
      throw new Error(`Fish register ${resFish.status}: ${errText.slice(0, 300)}`);
    }

    voice.registered = true;
    voice.fishName = slug;
    voice.updatedAt = now();
    saveVoice(voice);
    res.json({ ok: true, voice });
  } catch (err) {
    console.error('Error registrando voz en Fish:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/voices/:id/register — borra la voz de Fish (si estaba registrada)
router.delete('/:id/register', async (req, res) => {
  const voice = getVoice(req.params.id);
  if (!voice) return res.status(404).json({ error: 'Voz no encontrada' });
  try {
    const slug = voice.fishName || voice.slug;
    if (slug) {
      const resFish = await fetch(`${LLM_CONFIG.baseUrl}/audio/voices/${slug}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${LLM_CONFIG.apiKey}` }
      });
      if (!resFish.ok && resFish.status !== 404) {
        const errText = await resFish.text();
        throw new Error(`Fish delete ${resFish.status}: ${errText.slice(0, 300)}`);
      }
    }
    voice.registered = false;
    voice.fishName = null;
    voice.updatedAt = now();
    saveVoice(voice);
    res.json({ ok: true, voice });
  } catch (err) {
    console.error('Error borrando voz de Fish:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/voices/:id — borrar (también de Fish si estaba registrada)
router.delete('/:id', async (req, res) => {
  const voice = getVoice(req.params.id);
  if (!voice) return res.status(404).json({ error: 'Voz no encontrada' });
  try {
    const slug = voice.fishName || voice.slug;
    if (slug && voice.registered) {
      await fetch(`${LLM_CONFIG.baseUrl}/audio/voices/${slug}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${LLM_CONFIG.apiKey}` }
      }).catch(() => {});
    }
  } catch (e) { /* no bloquear el borrado local */ }
  deleteVoice(req.params.id);
  res.json({ ok: true });
});

export default router;
