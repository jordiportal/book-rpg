// Rutas de voces — configuración global de TTS (fish-speech).
// Cada voz tiene: nombre, seiyu (actor/actriz de voz), descripción y un sample
// de audio de referencia (URL o base64). Los personajes referencian una voz por
// su id en el campo `voice`. El TTS usa el sample cuando el servidor lo soporta;
// hoy fish-speech solo soporta 'default', así que se guarda el sample para futuro.
import { Router } from 'express';
import { saveVoice, getVoice, listVoices, deleteVoice } from '../db.js';

const router = Router();

function makeId() {
  return 'voice_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}
function now() { return new Date().toISOString(); }

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
    seiyu: data.seiyu || '',
    description: data.description || '',
    sampleUrl: data.sampleUrl || '',
    sampleBase64: data.sampleBase64 || '',
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
  const allowed = ['name', 'seiyu', 'description', 'sampleUrl', 'sampleBase64'];
  for (const key of allowed) {
    if (data[key] !== undefined) voice[key] = data[key];
  }
  voice.updatedAt = now();
  saveVoice(voice);
  res.json({ voice });
});

// DELETE /api/voices/:id — borrar
router.delete('/:id', (req, res) => {
  const voice = getVoice(req.params.id);
  if (!voice) return res.status(404).json({ error: 'Voz no encontrada' });
  deleteVoice(req.params.id);
  res.json({ ok: true });
});

export default router;
