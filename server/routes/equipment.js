// Rutas de equipamiento — CRUD
import { Router } from 'express';
import { saveEquipment, getEquipment, listEquipment, deleteEquipment } from '../db.js';

const router = Router();

function makeId() {
  return 'eq_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function now() { return new Date().toISOString(); }

// GET /api/equipment — listar (con filtro opcional por slot)
router.get('/', (req, res) => {
  let items = listEquipment();
  if (req.query.slot) {
    items = items.filter(e => e.slot === req.query.slot);
  }
  res.json({ equipment: items });
});

// POST /api/equipment — crear
router.post('/', (req, res) => {
  const data = req.body || {};
  const item = {
    id: makeId(),
    name: data.name || 'Sin nombre',
    slot: data.slot || 'weapon',
    type: data.type || '',
    rarity: data.rarity || 'common',
    stats: data.stats || { str: 0, vit: 0, agi: 0, dex: 0, int: 0, luck: 0, hp: 0, mp: 0 },
    value: typeof data.value === 'number' ? data.value : 0,
    description: data.description || '',
    model3d: { status: 'none', url: null, imageUrl: null, generatedAt: null },
    createdAt: now(),
    updatedAt: now()
  };
  saveEquipment(item);
  res.status(201).json({ equipment: item });
});

// GET /api/equipment/:id — obtener
router.get('/:id', (req, res) => {
  const item = getEquipment(req.params.id);
  if (!item) return res.status(404).json({ error: 'Equipamiento no encontrado' });
  res.json({ equipment: item });
});

// PUT /api/equipment/:id — actualizar (parcial)
router.put('/:id', (req, res) => {
  const item = getEquipment(req.params.id);
  if (!item) return res.status(404).json({ error: 'Equipamiento no encontrado' });
  const data = req.body || {};
  const allowed = ['name', 'slot', 'type', 'rarity', 'stats', 'value', 'description'];
  for (const key of allowed) {
    if (data[key] !== undefined) item[key] = data[key];
  }
  item.updatedAt = now();
  saveEquipment(item);
  res.json({ equipment: item });
});

// DELETE /api/equipment/:id — borrar
router.delete('/:id', (req, res) => {
  const item = getEquipment(req.params.id);
  if (!item) return res.status(404).json({ error: 'Equipamiento no encontrado' });
  deleteEquipment(req.params.id);
  res.json({ ok: true });
});

export default router;
