import * as THREE from 'three';
import { renderZone } from './zoneRenderer.js';
import { initCharacterSystem, placeVillageCharacters, updateCharacterPanel, getEffectiveStats, getCharacterById, getCharacters, renderCharacterDetail, getEquipment } from './characterManager.js';

// ============ ESCENA 3D ============
const container = document.getElementById('scene-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 60, 140);

// Cámara en tercera persona que sigue al jugador
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);
camera.position.set(0, 18, 22);
camera.lookAt(0, 0, 0);

// Si WebGL no está disponible (entornos sin GPU), el juego sigue en modo texto
let webglOK = true;
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
} catch (e) {
  webglOK = false;
  console.warn('WebGL no disponible, modo texto:', e.message);
  container.innerHTML = '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at center,#1a2030,#0b0e14);color:#9aa3b2;font-size:14px;text-align:center;padding:20px;">🌄 Modo texto (WebGL no disponible en este dispositivo).<br>El mundo 3D se mostrará en un navegador con aceleración gráfica.</div>';
  // En modo texto no hay canvas: ocultar el intro automáticamente para que se pueda jugar
  const introEl = document.getElementById('intro');
  if (introEl) introEl.classList.add('hidden');
}

// Parámetros de cámara en tercera persona
const camOffset = new THREE.Vector3(0, 7, 12); // detrás y arriba del jugador
const camTarget = new THREE.Vector3(0, 1.5, 0);
let camYaw = 0; // rotación horizontal de la cámara alrededor del jugador

// Rotar cámara con Q/E o flechas izquierda/derecha (mantener WASD para mover)
function updateCamera() {
  // Posición deseada de la cámara relativa al jugador
  const offset = new THREE.Vector3(
    Math.sin(camYaw) * camOffset.z,
    camOffset.y,
    Math.cos(camOffset.z) * 0 + Math.cos(camYaw) * camOffset.z
  );
  // Corregir: cámara orbita en XZ
  offset.set(
    Math.sin(camYaw) * camOffset.z,
    camOffset.y,
    Math.cos(camYaw) * camOffset.z
  );
  camera.position.copy(player.position).add(offset);
  // Mirar al jugador
  camTarget.copy(player.position).add(new THREE.Vector3(0, 1.5, 0));
  camera.lookAt(camTarget);
}

// Luces
const ambient = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambient);
const sun = new THREE.DirectionalLight(0xfff5e0, 1.2);
sun.position.set(30, 40, 20);
sun.castShadow = true;
sun.shadow.mapSize.width = 2048;
sun.shadow.mapSize.height = 2048;
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 100;
sun.shadow.camera.left = -40;
sun.shadow.camera.right = 40;
sun.shadow.camera.top = 40;
sun.shadow.camera.bottom = -40;
scene.add(sun);

// ============ ZONAS / MAPAS ============
// El mundo se divide en zonas. Cada zona es un grupo que se muestra/oculta.
const villageGroup = new THREE.Group();   // el pueblo (zona exterior)
scene.add(villageGroup);
const labyrinthInterior = new THREE.Group(); // interior del laberinto (no visible hasta entrar)
let currentZone = 'village'; // 'village' | 'labyrinth'

function isVisibleInScene(obj) {
  // Un objeto es "visible" solo si él y todos sus ancestros lo son
  let o = obj;
  while (o) {
    if (o.visible === false) return false;
    o = o.parent;
  }
  return true;
}

// ============ TERRENO ============
function createGround() {
  const geo = new THREE.PlaneGeometry(200, 200);
  const mat = new THREE.MeshStandardMaterial({ color: 0x6da552, roughness: 1 });
  const ground = new THREE.Mesh(geo, mat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  villageGroup.add(ground);

  // Camino de tierra
  const roadGeo = new THREE.PlaneGeometry(6, 200);
  const roadMat = new THREE.MeshStandardMaterial({ color: 0xb8a37a, roughness: 1 });
  const road = new THREE.Mesh(roadGeo, roadMat);
  road.rotation.x = -Math.PI / 2;
  road.position.y = 0.01;
  road.receiveShadow = true;
  villageGroup.add(road);
}

// ============ EDIFICIOS ============
function createHouse(x, z, opts = {}) {
  const group = new THREE.Group();
  const w = opts.w || 6;
  const h = opts.h || 4;
  const d = opts.d || 5;
  const color = opts.color || 0xc8a06a;

  // Cuerpo
  const bodyGeo = new THREE.BoxGeometry(w, h, d);
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = h / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // Techo
  const roofGeo = new THREE.ConeGeometry(Math.max(w, d) * 0.75, h * 0.7, 4);
  const roofMat = new THREE.MeshStandardMaterial({ color: opts.roof || 0x8a4a2b, roughness: 0.8 });
  const roof = new THREE.Mesh(roofGeo, roofMat);
  roof.position.y = h + h * 0.35;
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;
  group.add(roof);

  // Puerta
  const doorGeo = new THREE.PlaneGeometry(1.2, 2);
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x5a3a1a });
  const door = new THREE.Mesh(doorGeo, doorMat);
  door.position.set(0, 1, d / 2 + 0.01);
  group.add(door);

  group.position.set(x, 0, z);
  villageGroup.add(group);
  return group;
}
function createTree(x, z) {
  const group = new THREE.Group();
  const trunkGeo = new THREE.CylinderGeometry(0.3, 0.4, 2.5);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2b });
  const trunk = new THREE.Mesh(trunkGeo, trunkMat);
  trunk.position.y = 1.25;
  trunk.castShadow = true;
  group.add(trunk);

  const leafGeo = new THREE.SphereGeometry(1.5, 8, 8);
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x3a7a3a });
  const leaf = new THREE.Mesh(leafGeo, leafMat);
  leaf.position.y = 3.5;
  leaf.castShadow = true;
  group.add(leaf);

  group.position.set(x, 0, z);
  villageGroup.add(group);
}

