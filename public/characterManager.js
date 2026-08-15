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
export function buildCharacterPanel(containerId = 'character-panel', position = null) {
  let panel = document.getElementById(containerId);
  if (!panel) {
    panel = document.createElement('div');
    panel.id = containerId;
    panel.className = 'panel';
    const pos = position || 'position:absolute;top:80px;right:14px;min-width:220px;max-width:260px;z-index:10;pointer-events:auto;display:none;';
    panel.style.cssText = pos;
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
    html += `<div data-open-char="${c.id}" style="margin-bottom:10px;padding:6px;background:rgba(255,255,255,0.05);border-radius:6px;cursor:pointer;transition:background 0.2s;" title="Ver equipamiento">`;
    html += `<div style="font-weight:700;font-size:13px;color:#fff;">${c.name}</div>`;
    html += `<div style="font-size:11px;color:#9aa3b2;">${c.race} · ${c.class}</div>`;
    html += `<div style="display:flex;gap:8px;margin-top:4px;font-size:11px;">`;
    html += `<span style="color:#ff6b6b;">HP ${stats.hp}/${stats.maxHp}</span>`;
    html += `<span style="color:#6ba8ff;">MP ${stats.mp}/${stats.maxMp}</span>`;
    html += `<span style="color:#ffd479;">LV ${stats.level}</span>`;
    html += `</div></div>`;
  });
  panel.innerHTML = html;

  // Hacer clicable cada compañero para abrir su detalle de equipamiento
  panel.querySelectorAll('[data-open-char]').forEach(el => {
    el.addEventListener('click', () => {
      const char = getCharacterById(el.dataset.openChar);
      if (char) {
        // El callback global (si existe) abre el detalle con el inventario del jugador
        if (typeof window.__openCharacterDetail === 'function') {
          window.__openCharacterDetail(char);
        }
      }
    });
  });
}

// ===================== EQUIPAR / DESEQUIPAR =====================
// Equipa un item a un personaje vía la API y refresca el estado local.
export async function equipCharacterItem(characterId, slot, equipmentId) {
  const res = await fetch(`/api/characters/${encodeURIComponent(characterId)}/equip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slot, equipmentId })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  const idx = _characters.findIndex(c => c.id === characterId);
  if (idx > -1) _characters[idx] = data.character;
  return data.character;
}

// Desequipa un slot de un personaje vía la API y refresca el estado local.
export async function unequipCharacterItem(characterId, slot) {
  const res = await fetch(`/api/characters/${encodeURIComponent(characterId)}/unequip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slot })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  const idx = _characters.findIndex(c => c.id === characterId);
  if (idx > -1) _characters[idx] = data.character;
  return data.character;
}

// Icono y etiqueta para cada slot
const SLOT_LABELS = {
  weapon: { icon: '⚔️', label: 'Arma' },
  armor: { icon: '🛡️', label: 'Armadura' },
  accessory: { icon: '💍', label: 'Accesorio' }
};

// Devuelve el item equipado en un slot (o null)
function getEquippedItem(character, slot) {
  const eqId = character.equipment && character.equipment[slot];
  if (!eqId) return null;
  return getEquipmentById(eqId) || null;
}

