// Materializador de zonas: convierte el JSON de una zona (generado por el LLM)
// en un grupo 3D con plantillas procedurales. Devuelve también las entidades
// interactuables para que main.js las registre en su sistema de interacción.
import * as THREE from 'three';

// Crea un NPC (aldeano) con plantilla visual
function makeNPC(npc) {
  const group = new THREE.Group();
  const color = new THREE.Color(npc.color || '#c8a06a');
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
  const b = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 1.4, 8), mat);
  b.position.y = 0.7;
  b.castShadow = true;
  group.add(b);
  const h = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 12), new THREE.MeshStandardMaterial({ color: 0xf0c8a0 }));
  h.position.y = 1.55;
  h.castShadow = true;
  group.add(h);
  group.position.set(npc.x || 0, 0, npc.z || 0);
  // Metadatos para interacción
  group.userData.interactType = 'npc';
  group.userData.npcName = npc.name;
  group.userData.npcRole = npc.role || '';
  group.userData.npcDialog = npc.dialog || '';
  group.userData.zoneNpc = npc;
  return group;
}

// Crea un enemigo (monstruo) con plantilla visual
function makeEnemy(enemy) {
  const group = new THREE.Group();
  const color = new THREE.Color(enemy.color || '#5a2a6a');
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, emissive: color.clone().multiplyScalar(0.2), emissiveIntensity: 0.3 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 10), mat);
  body.position.y = 0.5;
  body.scale.y = 0.8;
  body.castShadow = true;
  group.add(body);
  // Orejas (estilo conejo monstruo)
  const earMat = new THREE.MeshStandardMaterial({ color: color.clone().lighten ? color : color });
  const ear1 = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.6, 8), earMat);
  ear1.position.set(-0.2, 1.2, 0);
  group.add(ear1);
  const ear2 = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.6, 8), earMat);
  ear2.position.set(0.2, 1.2, 0);
  group.add(ear2);
  group.position.set(enemy.x || 0, 0, enemy.z || 0);
  group.userData.interactType = 'monster';
  group.userData.monsterName = enemy.name;
  group.userData.monsterLevel = enemy.level || 1;
  group.userData.monsterHp = enemy.hp || 20;
  group.userData.zoneEnemy = enemy;
  return group;
}

// Crea un objeto recogible (item) con plantilla visual
function makeItem(item) {
  const group = new THREE.Group();
  const color = new THREE.Color(item.type === 'heal' ? '#ff6b6b' : item.type === 'key' ? '#ffd479' : '#6ba8ff');
  const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4, roughness: 0.3 });
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.35, 0), mat);
  gem.position.y = 0.6;
  gem.castShadow = true;
  group.add(gem);
  // Halo brillante
  const halo = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 8), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.15 }));
  halo.position.y = 0.6;
  group.add(halo);
  group.position.set(item.x || 0, 0, item.z || 0);
  group.userData.interactType = 'item';
  group.userData.itemName = item.name;
  group.userData.itemType = item.type || 'treasure';
  group.userData.itemValue = item.value || 0;
  group.userData.zoneItem = item;
  return group;
}

// Crea un portal de salida
function makeExit(exit) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x0a0a14, emissive: 0x2a6a4a, emissiveIntensity: 0.6 });
  const portal = new THREE.Mesh(new THREE.PlaneGeometry(4, 5), mat);
  portal.position.y = 2.5;
  group.add(portal);
  // Marco
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x6a6a6a, roughness: 0.9 });
  const p1 = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 5, 8), frameMat);
  p1.position.set(-2, 2.5, 0);
  group.add(p1);
  const p2 = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 5, 8), frameMat);
  p2.position.set(2, 2.5, 0);
  group.add(p2);
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(5, 0.8, 0.8), frameMat);
  lintel.position.set(0, 5, 0);
  group.add(lintel);
  // Posición según dirección
  const dir = exit.direction || 'south';
  const half = 18;
  if (dir === 'north') group.position.set(0, 0, -half);
  else if (dir === 'south') group.position.set(0, 0, half);
  else if (dir === 'east') group.position.set(half, 0, 0);
  else group.position.set(-half, 0, 0);
  group.userData.interactType = 'exit';
  group.userData.exitTarget = exit.target;
  group.userData.exitLabel = exit.label || 'Salida';
  group.userData.zoneExit = exit;
  return group;
}

// Materializa una zona completa en un grupo 3D.
// Devuelve { group, interactables, monsters, npcs, items, exits }
export function renderZone(zone) {
  const group = new THREE.Group();
  const interactables = [];
  const monsters = [];
  const npcs = [];
  const items = [];
  const exits = [];

  const L = zone.layout || {};
  const width = L.width || 40;
  const depth = L.depth || 40;

  // Suelo
  const floorGeo = new THREE.PlaneGeometry(width, depth);
  const floorMat = new THREE.MeshStandardMaterial({ color: L.floorColor || '#3a3a42', roughness: 1 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  // Paredes perimetrales (si theme es cerrado: dungeon/cave)
  const closed = ['dungeon', 'cave'].includes(zone.theme);
  if (closed) {
    const wallMat = new THREE.MeshStandardMaterial({ color: L.wallColor || '#4a4a55', roughness: 0.9 });
    const wallH = 4;
    const hw = width / 2, hd = depth / 2;
    const walls = [
      [0, -hd, width, 1], [0, hd, width, 1],
      [-hw, 0, 1, depth], [hw, 0, 1, depth]
    ];
    walls.forEach(([x, z, w, d]) => {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), wallMat);
      wall.position.set(x, wallH / 2, z);
      wall.castShadow = true;
      wall.receiveShadow = true;
      group.add(wall);
    });
  }

  // NPCs
  (zone.npcs || []).forEach(npc => {
    const g = makeNPC(npc);
    group.add(g);
    npcs.push(g);
    interactables.push(g);
  });

  // Enemigos (count copias)
  (zone.enemies || []).forEach(enemy => {
    const count = enemy.count || 1;
    for (let i = 0; i < count; i++) {
      const g = makeEnemy(enemy);
      // Desplazar ligeramente cada copia para no apilarlas
      if (count > 1) {
        const off = (i - (count - 1) / 2) * 1.6;
        g.position.x += (i % 2 === 0 ? off : -off * 0.5);
        g.position.z += (i % 2 === 0 ? -off * 0.5 : off);
      }
      group.add(g);
      monsters.push(g);
      interactables.push(g);
    }
  });

  // Items
  (zone.items || []).forEach(item => {
    const g = makeItem(item);
    group.add(g);
    items.push(g);
    interactables.push(g);
  });

  // Exits
  (zone.exits || []).forEach(exit => {
    const g = makeExit(exit);
    group.add(g);
    exits.push(g);
    interactables.push(g);
  });

  // Garantizar salida al pueblo en zonas cerradas (dungeon/cave) si no la tienen
  const hasVillageExit = (zone.exits || []).some(e =>
    ['village', 'pueblo', '最初の村'].includes(e.target));
  if (closed && !hasVillageExit) {
    const g = makeExit({ direction: 'south', target: 'village', label: 'Volver al pueblo' });
    group.add(g);
    exits.push(g);
    interactables.push(g);
  }

  return { group, interactables, monsters, npcs, items, exits };
}