// ============ PERSONAJE (jugador) ============
const player = new THREE.Group();
// Cuerpo
const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3a6ea5, roughness: 0.7 });
const body = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 1.6, 8), bodyMat);
body.position.y = 0.8;
body.castShadow = true;
player.add(body);
// Cabeza
const headMat = new THREE.MeshStandardMaterial({ color: 0xf0c8a0, roughness: 0.6 });
const head = new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 16), headMat);
head.position.y = 1.75;
head.castShadow = true;
player.add(head);
// Pelo
const hairMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a });
const hair = new THREE.Mesh(new THREE.SphereGeometry(0.36, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2), hairMat);
hair.position.y = 1.85;
player.add(hair);
player.position.set(0, 0, 0);
scene.add(player);

// ============ NPCs (aldeanos) ============
const npcs = [];
function createNPC(x, z, color = 0xc8a06a) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
  const b = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 1.4, 8), mat);
  b.position.y = 0.7;
  b.castShadow = true;
  group.add(b);
  const h = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 12), new THREE.MeshStandardMaterial({ color: 0xf0c8a0 }));
  h.position.y = 1.55;
  h.castShadow = true;
  group.add(h);
  group.position.set(x, 0, z);
  villageGroup.add(group);
  npcs.push(group);
  return group;
}

// ============ MONSTRUOS (conejos) ============
const monsters = [];
function createMonster(x, z, parent) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.6 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 10), mat);
  body.position.y = 0.5;
  body.scale.y = 0.8;
  body.castShadow = true;
  group.add(body);
  // Orejas
  const earMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const ear1 = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.6, 8), earMat);
  ear1.position.set(-0.2, 1.2, 0);
  group.add(ear1);
  const ear2 = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.6, 8), earMat);
  ear2.position.set(0.2, 1.2, 0);
  group.add(ear2);
  group.position.set(x, 0, z);
  (parent || villageGroup).add(group);
  monsters.push(group);
  return group;
}

// ============ LABERINTO (迷宮) ============
const labyrinth = new THREE.Group();
let labyrinthPortal = null;
function createLabyrinth() {
  // Portal: arco de piedra con interior oscuro
  const archMat = new THREE.MeshStandardMaterial({ color: 0x6a6a6a, roughness: 0.9 });
  const pillar1 = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1, 6, 8), archMat);
  pillar1.position.set(-2.5, 3, 0);
  pillar1.castShadow = true;
  labyrinth.add(pillar1);
  const pillar2 = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1, 6, 8), archMat);
  pillar2.position.set(2.5, 3, 0);
  pillar2.castShadow = true;
  labyrinth.add(pillar2);
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(7, 1.2, 1.5), archMat);
  lintel.position.set(0, 6.4, 0);
  lintel.castShadow = true;
  labyrinth.add(lintel);
  // Portal oscuro (entrada)
  const portalMat = new THREE.MeshStandardMaterial({ color: 0x0a0a14, emissive: 0x2a0a4a, emissiveIntensity: 0.6 });
  const portal = new THREE.Mesh(new THREE.PlaneGeometry(5, 6), portalMat);
  portal.position.set(0, 3, 0.1);
  labyrinth.add(portal);

  // Monstruos del laberinto (más fuertes, color oscuro)
  const labMonsters = [];
  for (let i = 0; i < 6; i++) {
    const g = createMonster(0, 0);
    g.traverse((c) => {
      if (c.isMesh) c.material = new THREE.MeshStandardMaterial({ color: 0x5a2a6a, roughness: 0.5, emissive: 0x1a0a2a, emissiveIntensity: 0.3 });
    });
    g.position.set((i % 3) * 4 - 4, 0, Math.floor(i / 3) * 4 - 2);
    g.userData.isLabyrinth = true;
    registerInteractive(g, 'モンスター');
    labyrinth.add(g);
    labMonsters.push(g);
  }

  labyrinth.position.set(0, 0, -45); // al norte, lejos del pueblo
  villageGroup.add(labyrinth);
  labyrinthPortal = portal;
  // Portal interactuable por proximidad
  portal.userData.interactType = 'portal';
  portal.userData.interactiveName = 'Portal del laberinto';
  interactables.push(portal);
  return { portal, labMonsters };
}

