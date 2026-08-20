// Rutas de personajes — CRUD + equipamiento + generación 3D
import { Router } from 'express';
import { saveCharacter, getCharacter, listCharacters, deleteCharacter, getEquipment } from '../db.js';
import { getActiveStoryId } from '../session.js';

const router = Router();

function makeId() {
  return 'char_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function now() { return new Date().toISOString(); }

// GET /api/characters — listar (con filtro opcional por tag), solo de la historia activa
router.get('/', (req, res) => {
  const storyId = getActiveStoryId();
  let chars = listCharacters(null, storyId);
  if (req.query.tag) {
    chars = chars.filter(c => Array.isArray(c.tags) && c.tags.includes(req.query.tag));
  }
  res.json({ characters: chars });
});

// POST /api/characters — crear
router.post('/', (req, res) => {
  const data = req.body || {};
  const character = {
    id: makeId(),
    storyId: getActiveStoryId(),
    name: data.name || 'Sin nombre',
    race: data.race || '',
    class: data.class || '',
    description: data.description || '',
    voice: data.voice || '',
    stats: data.stats || { level: 1, hp: 100, maxHp: 100, mp: 50, maxMp: 50, str: 10, vit: 10, agi: 10, dex: 10, int: 10, luck: 10 },
    equipment: { weapon: null, armor: null, accessory: null },
    model3d: { status: 'none', url: null, imageUrl: null, generatedAt: null },
    tags: data.tags || [],
    createdAt: now(),
    updatedAt: now()
  };
  saveCharacter(character);
  res.status(201).json({ character });
});

// GET /api/characters/:id — obtener
router.get('/:id', (req, res) => {
  const char = getCharacter(req.params.id);
  if (!char) return res.status(404).json({ error: 'Personaje no encontrado' });
  res.json({ character: char });
});

// PUT /api/characters/:id — actualizar (parcial)
router.put('/:id', (req, res) => {
  const char = getCharacter(req.params.id);
  if (!char) return res.status(404).json({ error: 'Personaje no encontrado' });
  const data = req.body || {};
  const allowed = ['name', 'race', 'class', 'description', 'voice', 'stats', 'tags'];
  for (const key of allowed) {
    if (data[key] !== undefined) char[key] = data[key];
  }
  char.updatedAt = now();
  saveCharacter(char);
  res.json({ character: char });
});

// DELETE /api/characters/:id — borrar
router.delete('/:id', (req, res) => {
  const char = getCharacter(req.params.id);
  if (!char) return res.status(404).json({ error: 'Personaje no encontrado' });
  deleteCharacter(req.params.id);
  res.json({ ok: true });
});

// POST /api/characters/:id/equip — equipar item
router.post('/:id/equip', (req, res) => {
  const char = getCharacter(req.params.id);
  if (!char) return res.status(404).json({ error: 'Personaje no encontrado' });
  const { slot, equipmentId } = req.body || {};
  if (!slot || !['weapon', 'armor', 'accessory'].includes(slot)) {
    return res.status(400).json({ error: 'Slot inválido (weapon|armor|accessory)' });
  }
  if (equipmentId) {
    const item = getEquipment(equipmentId);
    if (!item) return res.status(404).json({ error: 'Equipamiento no encontrado' });
    if (item.slot !== slot) {
      return res.status(400).json({ error: `El item no encaja en slot ${slot}` });
    }
  }
  char.equipment = char.equipment || {};
  char.equipment[slot] = equipmentId || null;
  char.updatedAt = now();
  saveCharacter(char);
  res.json({ character: char });
});

// POST /api/characters/:id/unequip — desequipar slot
router.post('/:id/unequip', (req, res) => {
  const char = getCharacter(req.params.id);
  if (!char) return res.status(404).json({ error: 'Personaje no encontrado' });
  const { slot } = req.body || {};
  if (!slot || !['weapon', 'armor', 'accessory'].includes(slot)) {
    return res.status(400).json({ error: 'Slot inválido (weapon|armor|accessory)' });
  }
  char.equipment = char.equipment || {};
  char.equipment[slot] = null;
  char.updatedAt = now();
  saveCharacter(char);
  res.json({ character: char });
});

// POST /api/characters/:id/generate3d — generar modelo 3D (placeholder)
router.post('/:id/generate3d', (req, res) => {
  const char = getCharacter(req.params.id);
  if (!char) return res.status(404).json({ error: 'Personaje no encontrado' });
  // Placeholder: marca como pending y devuelve inmediatamente.
  // En fase posterior se orquestará el servicio de generación 3D real.
  char.model3d = {
    status: 'pending',
    url: null,
    imageUrl: null,
    generatedAt: now()
  };
  char.updatedAt = now();
  saveCharacter(char);
  res.json({ character: char });
});

export default router;