// Renderiza el panel de detalle de un personaje con su equipamiento
// y la posibilidad de equipar/desequipar items del inventario del jugador.
export function renderCharacterDetail(character, playerInventory = []) {
  const panel = buildCharacterPanel('character-detail-panel', 'position:absolute;bottom:90px;right:14px;min-width:240px;max-width:280px;z-index:20;pointer-events:auto;display:none;');
  panel.style.display = 'block';
  const stats = getEffectiveStats(character);

  let html = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">`;
  html += `<h3 style="font-size:14px;color:#ffd479;margin:0;">${character.name}</h3>`;
  html += `<button id="char-detail-close" style="background:none;border:none;color:#9aa3b2;font-size:16px;cursor:pointer;">✕</button>`;
  html += `</div>`;
  html += `<div style="font-size:11px;color:#9aa3b2;margin-bottom:8px;">${character.race || ''} · ${character.class || ''} · LV${stats.level || 1}</div>`;

  // Stats efectivas
  html += `<div style="font-size:11px;color:#c8cdd6;margin-bottom:8px;">`;
  html += `<span style="color:#ff6b6b;">♥ ${stats.hp||0}/${stats.maxHp||0}</span> `;
  html += `<span style="color:#6ba8ff;">✦ ${stats.mp||0}/${stats.maxMp||0}</span><br>`;
  html += `Fuerza ${stats.str||0} · Vit ${stats.vit||0} · Agi ${stats.agi||0}<br>`;
  html += `Dex ${stats.dex||0} · Int ${stats.int||0} · Suerte ${stats.luck||0}`;
  html += `</div>`;

  // Equipamiento actual
  html += `<div style="font-size:12px;color:#ffd479;margin-bottom:4px;">🎒 Equipamiento</div>`;
  ['weapon', 'armor', 'accessory'].forEach(slot => {
    const s = SLOT_LABELS[slot];
    const item = getEquippedItem(character, slot);
    html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;font-size:11px;">`;
    html += `<span style="color:#9aa3b2;">${s.icon} ${s.label}:</span>`;
    if (item) {
      html += `<span style="color:#e8e6e3;">${item.name} <button data-unequip="${slot}" style="margin-left:4px;background:rgba(255,255,255,0.1);border:none;color:#ff8a5c;border-radius:4px;padding:1px 6px;cursor:pointer;font-size:10px;">quitar</button></span>`;
    } else {
      html += `<span style="color:#6b7280;">—</span>`;
    }
    html += `</div>`;
  });

  // Inventario del jugador (items equipables)
  const equipable = playerInventory.filter(i => typeof i === 'object' && i.id);
  if (equipable.length > 0) {
    html += `<div style="font-size:12px;color:#ffd479;margin:8px 0 4px;">📦 Inventario (equipar)</div>`;
    equipable.forEach(item => {
      const slot = item.slot || 'weapon';
      const s = SLOT_LABELS[slot] || { icon: '📦', label: slot };
      html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;font-size:11px;">`;
      html += `<span style="color:#c8cdd6;">${s.icon} ${item.name} <span style="color:#6b7280;">(${item.rarity||''})</span></span>`;
      html += `<button data-equip="${slot}" data-item="${item.id}" style="background:rgba(255,255,255,0.1);border:none;color:#7ee0a0;border-radius:4px;padding:1px 8px;cursor:pointer;font-size:10px;">equipar</button>`;
      html += `</div>`;
    });
  } else {
    html += `<div style="font-size:11px;color:#6b7280;margin-top:6px;">No hay items equipables en tu inventario.</div>`;
  }

  panel.innerHTML = html;

  // Eventos
  panel.querySelector('#char-detail-close').addEventListener('click', () => {
    panel.style.display = 'none';
  });
  panel.querySelectorAll('[data-unequip]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await unequipCharacterItem(character.id, btn.dataset.unequip);
        renderCharacterDetail(getCharacterById(character.id), playerInventory);
        updateCharacterPanel();
      } catch (err) {
        console.error('Error desequipando:', err.message);
      }
    });
  });
  panel.querySelectorAll('[data-equip]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await equipCharacterItem(character.id, btn.dataset.equip, btn.dataset.item);
        renderCharacterDetail(getCharacterById(character.id), playerInventory);
        updateCharacterPanel();
      } catch (err) {
        console.error('Error equipando:', err.message);
      }
    });
  });
}

// ===================== INICIALIZACIÓN =====================
export async function initCharacterSystem() {
  await Promise.all([loadCharacters(), loadEquipment(), loadStory()]);
  updateCharacterPanel();
  console.log('✅ Sistema de personajes inicializado:', _characters.length, 'personajes,', _equipment.length, 'items, historia:', !!_story);
}