// ============ INTERIOR DEL LABERINTO ============
// Se construye una vez y se muestra/oculta al entrar/salir.
const labExitPortal = new THREE.Group();
let labWalls = [];
let labInteriorMonsters = [];
function createLabyrinthInterior() {
  // Suelo de piedra
  const floorGeo = new THREE.PlaneGeometry(60, 60);
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x3a3a42, roughness: 1 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  labyrinthInterior.add(floor);

  // Paredes exteriores
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x4a4a55, roughness: 0.9 });
  const wallH = 4;
  function addWall(x, z, w, d) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), wallMat);
    wall.position.set(x, wallH / 2, z);
    wall.castShadow = true;
    wall.receiveShadow = true;
    labyrinthInterior.add(wall);
    labWalls.push(wall);
  }
  // Perímetro 60x60
  addWall(0, -30, 60, 1);
  addWall(0, 30, 60, 1);
  addWall(-30, 0, 1, 60);
  addWall(30, 0, 1, 60);

  // Paredes internas (laberinto simple)
  const walls = [
    [-10, -20, 20, 1], [10, -10, 20, 1], [-15, 0, 20, 1],
    [15, 10, 20, 1], [-10, 20, 20, 1], [0, -5, 1, 20],
    [20, -15, 1, 20], [-20, 5, 1, 20], [5, 15, 1, 20],
    [-5, -25, 1, 10], [25, 25, 1, 10], [-25, -25, 1, 10]
  ];
  walls.forEach(([x, z, w, d]) => addWall(x, z, w, d));

  // Portal de salida (al sur, junto a la entrada)
  const exitMat = new THREE.MeshStandardMaterial({ color: 0x0a0a14, emissive: 0x2a6a4a, emissiveIntensity: 0.6 });
  const exitPortal = new THREE.Mesh(new THREE.PlaneGeometry(5, 6), exitMat);
  exitPortal.position.set(0, 3, 28.5);
  labyrinthInterior.add(exitPortal);
  exitPortal.userData.interactType = 'exit';
  exitPortal.userData.interactiveName = 'Salida del laberinto';
  interactables.push(exitPortal);
  labExitPortal.add(exitPortal);

  // Monstruos del interior (oscuras)
  const labMat = new THREE.MeshStandardMaterial({ color: 0x5a2a6a, roughness: 0.5, emissive: 0x1a0a2a, emissiveIntensity: 0.3 });
  for (let i = 0; i < 8; i++) {
    const g = createMonster(0, 0, labyrinthInterior);
    g.traverse((c) => { if (c.isMesh) c.material = labMat; });
    g.position.set((i % 4) * 6 - 9, 0, Math.floor(i / 4) * 6 - 8);
    g.userData.isLabyrinth = true;
    g.userData.interactType = 'monster';
    registerInteractive(g, 'モンスター');
    labyrinthInterior.add(g);
    labInteriorMonsters.push(g);
  }

  labyrinthInterior.visible = false;
  scene.add(labyrinthInterior);
}

// Cambiar de zona: muestra/oculta los grupos y reubica al jugador
function switchZone(zone) {
  if (zone === currentZone) return;
  currentZone = zone;
  if (zone === 'labyrinth') {
    villageGroup.visible = false;
    labyrinthInterior.visible = true;
    scene.background = new THREE.Color(0x0a0a12);
    scene.fog = new THREE.Fog(0x0a0a12, 15, 45);
    // Luz tenue del interior
    if (!labyrinthInterior.userData.light) {
      const l = new THREE.AmbientLight(0x444466, 0.7);
      labyrinthInterior.add(l);
      labyrinthInterior.userData.light = l;
    }
    player.position.set(0, 0, 26); // junto a la entrada
    addMsg('🌑 Entras en el laberinto. La luz del día desaparece tras el portal y un aire frío te envuelve. Paredes de piedra se alzan a ambos lados.', 'narrator');
  } else {
    villageGroup.visible = true;
    labyrinthInterior.visible = false;
    scene.background = new THREE.Color(0x87ceeb);
    scene.fog = new THREE.Fog(0x87ceeb, 60, 140);
    player.position.set(0, 0, -40); // junto al portal exterior
    // Limpiar zona dinámica si la hay
    if (dynamicZoneGroup) {
      scene.remove(dynamicZoneGroup);
      dynamicZoneGroup = null;
    }
    dynamicInteractables.forEach(it => {
      const idx = interactables.indexOf(it);
      if (idx > -1) interactables.splice(idx, 1);
    });
    dynamicInteractables = [];
    dynamicMonsters = [];
    addMsg('🌤 Sales del laberinto y vuelves al pueblo bajo el cielo azul.', 'narrator');
  }
  updateInteractPrompt();
}

// ============ ZONAS DINÁMICAS (generadas por LLM y persistidas en BD) ============
let dynamicZoneGroup = null;      // grupo 3D de la zona dinámica actual
let dynamicInteractables = [];    // interactables de la zona dinámica
let dynamicMonsters = [];         // monstruos de la zona dinámica
let currentZoneId = null;         // id de la zona dinámica cargada

// Elementos del overlay de generación
const genOverlay = document.getElementById('gen-overlay');
const genSteps = document.getElementById('gen-steps');
const genError = document.getElementById('gen-error');
const genSub = document.getElementById('gen-sub');

