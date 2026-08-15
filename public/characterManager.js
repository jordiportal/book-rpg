// Gestión de personajes reales desde la API del servidor
// Carga personajes, equipamiento e historia, y los materializa en el mundo 3D

import * as THREE from 'three';

// ===================== ESTADO =====================
let _characters = [];
let _equipment = [];
let _story = null;
let _characterMeshes = []; // meshes 3D de personajes

// ===================== API =====================
export async function loadCharacters(tag = null) {
  const url = tag ? `/api/characters?tag=${encodeURIComponent(tag)}` : '/api/characters';
  const res = await fetch(url);
  const data = await res.json();
  _characters = data.characters || [];
  return _characters;
}

export async function loadEquipment(slot = null) {
  const url = slot ? `/api/equipment?slot=${encodeURIComponent(slot)}` : '/api/equipment';
  const res = await fetch(url);
  const data = await res.json();
  _equipment = data.equipment || [];
  return _equipment;
}

export async function loadStory() {
  const res = await fetch('/api/story');
  const data = await res.json();
  _story = data.story;
  return _story;
}

export function getCharacters() { return _characters; }
export function getEquipment() { return _equipment; }
export function getStory() { return _story; }
export function getCharacterById(id) { return _characters.find(c => c.id === id); }
export function getEquipmentById(id) { return _equipment.find(e => e.id === id); }

// ===================== STATS CON EQUIPAMIENTO =====================
export function getEffectiveStats(character) {
  const base = { ...character.stats };
  const eq = character.equipment || {};
  ['weapon', 'armor', 'accessory'].forEach(slot => {
    const eqId = eq[slot];
    if (eqId) {
      const item = getEquipmentById(eqId);
      if (item && item.stats) {
        Object.keys(item.stats).forEach(stat => {
          base[stat] = (base[stat] || 0) + (item.stats[stat] || 0);
        });
      }
    }
  });
  return base;
}

// ===================== MATERIALIZACIÓN 3D =====================
// Colores por tag/rol
const ROLE_COLORS = {
  companion: 0x8B5CF6,   // violeta
  main: 0xF59E0B,        // ámbar
  npc: 0x6B7280,         // gris
  slave_market: 0xEC4899, // rosa
  player: 0x3B82F6,      // azul
  village: 0x10B981,     // verde
  default: 0xC8A06A
};

function getCharacterColor(character) {
  const tags = character.tags || [];
  for (const tag of tags) {
    if (ROLE_COLORS[tag]) return ROLE_COLORS[tag];
  }
  return ROLE_COLORS.default;
}

// Crea un mesh 3D para un personaje
export function createCharacterMesh(character, opts = {}) {
  const group = new THREE.Group();
  const color = getCharacterColor(character);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });

  // Cuerpo (cilindro)
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 1.4, 8), mat);
  body.position.y = 0.7;
  body.castShadow = true;
  group.add(body);

  // Cabeza (esfera)
  const headMat = new THREE.MeshStandardMaterial({ color: 0xf0c8a0, roughness: 0.6 });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 12), headMat);
  head.position.y = 1.55;
  head.castShadow = true;
  group.add(head);

  // Indicador de nombre (sprite de canvas)
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.roundRect(0, 0, 256, 64, 8);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(character.name, 128, 38);
  const texture = new THREE.CanvasTexture(canvas);
  const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.position.y = 2.4;
  sprite.scale.set(2.5, 0.6, 1);
  group.add(sprite);

  // Posición
  group.position.set(opts.x || 0, 0, opts.z || 0);

  // Metadatos para interacción
  group.userData.interactType = 'npc';
  group.userData.npcName = character.name;
  group.userData.npcRole = character.class || '';
  group.userData.npcDialog = character.description || '';
  group.userData.characterId = character.id;
  group.userData.isRealCharacter = true;

  return group;
}

// Coloca personajes del pueblo en el mundo
export function placeVillageCharacters(scene, villageGroup, interactables, registerFn) {
  // Limpiar anteriores
  _characterMeshes.forEach(m => {
    if (m.parent) m.parent.remove(m);
    const idx = interactables.indexOf(m);
    if (idx > -1) interactables.splice(idx, 1);
  });
  _characterMeshes = [];

  // Posiciones predefinidas para NPCs del pueblo
  const positions = [
    { id: 'viejodelpueblo', x: -3, z: -4 },
    { id: 'comerciante', x: 3, z: -4 },
    { id: 'herrero', x: -3, z: 4 },
    { id: 'mercader_esclavos', x: 3, z: 4 },
    { id: 'roxanne', x: 0, z: 8 }
  ];

  const villageChars = _characters.filter(c => c.tags && c.tags.includes('village'));
  const companionChars = _characters.filter(c => c.tags && c.tags.includes('companion'));
  const allChars = [...villageChars, ...companionChars];

  allChars.forEach(char => {
    const pos = positions.find(p => p.id === char.id) || { x: (Math.random() - 0.5) * 20, z: (Math.random() - 0.5) * 20 };
    const mesh = createCharacterMesh(char, pos);
    villageGroup.add(mesh);
    interactables.push(mesh);
    _characterMeshes.push(mesh);
    if (registerFn) registerFn(mesh, char.name);
  });

  return _characterMeshes;
}

// ===================== HUD / UI =====================
export function buildCharacterPanel(containerId = 'character-panel') {
  let panel = document.getElementById(containerId);
  if (!panel) {
    panel = document.createElement('div');
    panel.id = containerId;
    panel.className = 'panel';
    panel.style.cssText = 'position:absolute;top:80px;right:14px;min-width:220px;max-width:260px;z-index:10;pointer-events:auto;display:none;';
    document.body.appendChild(panel);
  }
  return panel;
}

export function updateCharacterPanel() {
  const panel = buildCharacterPanel();
  const companions = _characters.filter(c => c.tags && c.tags.includes('companion'));
  if (companions.length === 0) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = 'block';

  let html = '<h3 style="font-size:14px;color:#ffd479;margin-bottom:8px;">🧑‍🤝‍🧑 Compañeros</h3>';
  companions.forEach(c => {
    const stats = getEffectiveStats(c);
    html += `<div style="margin-bottom:10px;padding:6px;background:rgba(255,255,255,0.05);border-radius:6px;">`;
    html += `<div style="font-weight:700;font-size:13px;color:#fff;">${c.name}</div>`;
    html += `<div style="font-size:11px;color:#9aa3b2;">${c.race} · ${c.class}</div>`;
    html += `<div style="display:flex;gap:8px;margin-top:4px;font-size:11px;">`;
    html += `<span style="color:#ff6b6b;">HP ${stats.hp}/${stats.maxHp}</span>`;
    html += `<span style="color:#6ba8ff;">MP ${stats.mp}/${stats.maxMp}</span>`;
    html += `<span style="color:#ffd479;">LV ${stats.level}</span>`;
    html += `</div></div>`;
  });
  panel.innerHTML = html;
}

// ===================== INICIALIZACIÓN =====================
export async function initCharacterSystem() {
  await Promise.all([loadCharacters(), loadEquipment(), loadStory()]);
  updateCharacterPanel();
  console.log('✅ Sistema de personajes inicializado:', _characters.length, 'personajes,', _equipment.length, 'items, historia:', !!_story);
}