// Muestra el overlay y resetea los pasos
function showGenOverlay(zoneName) {
  genSteps.innerHTML = '';
  genError.textContent = '';
  genSub.textContent = `El mundo se está creando a partir de la historia...`;
  genOverlay.classList.add('active');
}
function hideGenOverlay() {
  genOverlay.classList.remove('active');
}

// Añade (o marca) un paso en el overlay. Si el paso ya existe, lo actualiza.
function addGenStep(key, label, state) {
  let li = genSteps.querySelector(`[data-key="${key}"]`);
  if (!li) {
    li = document.createElement('li');
    li.dataset.key = key;
    li.innerHTML = `<span class="gen-ico"></span><span class="gen-label"></span>`;
    genSteps.appendChild(li);
  }
  li.querySelector('.gen-label').textContent = label;
  // Estado: active (actual), done (completado), o por defecto (pendiente)
  li.className = state || '';
  li.querySelector('.gen-ico').textContent = state === 'done' ? '✓' : (state === 'active' ? '…' : '');
}

// Pide la zona al backend vía SSE, mostrando el progreso real en el overlay.
// Devuelve { zone, generated } o null si falla.
function fetchZoneWithProgress(zoneId) {
  return new Promise((resolve) => {
    showGenOverlay(zoneId);
    const es = new EventSource(`/api/zone/${encodeURIComponent(zoneId)}/stream`);
    const stepsSeen = {};

    es.addEventListener('step', (e) => {
      const data = JSON.parse(e.data);
      // El paso 'done' marca el final; los demás se muestran como activos y luego hechos
      if (data.key === 'done') {
        addGenStep('done', data.label, 'active');
      } else {
        // Marcar el paso anterior como hecho y el nuevo como activo
        Object.keys(stepsSeen).forEach((k) => {
          if (k !== data.key) addGenStep(k, stepsSeen[k], 'done');
        });
        stepsSeen[data.key] = data.label;
        addGenStep(data.key, data.label, 'active');
      }
    });

    es.addEventListener('zone', (e) => {
      const data = JSON.parse(e.data);
      // Marcar todos los pasos vistos como hechos
      Object.keys(stepsSeen).forEach((k) => addGenStep(k, stepsSeen[k], 'done'));
      addGenStep('done', '¡Zona lista!', 'done');
      es.close();
      hideGenOverlay();
      resolve(data);
    });

    es.addEventListener('error', (e) => {
      // Si ya recibimos la zona, ignorar el cierre normal del stream
      if (genOverlay.classList.contains('active')) {
        genError.textContent = 'Error generando la zona. Inténtalo de nuevo.';
      }
      es.close();
      hideGenOverlay();
      resolve(null);
    });
  });
}

// Carga una zona desde el backend (la genera el LLM si no existe, y la persiste)
async function loadDynamicZone(zoneId) {
  // Al entrar a una zona dinámica, ocultar el pueblo
  villageGroup.visible = false;
  labyrinthInterior.visible = false;
  // Limpiar zona dinámica anterior
  if (dynamicZoneGroup) {
    scene.remove(dynamicZoneGroup);
    dynamicZoneGroup = null;
  }
  // Quitar interactables anteriores de la lista global
  dynamicInteractables.forEach(it => {
    const idx = interactables.indexOf(it);
    if (idx > -1) interactables.splice(idx, 1);
  });
  dynamicInteractables = [];
  dynamicMonsters = [];

  // Pedir la zona al backend con progreso en tiempo real (SSE).
  // fetchZoneWithProgress resuelve con { zone, generated }.
  const result = await fetchZoneWithProgress(zoneId);
  if (!result || !result.zone) {
    addMsg('⚠️ No se pudo cargar la zona.', 'error');
    return null;
  }
  const zone = result.zone;
  const generated = result.generated;
  currentZoneId = zoneId;

  // Materializar la zona
  const rendered = renderZone(zone);
  dynamicZoneGroup = rendered.group;
  scene.add(dynamicZoneGroup);

  // Registrar interactables y monstruos dinámicos
  rendered.interactables.forEach(it => {
    interactables.push(it);
    dynamicInteractables.push(it);
  });
  rendered.monsters.forEach(m => {
    monsterGroups.push(m);
    dynamicMonsters.push(m);
  });

  // Aplicar atmósfera de la zona
  const L = zone.layout || {};
  scene.background = new THREE.Color(L.fogColor || '#0a0a12');
  scene.fog = new THREE.Fog(L.fogColor || '#0a0a12', L.fogNear ?? 10, L.fogFar ?? 60);

  // Mensaje de entrada
  addMsg(`📍 ${zone.name}`, 'system');
  if (zone.ambient) addMsg(zone.ambient, 'narrator');
  if (generated) addMsg('✨ Esta zona se ha generado a partir de la historia y se ha guardado.', 'system');

  updateInteractPrompt();
  return zone;
}

// ============ INTERACTIVIDAD (declarado antes de buildWorld) ============
// Guardar referencia al nombre de cada objeto interactivo
const interactiveObjects = [];
// Entidades con las que se puede interactuar por proximidad
const interactables = [];

function registerInteractive(obj, name) {
  obj.traverse((child) => {
    if (child.isMesh) {
      child.userData.interactiveName = name;
      interactiveObjects.push(child);
    }
  });
}

// Registrar NPCs y monstruos al crearlos
function wrapCreateNPC(x, z, color, name, role) {
  const g = createNPC(x, z, color);
  g.userData.npcName = name;
  g.userData.npcRole = role;
  g.userData.interactType = 'npc';
  registerInteractive(g, name);
  interactables.push(g);
  return g;
}
function wrapCreateMonster(x, z) {
  const g = createMonster(x, z);
  g.userData.interactType = 'monster';
  registerInteractive(g, 'スローラビット');
  interactables.push(g);
  return g;
}

// ============ CONSTRUIR MUNDO ============
function buildWorld() {
  createGround();
  // Casas del pueblo (a lo largo del camino en Z)
  createHouse(-8, -6, { color: 0xc8a06a, roof: 0x7a3a2a });
  createHouse(8, -6, { color: 0xb8906a, roof: 0x6a3a2a });
  createHouse(-8, 6, { color: 0xc8a06a, roof: 0x8a4a2b });
  createHouse(8, 6, { color: 0xb8906a, roof: 0x7a3a2a });
  createHouse(0, -14, { color: 0xc8a06a, roof: 0x8a4a2b, w: 7, d: 6 }); // Gremio/posada
  createHouse(0, 14, { color: 0xb8906a, roof: 0x6a3a2a, w: 7, d: 6 });

  // Árboles alrededor
  for (let i = 0; i < 20; i++) {
    const angle = (i / 20) * Math.PI * 2;
    const r = 30 + Math.random() * 30;
    createTree(Math.cos(angle) * r, Math.sin(angle) * r);
  }

  // Monstruos genéricos (se mantienen)
  wrapCreateMonster(20, 20);
  wrapCreateMonster(24, 18);
  wrapCreateMonster(-22, 22);
  wrapCreateMonster(-26, -20);
  wrapCreateMonster(18, -24);

  // Laberinto
  createLabyrinth();
  createLabyrinthInterior();
}

buildWorld();

// Inicializar personajes reales desde la API
initCharacterSystem().then(() => {
  placeVillageCharacters(scene, villageGroup, interactables, registerInteractive);
  updateCharacterPanel();
});

// Abre el detalle de equipamiento de un personaje (usado por el panel de compañeros)
window.__openCharacterDetail = (character) => {
  // El inventario del jugador: items equipables (objetos con id y slot)
  const inv = (gameState && gameState.inventory) || [];
  // El inventario del jugador guarda nombres; los items reales vienen de la API de equipment.
  // Mostramos el equipamiento disponible de la API para poder equipar.
  const allEquip = getEquipment();
  renderCharacterDetail(character, allEquip);
};

// ============ ANIMACIÓN ============
// `keys`/`INTERACT_RANGE` deben declararse ANTES de que animate() se ejecute (TDZ de const)
const keys = {};
const clock = new THREE.Clock();
const INTERACT_RANGE = 3.5;   // rango para hablar/interactuar
function animate() {
  requestAnimationFrame(animate);
  if (!webglOK) return;
  const dt = clock.getDelta();

  // Animar monstruos (saltando)
  monsters.forEach((m, i) => {
    m.position.y = Math.abs(Math.sin(clock.elapsedTime * 2 + i)) * 0.3;
    m.rotation.y += dt * 0.5;
  });

  updatePlayer(dt);
  updateCamera();
  updateInteractPrompt();

  if (renderer) renderer.render(scene, camera);
}
// NOTA: la llamada inicial a animate() está al final del archivo, para que
// todas las variables (let/const) estén inicializadas antes del primer frame.

// ============ RESIZE ============
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  if (renderer) renderer.setSize(window.innerWidth, window.innerHeight);
});

// ============ MOVIMIENTO WASD ============
window.addEventListener('keydown', (e) => {
  keys[e.key.toLowerCase()] = true;
  // No interferir con la escritura en el input
  if (e.target.tagName === 'INPUT') return;
  if (['w','a','s','d','q','e','arrowup','arrowdown','arrowleft','arrowright'].includes(e.key.toLowerCase())) {
    e.preventDefault();
  }
});
window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

const moveSpeed = 8;
function updatePlayer(dt) {
  let dx = 0, dz = 0;
  if (keys['w'] || keys['arrowup']) dz -= 1;
  if (keys['s'] || keys['arrowdown']) dz += 1;
  if (keys['a'] || keys['arrowleft']) dx -= 1;
  if (keys['d'] || keys['arrowright']) dx += 1;

  // Rotar cámara con Q/E
  if (keys['q']) camYaw -= dt * 1.5;
  if (keys['e']) camYaw += dt * 1.5;

  if (dx !== 0 || dz !== 0) {
    const len = Math.sqrt(dx*dx + dz*dz);
    dx /= len; dz /= len;
    // Movimiento relativo a la orientación de la cámara
    const forward = new THREE.Vector3(-Math.sin(camYaw), 0, -Math.cos(camYaw));
    const right = new THREE.Vector3(Math.cos(camYaw), 0, -Math.sin(camYaw));
    const move = new THREE.Vector3()
      .addScaledVector(forward, -dz)
      .addScaledVector(right, dx);
    player.position.addScaledVector(move, moveSpeed * dt);
    // Orientar al personaje hacia la dirección de movimiento
    player.rotation.y = Math.atan2(move.x, move.z);
  }
}

// ============ RAYCASTING: click en NPC/monstruo para 鑑定 ============
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

if (renderer && renderer.domElement) {
  renderer.domElement.addEventListener('click', (event) => {
    // No disparar si se está escribiendo o hay UI activa
    if (event.target !== renderer.domElement) return;
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(interactiveObjects);
    if (hits.length > 0) {
      const name = hits[0].object.userData.interactiveName;
      sendIdentify(name);
    }
  });
}

// ============ COMBATE VISUAL ============
// Tecla F: atacar al monstruo más cercano (lo elimina y da EXP vía backend)
const monsterGroups = []; // grupos de monstruos activos (pueblo + laberinto)
function collectMonsters() {
  monsterGroups.length = 0;
  monsters.forEach(m => monsterGroups.push(m));
  labyrinth.children.forEach(c => {
    if (c.userData && c.userData.isLabyrinth) monsterGroups.push(c);
  });
}
collectMonsters();

function attackNearest() {
  let nearest = null, nearestDist = Infinity;
  for (const m of monsterGroups) {
    if (!isVisibleInScene(m)) continue;
    const d = player.position.distanceTo(m.position);
    if (d < nearestDist) { nearestDist = d; nearest = m; }
  }
  if (nearest && nearestDist < 8) {
    // Eliminar visualmente
    nearest.visible = false;
    const idx = monsterGroups.indexOf(nearest);
    if (idx > -1) monsterGroups.splice(idx, 1);
    // Enviar acción de combate al backend
    const target = nearest.userData.isLabyrinth ? 'un monstruo del laberinto' : 'un スローラビット';
    sendAction(`Ataco y derroto a ${target} con mi espada`);
    return true;
  }
  return false;
}

window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'f' && e.target.tagName !== 'INPUT') {
    if (!attackNearest()) {
      addMsg('No hay ningún monstruo cerca para atacar.', 'system');
    }
  }
});

// ============ INTERACCIÓN POR PROXIMIDAD ============
const interactPrompt = document.getElementById('interact-prompt');
const promptKey = document.getElementById('prompt-key');
const promptText = document.getElementById('prompt-text');
let currentInteractable = null;

const ATTACK_RANGE = 5;       // rango para atacar

function findNearestInteractable() {
  let nearest = null, nearestDist = Infinity;
  for (const it of interactables) {
    if (!isVisibleInScene(it)) continue;
    const d = player.position.distanceTo(it.position);
    if (d < nearestDist) { nearestDist = d; nearest = it; }
  }
  if (nearest && nearestDist <= INTERACT_RANGE) return { obj: nearest, dist: nearestDist };
  return null;
}

function updateInteractPrompt() {
  const found = findNearestInteractable();
  if (!found) {
    currentInteractable = null;
    interactPrompt.classList.add('hidden');
    return;
  }
  currentInteractable = found.obj;
  const type = found.obj.userData.interactType;
  const name = found.obj.userData.interactiveName || found.obj.userData.npcName || found.obj.userData.monsterName || found.obj.userData.itemName || 'objeto';
  if (type === 'monster') {
    promptKey.textContent = 'F';
    promptText.textContent = `Atacar ${name}`;
  } else if (type === 'portal') {
    promptKey.textContent = 'E';
    promptText.textContent = 'Entrar al laberinto';
  } else if (type === 'exit') {
    promptKey.textContent = 'E';
    promptText.textContent = found.obj.userData.exitLabel || 'Salir de la zona';
  } else if (type === 'item') {
    promptKey.textContent = 'E';
    promptText.textContent = `Recoger ${name}`;
  } else {
    promptKey.textContent = 'E';
    promptText.textContent = `Hablar con ${name}`;
  }
  interactPrompt.classList.remove('hidden');
}

function interactWith(obj) {
  if (!obj) return;
  const type = obj.userData.interactType;
  const name = obj.userData.interactiveName || obj.userData.npcName || 'objeto';
  if (type === 'monster') {
    if (attackNearest()) return;
    addMsg('El monstruo está demasiado lejos.', 'system');
    return;
  }
  if (type === 'portal') {
    // Entrar al laberinto (zona dinámica generada por LLM)
    loadDynamicZone('laberinto_piso1');
    return;
  }
  if (type === 'exit') {
    // Exit dinámico: cargar la zona destino (o volver al pueblo)
    const target = obj.userData.exitTarget;
    if (target === 'village' || target === 'pueblo' || target === '最初の村') {
      switchZone('village');
    } else if (target) {
      loadDynamicZone(target);
    } else {
      switchZone('village');
    }
    return;
  }
  if (type === 'item') {
    // Recoger objeto
    const itemName = obj.userData.itemName || 'objeto';
    const itemType = obj.userData.itemType || 'treasure';
    const itemValue = obj.userData.itemValue || 0;
    // Eliminar visualmente
    obj.visible = false;
    const idx = interactables.indexOf(obj);
    if (idx > -1) interactables.splice(idx, 1);
    currentInteractable = null;
    updateInteractPrompt();
    // Enviar acción al backend (el GM decide el efecto)
    sendAction(`Recojo el objeto ${itemName} (${itemType}, valor ${itemValue})`);
    return;
  }
  // NPC: hablar según su rol (y diálogo generado si existe)
  const role = obj.userData.npcRole || '';
  const dialog = obj.userData.npcDialog || '';
  const charId = obj.userData.characterId;
  
  // Si es un personaje real de la API, enriquecer la acción con sus stats
  if (charId && getCharacterById) {
    const char = getCharacterById(charId);
    if (char) {
      const stats = char.stats || {};
      const eqStats = getEffectiveStats ? getEffectiveStats(char) : stats;
      const eqList = [];
      if (char.equipment) {
        if (char.equipment.weapon) eqList.push('⚔️ ' + char.equipment.weapon);
        if (char.equipment.armor) eqList.push('🛡️ ' + char.equipment.armor);
        if (char.equipment.accessory) eqList.push('💍 ' + char.equipment.accessory);
      }
      const action = dialog
        ? `Hablo con ${name} (${role}). ${char.race ? `[${char.race}] ` : ''}LV${stats.level} HP${eqStats.hp}/${eqStats.maxHp}. ${dialog}${eqList.length ? ' Equipo: ' + eqList.join(', ') : ''}`
        : `Hablo con ${name} (${role}). ${char.race ? `[${char.race}] ` : ''}LV${stats.level} HP${eqStats.hp}/${eqStats.maxHp}.`;
      sendAction(action);
      return;
    }
  }
  
  const action = dialog
    ? `Hablo con ${name} (${role}). El personaje dice: "${dialog}"`
    : `Hablo con ${name} (${role})`;
  sendAction(action);
}

function interactWithCurrent() {
  if (!currentInteractable) return;
  interactWith(currentInteractable);
}

// Tecla E para interactuar
window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'e' && e.target.tagName !== 'INPUT') {
    interactWithCurrent();
  }
});

// ============ UI / API ============
const logEl = document.getElementById('log');
const inputEl = document.getElementById('action-input');
const sendBtn = document.getElementById('send-btn');
const thinkingEl = document.getElementById('thinking');
const introEl = document.getElementById('intro');
const startBtn = document.getElementById('start-btn');
const introLoading = document.getElementById('intro-loading');

let gameState = null;

function addMsg(text, cls = 'narrator') {
  const div = document.createElement('div');
  div.className = 'msg ' + cls;
  // Renderizar saltos de línea y negritas básicas
  div.innerHTML = text.replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
}

function updateHUD() {
  if (!gameState) return;
  const p = gameState.player;
  document.getElementById('player-name').textContent = p.name;
  document.getElementById('stat-level').textContent = p.level;
  document.getElementById('stat-exp').textContent = `${p.exp}/${p.expToNext}`;
  document.getElementById('stat-hp').textContent = `${p.hp}/${p.maxHp}`;
  document.getElementById('stat-mp').textContent = `${p.mp}/${p.maxMp}`;
  document.getElementById('stat-job').textContent = p.job;
  document.getElementById('stat-money').textContent = `${gameState.money} ナール`;
  document.getElementById('stat-loc').textContent = gameState.location;
  document.getElementById('stat-days').textContent = `⏳ Quedan ${gameState.daysRemaining} días`;
  updateCharacterHUD();
  updateInventoryHUD();
}

function updateCharacterHUD() {
  const panel = document.getElementById('character-panel');
  const list = document.getElementById('character-list');
  if (!panel || !list) return;
  
  // Intentar obtener personajes del sistema de characterManager
  const chars = (typeof getCharacters === 'function') ? getCharacters() : [];
  const companions = chars.filter(c => c.tags && c.tags.includes('companion'));
  
  if (companions.length === 0) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = 'block';
  
  let html = '';
  companions.forEach(c => {
    const stats = (typeof getEffectiveStats === 'function') ? getEffectiveStats(c) : (c.stats || {});
    html += `<div style="margin-bottom:8px;padding:5px;background:rgba(255,255,255,0.05);border-radius:5px;">`;
    html += `<div style="font-weight:700;font-size:12px;color:#fff;">${c.name}</div>`;
    html += `<div style="font-size:10px;color:#9aa3b2;">${c.race || ''} · LV${stats.level || 1}</div>`;
    html += `<div style="display:flex;gap:6px;margin-top:3px;font-size:10px;">`;
    html += `<span style="color:#ff6b6b;">♥ ${stats.hp || 0}/${stats.maxHp || 0}</span>`;
    html += `<span style="color:#6ba8ff;">✦ ${stats.mp || 0}/${stats.maxMp || 0}</span>`;
    html += `</div></div>`;
  });
  list.innerHTML = html;
}

function updateInventoryHUD() {
  const panel = document.getElementById('inventory-panel');
  const list = document.getElementById('inventory-list');
  if (!panel || !list) return;
  
  const inv = gameState.inventory || [];
  if (inv.length === 0) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = 'block';
  
  let html = '';
  inv.forEach(item => {
    html += `<div style="padding:2px 0;font-size:11px;">• ${item}</div>`;
  });
  list.innerHTML = html;
}

function setThinking(on) {
  thinkingEl.style.display = on ? 'flex' : 'none';
  sendBtn.disabled = on;
}

async function loadState() {
  const res = await fetch('/api/state');
  gameState = await res.json();
  updateHUD();
}

async function sendAction(action) {
  if (!action || action.trim() === '') return;
  addMsg(action, 'player');
  inputEl.value = '';
  setThinking(true);
  try {
    const res = await fetch('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action })
    });
    const data = await res.json();
    if (data.error) {
      addMsg('⚠️ ' + data.error, 'error');
    } else {
      gameState = data.state;
      addMsg(data.narrative, 'narrator');
      if (data.mechanics) {
        const m = data.mechanics;
        const parts = [];
        if (m.exp) parts.push(`+${m.exp} EXP`);
        if (m.money) parts.push(`${m.money > 0 ? '+' : ''}${m.money} ナール`);
        if (m.job) parts.push(`Nuevo trabajo: ${m.job}`);
        if (parts.length) addMsg('📊 ' + parts.join(' · '), 'system');
      }
      updateHUD();
    }
  } catch (err) {
    addMsg('⚠️ Error de conexión: ' + err.message, 'error');
  } finally {
    setThinking(false);
  }
}

async function sendIdentify(name) {
  const target = (name || '').trim();
  if (!target) {
    addMsg('Haz clic en un personaje o monstruo para identificarlo con 鑑定.', 'system');
    return;
  }
  addMsg(`🔍 Uso 鑑定 sobre: ${target}`, 'player');
  setThinking(true);
  try {
    const res = await fetch('/api/identify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target })
    });
    const data = await res.json();
    if (data.error) addMsg('⚠️ ' + data.error, 'error');
    else addMsg(data.narrative, 'narrator');
  } catch (err) {
    addMsg('⚠️ Error de conexión: ' + err.message, 'error');
  } finally {
    setThinking(false);
  }
}

// Eventos
sendBtn.addEventListener('click', () => sendAction(inputEl.value));
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendAction(inputEl.value);
});

// Toggle del registro (colapsar/expandir)
const toggleLog = document.getElementById('toggle-log');
let logCollapsed = false;
document.getElementById('dialog-header').addEventListener('click', () => {
  logCollapsed = !logCollapsed;
  logEl.style.display = logCollapsed ? 'none' : '';
  toggleLog.textContent = logCollapsed ? '+' : '—';
});

// Inicio
startBtn.addEventListener('click', () => {
  introEl.classList.add('hidden');
  addMsg('🌅 Despiertas en un establo de un mundo desconocido. Fuera, un pueblo de casas de madera se extiende bajo un cielo azul.', 'narrator');
  addMsg('💡 Muévete con WASD. Acércate a un personaje y pulsa <b>E</b> para hablar, o a un monstruo y pulsa <b>F</b> para atacar. Haz clic en cualquier personaje para usar 鑑定.', 'system');
  inputEl.focus();
});

// Cargar estado inicial y ocultar intro cuando esté listo
(async () => {
  try {
    await loadState();
    introLoading.textContent = 'Mundo cargado. ¡Listo!';
    startBtn.classList.remove('hidden');
  } catch (err) {
    introLoading.textContent = 'Error cargando el mundo: ' + err.message;
  }
})();

// Exportar para depuración
window.__game = { scene, camera, renderer, player };

// ============ MODO TEXTO / API DE CONTROL ============
// Permite validar los flujos (entrar a zonas, interactuar, atacar) sin WebGL,
// y sirve de base para las pruebas e2e. Expone un panel de depuración.
window.__game = {
  scene, camera, renderer, player,
  // Navegación de zonas
  enterZone: (id) => loadDynamicZone(id),
  goVillage: () => switchZone('village'),
  // Interacción
  interactNearest: () => {
    const found = findNearestInteractable();
    if (!found) { addMsg('Nada cerca con lo que interactuar.', 'system'); return null; }
    interactWith(found.obj);
    return found.obj.userData;
  },
  attackNearest: () => attackNearest(),
  // Estado de la escena
  currentZone: () => currentZone,
  currentZoneId: () => currentZoneId,
  interactables: () => interactables.map(it => ({
    type: it.userData.interactType,
    name: it.userData.interactiveName || it.userData.npcName || it.userData.itemName || it.userData.monsterName,
    x: it.position.x, z: it.position.z
  })),
  // Forzar el bucle de interacción aunque no haya WebGL (para pruebas)
  tick: () => { updateInteractPrompt(); },
};

// En modo texto (sin WebGL), el bucle animate() no corre updateInteractPrompt.
// Añadimos un tick periódico para que la interacción por proximidad funcione.
if (!webglOK) {
  setInterval(() => { updateInteractPrompt(); }, 200);
}

// Arrancar el bucle de animación AQUÍ, al final, cuando todas las variables
// (keys, INTERACT_RANGE, currentInteractable, etc.) ya están inicializadas.
animate();
