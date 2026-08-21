// ===== GUI del Game Master — Book-RPG =====
// Vanilla JS. Consume la API del servidor según el contrato.

const API = '/api';

// ===== Estado =====
let characters = [];
let equipment = [];
let story = null;

// ===== DOM refs =====
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
  initNav();
  initStory();
  initCharacters();
  initEquipment();
  initVoices();
  initModals();
  loadAll();
});

// ===== Navegación =====
function initNav() {
  $$('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const section = btn.dataset.section;
      $$('.nav-btn').forEach(b => b.classList.toggle('active', b === btn));
      $$('.section').forEach(s => s.classList.toggle('active', s.id === `section-${section}`));
      if (section === 'characters') loadCharacters();
      if (section === 'equipment') loadEquipment();
      if (section === 'voices') loadVoices();
      if (section === 'story') loadStory();
    });
  });
}

// ===== Carga general =====
async function loadAll() {
  await Promise.all([loadStory(), loadCharacters(), loadEquipment(), loadVoices()]);
}

// ===== Toast =====
function toast(msg, type = 'info') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast ${type} show`;
  setTimeout(() => t.classList.remove('show'), 3000);
}

// ===== Fetch helper =====
async function api(path, opts = {}) {
  const url = `${API}${path}`;
  const res = await fetch(url, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Error desconocido' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ===== HISTORIA =====
let stories = [];
function initStory() {
  $('#story-upload').addEventListener('change', handleStoryUpload);
  $('#btn-reparse').addEventListener('click', handleReparse);
  $('#btn-gen-entities').addEventListener('click', handleGenerateEntities);
  $('#btn-new-story').addEventListener('click', handleNewStory);
  $('#story-select').addEventListener('change', handleSelectStory);
  $('#btn-delete-story').addEventListener('click', handleDeleteStory);
  $('#story-game-type').addEventListener('change', handleGameTypeChange);
  $('#story-default-voice').addEventListener('change', handleDefaultVoiceChange);
}

async function handleDefaultVoiceChange() {
  if (!story) return;
  const defaultVoice = $('#story-default-voice').value;
  try {
    const data = await api(`/story/${story.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultVoice })
    });
    story = data.story;
    toast(defaultVoice ? `Voz por defecto: ${defaultVoice}` : 'Voz por defecto: sin voz', 'success');
  } catch (err) {
    toast(err.message, 'error');
    $('#story-default-voice').value = story.defaultVoice || '';
  }
}

async function handleGameTypeChange() {
  if (!story) return;
  const gameType = $('#story-game-type').value;
  try {
    const data = await api(`/story/${story.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameType })
    });
    story = data.story;
    const label = gameType === 'visual_novel' ? 'Novela visual' : 'Mundo abierto (3D)';
    toast(`Tipo de juego: ${label}`, 'success');
  } catch (err) {
    toast(err.message, 'error');
    $('#story-game-type').value = story.gameType || 'open_world';
  populateStoryDefaultVoice();
  }
}

async function loadStory() {
  try {
    const data = await api('/story');
    stories = data.stories || [];
    story = data.story;
    renderStorySelector();
    renderStory();
  } catch (err) {
    console.error('Error cargando historia:', err);
    story = null;
    stories = [];
    renderStorySelector();
    renderStory();
  }
}

function renderStorySelector() {
  const sel = $('#story-select');
  sel.innerHTML = '';
  stories.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.title || 'Sin título';
    if (story && s.id === story.id) opt.selected = true;
    sel.appendChild(opt);
  });
}

async function handleNewStory() {
  const title = prompt('Nombre de la nueva historia:', 'Nueva historia');
  if (title === null) return;
  try {
    const data = await api('/story', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) });
    story = data.story;
    toast('Nueva historia creada. Sube un archivo o edítala.', 'success');
    await loadStory();
    await loadCharacters();
    await loadEquipment();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function handleSelectStory() {
  const storyId = $('#story-select').value;
  if (!storyId) return;
  try {
    const data = await api('/story/select', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storyId }) });
    story = data.story;
    toast('Historia activa: ' + (story.title || 'Sin título'), 'success');
    await loadStory();
    await loadCharacters();
    await loadEquipment();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function handleDeleteStory() {
  if (!story) return;
  if (!confirm(`¿Borrar la historia "${story.title}" y todos sus datos?`)) return;
  try {
    await api(`/story/${story.id}`, { method: 'DELETE' });
    toast('Historia borrada', 'success');
    await loadStory();
    await loadCharacters();
    await loadEquipment();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderStory() {
  const empty = $('#story-empty');
  const content = $('#story-content');
  if (!story) {
    empty.classList.remove('hidden');
    content.classList.add('hidden');
    return;
  }
  empty.classList.add('hidden');
  content.classList.remove('hidden');
  $('#story-title').textContent = story.title || 'Sin título';
  $('#story-source').textContent = `Fuente: ${story.source || 'manual'} · ${story.chapters?.length || 0} capítulos · ${story.images?.length || 0} imágenes`;
  $('#story-game-type').value = story.gameType || 'open_world';

  // Galería de imágenes extraídas del epub
  const imgWrap = $('#story-images');
  imgWrap.innerHTML = '';
  const imgs = story.images || [];
  if (imgs.length > 0) {
    const grid = document.createElement('div');
    grid.className = 'img-grid';
    imgs.forEach((src, i) => {
      const item = document.createElement('div');
      item.className = 'img-item' + (i === 0 ? ' cover' : '');
      item.innerHTML = `<img src="${src}" alt="Ilustración ${i + 1}" loading="lazy">`;
      item.addEventListener('click', () => window.open(src, '_blank'));
      grid.appendChild(item);
    });
    imgWrap.appendChild(grid);
  }

  const list = $('#chapters-list');
  list.innerHTML = '';
  (story.chapters || []).forEach(ch => {
    const el = document.createElement('div');
    el.className = 'chapter-card';
    el.innerHTML = `
      <h4>Cap. ${ch.index}: ${ch.title}</h4>
      <p>${ch.summary || 'Sin resumen'}</p>
      <div class="chapter-meta">${ch.scenes?.length || 0} escenas</div>
    `;
    el.addEventListener('click', () => openChapter(ch));
    list.appendChild(el);
  });
}

async function handleStoryUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('file', file);
  showLoading(`Subiendo y parseando «${file.name}»...`, 'Esto puede tardar unos minutos en libros largos');
  try {
    const data = await api('/story/upload', { method: 'POST', body: fd });
    story = data.story;
    renderStory();
    toast(`¡Historia cargada! (${data.charsSaved || 0} personajes, ${data.itemsSaved || 0} items generados)`, 'success');
    await loadStory();
    await loadCharacters();
    await loadEquipment();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    hideLoading();
  }
  e.target.value = '';
}

function showLoading(text, sub) {
  const ov = $('#loading-overlay');
  if (text) $('#loading-text').textContent = text;
  if (sub) $('#loading-sub').textContent = sub;
  ov.classList.add('show');
}
function hideLoading() {
  $('#loading-overlay').classList.remove('show');
}

async function handleReparse() {
  if (!story) return;
  try {
    toast('Reestructurando con IA...', 'info');
    const data = await api('/story/parse', { method: 'POST' });
    story = data.story;
    renderStory();
    toast('¡Historia reestructurada!', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function handleGenerateEntities() {
  if (!story) {
    toast('Primero sube una historia', 'error');
    return;
  }
  const btn = $('#btn-gen-entities');
  btn.disabled = true;
  btn.textContent = '⏳ Generando...';
  try {
    toast('Generando personajes y equipamiento con IA...', 'info');
    const data = await api('/story/generate-entities', { method: 'POST' });
    toast(`¡Generados ${data.charsSaved} personajes y ${data.itemsSaved} items!`, 'success');
    await loadCharacters();
    await loadEquipment();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '✨ Generar personajes y equipamiento';
  }
}

// ===== PERSONAJES =====
function initCharacters() {
  $('#btn-new-character').addEventListener('click', () => openCharacterModal());
  $('#form-character').addEventListener('submit', handleSaveCharacter);
  $('#btn-cancel-character').addEventListener('click', closeCharacterModal);
  $('#btn-close-character').addEventListener('click', closeCharacterModal);
  $('#btn-upload-orig').addEventListener('click', () => $('#char-orig-file').click());
  $('#char-orig-file').addEventListener('change', handleOrigFile);
  $('#btn-gen-portrait').addEventListener('click', handleGenPortrait);
}

// Variable temporal con la ilustración original subida (data URI) en el modal abierto.
let origImageData = null;

function handleOrigFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    origImageData = reader.result;
    const img = $('#char-orig-preview');
    img.src = origImageData;
    img.classList.remove('hidden');
    $('#char-orig-empty').classList.add('hidden');
  };
  reader.readAsDataURL(file);
}

async function handleGenPortrait() {
  const id = $('#char-id').value;
  if (!id) { toast('Guarda primero el personaje', 'error'); return; }
  if (!origImageData) { toast('Sube primero una ilustración original', 'error'); return; }
  const btn = $('#btn-gen-portrait');
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = '⏳ Generando ficha...';
  try {
    const data = await api('/images/portrait', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storyId: story.id, characterId: id, imageData: origImageData })
    });
    const img = $('#char-portrait-preview');
    img.src = data.portrait;
    img.classList.remove('hidden');
    $('#char-portrait-empty').classList.add('hidden');
    // Actualizar el personaje en memoria
    const ch = characters.find(c => c.id === id);
    if (ch) ch.portrait = data.portrait;
    toast('✅ Ficha generada', 'success');
  } catch (err) {
    toast('⚠️ ' + err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = orig;
  }
}

async function loadCharacters() {
  try {
    const data = await api('/characters');
    characters = data.characters || [];
    renderCharacters();
  } catch (err) {
    console.error('Error cargando personajes:', err);
    characters = [];
    renderCharacters();
  }
}

function renderCharacters() {
  const list = $('#characters-list');
  const empty = $('#characters-empty');
  list.innerHTML = '';
  if (characters.length === 0) {
    list.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }
  list.classList.remove('hidden');
  empty.classList.add('hidden');

  characters.forEach(ch => {
    const s = ch.stats || {};
    const card = document.createElement('div');
    card.className = 'card';
    const tagsHtml = (ch.tags || []).map(t => `<span class="tag">${t}</span>`).join('');
    const portraitHtml = ch.portrait
      ? `<div class="char-portrait"><img src="${ch.portrait}" alt="${ch.name}"></div>`
      : '';
    card.innerHTML = `
      <div class="card-header">
        <div>
          <h4>${ch.name}</h4>
          <div class="tags">${tagsHtml}</div>
        </div>
      </div>
      <div class="card-body">
        ${portraitHtml}
        <p>${ch.race || ''} · ${ch.class || ''}</p>
        ${ch.voice ? `<p class="muted" style="font-size:0.8rem;">🎙️ ${ch.voice}</p>` : ''}
        <div class="stats-mini">
          <div class="stat-mini"><b>${s.level || 1}</b>LV</div>
          <div class="stat-mini"><b>${s.hp || 0}</b>HP</div>
          <div class="stat-mini"><b>${s.mp || 0}</b>MP</div>
          <div class="stat-mini"><b>${s.str || 0}</b>STR</div>
          <div class="stat-mini"><b>${s.agi || 0}</b>AGI</div>
        </div>
        <p class="muted" style="margin-top:8px;font-size:0.8rem;">${ch.description || ''}</p>
      </div>
      <div class="card-footer">
        <button class="btn btn-secondary btn-edit-char" data-id="${ch.id}">✏️ Editar</button>
        <button class="btn btn-secondary btn-gen3d" data-id="${ch.id}">🎨 3D</button>
        <button class="btn btn-danger btn-del-char" data-id="${ch.id}">🗑️</button>
      </div>
    `;
    list.appendChild(card);
  });

  $$('.btn-edit-char').forEach(b => b.addEventListener('click', () => openCharacterModal(b.dataset.id)));
  $$('.btn-del-char').forEach(b => b.addEventListener('click', () => deleteCharacter(b.dataset.id)));
  $$('.btn-gen3d').forEach(b => b.addEventListener('click', () => generate3D(b.dataset.id)));
}

function openCharacterModal(id = null) {
  const char = id ? characters.find(c => c.id === id) : null;
  $('#modal-character-title').textContent = char ? `Editar: ${char.name}` : 'Nuevo personaje';
  $('#char-id').value = char?.id || '';
  $('#char-name').value = char?.name || '';
  $('#char-race').value = char?.race || '';
  $('#char-class').value = char?.class || '';
  $('#char-description').value = char?.description || '';
  $('#char-voice').value = char?.voice || '';
  $('#char-tags').value = (char?.tags || []).join(', ');

  const s = char?.stats || {};
  $('#stat-level').value = s.level || 1;
  $('#stat-hp').value = s.hp || 100;
  $('#stat-mp').value = s.mp || 50;
  $('#stat-str').value = s.str || 10;
  $('#stat-vit').value = s.vit || 10;
  $('#stat-agi').value = s.agi || 10;
  $('#stat-dex').value = s.dex || 10;
  $('#stat-int').value = s.int || 10;
  $('#stat-luck').value = s.luck || 10;

  // Poblar selects de equipamiento
  populateEquipSelects(char);
  // Poblar selector de voces globales
  populateVoiceSelect(char);

  // Mostrar ficha existente (si la tiene) y resetear ilustración temporal
  origImageData = null;
  $('#char-orig-file').value = '';
  const origImg = $('#char-orig-preview');
  origImg.classList.add('hidden');
  origImg.removeAttribute('src');
  $('#char-orig-empty').classList.remove('hidden');
  const portImg = $('#char-portrait-preview');
  if (char?.portrait) {
    portImg.src = char.portrait;
    portImg.classList.remove('hidden');
    $('#char-portrait-empty').classList.add('hidden');
  } else {
    portImg.classList.add('hidden');
    portImg.removeAttribute('src');
    $('#char-portrait-empty').classList.remove('hidden');
  }

  $('#modal-character').classList.add('open');
}

function populateVoiceSelect(char) {
  const sel = $('#char-voice');
  const current = char?.voice || '';
  sel.innerHTML = '<option value="">— sin voz (default) —</option>';
  voices.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v.id;
    opt.textContent = v.seiyu ? `${v.name} (${v.seiyu})` : v.name;
    if (current === v.id) opt.selected = true;
    sel.appendChild(opt);
  });
}

// Puebla el selector de voz por defecto de la historia activa.
function populateStoryDefaultVoice() {
  const sel = $('#story-default-voice');
  if (!sel) return;
  const current = story?.defaultVoice || '';
  sel.innerHTML = '<option value="">— sin voz (usa la del personaje) —</option>';
  voices.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v.id;
    opt.textContent = v.seiyu ? `${v.name} (${v.seiyu})` : v.name;
    if (current === v.id) opt.selected = true;
    sel.appendChild(opt);
  });
}

function populateEquipSelects(char) {
  const slots = ['weapon', 'armor', 'accessory'];
  slots.forEach(slot => {
    const sel = $(`#equip-${slot}`);
    sel.innerHTML = '<option value="">— vacío —</option>';
    equipment.filter(e => e.slot === slot).forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.id;
      opt.textContent = e.name;
      if (char && char.equipment && char.equipment[slot] === e.id) opt.selected = true;
      sel.appendChild(opt);
    });
  });
}

function closeCharacterModal() {
  $('#modal-character').classList.remove('open');
  $('#form-character').reset();
}

async function handleSaveCharacter(e) {
  e.preventDefault();
  const id = $('#char-id').value;
  const payload = {
    name: $('#char-name').value,
    race: $('#char-race').value,
    class: $('#char-class').value,
    description: $('#char-description').value,
    voice: $('#char-voice').value,
    tags: $('#char-tags').value.split(',').map(t => t.trim()).filter(Boolean),
    stats: {
      level: +$('#stat-level').value,
      hp: +$('#stat-hp').value,
      maxHp: +$('#stat-hp').value,
      mp: +$('#stat-mp').value,
      maxMp: +$('#stat-mp').value,
      str: +$('#stat-str').value,
      vit: +$('#stat-vit').value,
      agi: +$('#stat-agi').value,
      dex: +$('#stat-dex').value,
      int: +$('#stat-int').value,
      luck: +$('#stat-luck').value
    }
  };

  try {
    let char;
    if (id) {
      const data = await api(`/characters/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      char = data.character;
    } else {
      const data = await api('/characters', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      char = data.character;
    }

    // Actualizar equipamiento
    const slots = ['weapon', 'armor', 'accessory'];
    for (const slot of slots) {
      const eqId = $(`#equip-${slot}`).value;
      if (eqId) {
        await api(`/characters/${char.id}/equip`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slot, equipmentId: eqId }) });
      } else if (char.equipment && char.equipment[slot]) {
        await api(`/characters/${char.id}/unequip`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slot }) });
      }
    }

    closeCharacterModal();
    await loadCharacters();
    toast(id ? 'Personaje actualizado' : 'Personaje creado', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function deleteCharacter(id) {
  if (!confirm('¿Borrar este personaje?')) return;
  try {
    await api(`/characters/${id}`, { method: 'DELETE' });
    await loadCharacters();
    toast('Personaje borrado', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function generate3D(id) {
  try {
    toast('Generando modelo 3D...', 'info');
    await api(`/characters/${id}/generate3d`, { method: 'POST' });
    await loadCharacters();
    toast('Modelo 3D en cola (pending)', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ===== EQUIPAMIENTO =====
function initEquipment() {
  $('#btn-new-equipment').addEventListener('click', () => openEquipmentModal());
  $('#form-equipment').addEventListener('submit', handleSaveEquipment);
  $('#btn-cancel-equipment').addEventListener('click', closeEquipmentModal);
  $('#btn-close-equipment').addEventListener('click', closeEquipmentModal);
}

async function loadEquipment() {
  try {
    const data = await api('/equipment');
    equipment = data.equipment || [];
    renderEquipment();
  } catch (err) {
    console.error('Error cargando equipamiento:', err);
    equipment = [];
    renderEquipment();
  }
}

function renderEquipment() {
  const list = $('#equipment-list');
  const empty = $('#equipment-empty');
  list.innerHTML = '';
  if (equipment.length === 0) {
    list.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }
  list.classList.remove('hidden');
  empty.classList.add('hidden');

  equipment.forEach(eq => {
    const card = document.createElement('div');
    card.className = 'card';
    const st = eq.stats || {};
    const statsHtml = Object.entries(st)
      .filter(([_, v]) => v !== 0)
      .map(([k, v]) => `${k.toUpperCase()}: ${v > 0 ? '+' : ''}${v}`)
      .join(', ') || 'Sin bonificaciones';
    card.innerHTML = `
      <div class="card-header">
        <h4>${eq.name}</h4>
        <span class="rarity rarity-${eq.rarity}">${eq.rarity}</span>
      </div>
      <div class="card-body">
        <p>${eq.type || ''} · ${eq.slot || ''}</p>
        <p class="muted">${statsHtml}</p>
        <p class="muted" style="margin-top:4px;">${eq.description || ''}</p>
        <p style="margin-top:4px;font-size:0.8rem;color:var(--warning);">💰 ${eq.value || 0}G</p>
      </div>
      <div class="card-footer">
        <button class="btn btn-secondary btn-edit-eq" data-id="${eq.id}">✏️ Editar</button>
        <button class="btn btn-danger btn-del-eq" data-id="${eq.id}">🗑️</button>
      </div>
    `;
    list.appendChild(card);
  });

  $$('.btn-edit-eq').forEach(b => b.addEventListener('click', () => openEquipmentModal(b.dataset.id)));
  $$('.btn-del-eq').forEach(b => b.addEventListener('click', () => deleteEquipment(b.dataset.id)));
}

function openEquipmentModal(id = null) {
  const eq = id ? equipment.find(e => e.id === id) : null;
  $('#modal-equipment-title').textContent = eq ? `Editar: ${eq.name}` : 'Nuevo item';
  $('#eq-id').value = eq?.id || '';
  $('#eq-name').value = eq?.name || '';
  $('#eq-slot').value = eq?.slot || 'weapon';
  $('#eq-type').value = eq?.type || '';
  $('#eq-rarity').value = eq?.rarity || 'common';
  $('#eq-description').value = eq?.description || '';
  $('#eq-value').value = eq?.value || 0;

  const st = eq?.stats || {};
  $('#eq-stat-str').value = st.str || 0;
  $('#eq-stat-vit').value = st.vit || 0;
  $('#eq-stat-agi').value = st.agi || 0;
  $('#eq-stat-dex').value = st.dex || 0;
  $('#eq-stat-int').value = st.int || 0;
  $('#eq-stat-luck').value = st.luck || 0;
  $('#eq-stat-hp').value = st.hp || 0;
  $('#eq-stat-mp').value = st.mp || 0;

  $('#modal-equipment').classList.add('open');
}

function closeEquipmentModal() {
  $('#modal-equipment').classList.remove('open');
  $('#form-equipment').reset();
}

async function handleSaveEquipment(e) {
  e.preventDefault();
  const id = $('#eq-id').value;
  const payload = {
    name: $('#eq-name').value,
    slot: $('#eq-slot').value,
    type: $('#eq-type').value,
    rarity: $('#eq-rarity').value,
    description: $('#eq-description').value,
    value: +$('#eq-value').value,
    stats: {
      str: +$('#eq-stat-str').value,
      vit: +$('#eq-stat-vit').value,
      agi: +$('#eq-stat-agi').value,
      dex: +$('#eq-stat-dex').value,
      int: +$('#eq-stat-int').value,
      luck: +$('#eq-stat-luck').value,
      hp: +$('#eq-stat-hp').value,
      mp: +$('#eq-stat-mp').value
    }
  };

  try {
    if (id) {
      await api(`/equipment/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    } else {
      await api('/equipment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    }
    closeEquipmentModal();
    await loadEquipment();
    toast(id ? 'Item actualizado' : 'Item creado', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function deleteEquipment(id) {
  if (!confirm('¿Borrar este item?')) return;
  try {
    await api(`/equipment/${id}`, { method: 'DELETE' });
    await loadEquipment();
    toast('Item borrado', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ===== CAPÍTULO (modal) =====
// Muestra el capítulo con sus escenas. En novelas visuales (gameType === 'visual_novel')
// cada escena/capítulo puede tener una imagen emparejada, generada con flux2
// (creador / editor / editor múltiple) o elegida de las imágenes del epub.
function openChapter(ch) {
  $('#modal-chapter-title').textContent = `Cap. ${ch.index}: ${ch.title}`;
  const detail = $('#chapter-detail');
  const isVN = story && story.gameType === 'visual_novel';

  // Imagen del capítulo (si la tiene)
  const chImgHtml = ch.image
    ? `<div class="scene-image"><img src="${ch.image}" alt="Cap. ${ch.index}"><button class="btn btn-danger btn-rm-img" data-chapter="${ch.id}" title="Quitar imagen">✕</button></div>`
    : '';

  const scenesHtml = (ch.scenes || []).map(sc => {
    const imgHtml = sc.image
      ? `<div class="scene-image"><img src="${sc.image}" alt="Esc. ${sc.index}"><button class="btn btn-danger btn-rm-img" data-chapter="${ch.id}" data-scene="${sc.id}" title="Quitar imagen">✕</button></div>`
      : '';
    // Selector de personaje para usar su ficha como referencia en la escena
    const charOptions = characters
      .filter(c => c.portrait)
      .map(c => `<option value="${c.id}">${c.name}</option>`)
      .join('');
    const charSelect = charOptions
      ? `<select class="scene-char-ref" data-chapter="${ch.id}" data-scene="${sc.id}">
           <option value="">— sin personaje —</option>${charOptions}
         </select>`
      : '';
    return `
      <div class="scene-card">
        <h5>Esc. ${sc.index}: ${sc.title}</h5>
        <p>${sc.summary || 'Sin resumen'}</p>
        <div class="scene-content">${sc.content || ''}</div>
        ${isVN ? `
          <div class="scene-img-block">
            ${imgHtml}
            <div class="scene-img-actions">
              ${charSelect ? `<div class="scene-ref-row"><span>Referencia:</span>${charSelect}</div>` : ''}
              <button class="btn btn-secondary btn-gen-img" data-chapter="${ch.id}" data-scene="${sc.id}" data-label="Esc. ${sc.index}: ${sc.title}">🎨 Generar</button>
              <button class="btn btn-secondary btn-edit-img" data-chapter="${ch.id}" data-scene="${sc.id}" data-label="Esc. ${sc.index}: ${sc.title}" ${sc.image ? '' : 'disabled'}>✏️ Editar</button>
              <button class="btn btn-secondary btn-multi-img" data-chapter="${ch.id}" data-scene="${sc.id}" data-label="Esc. ${sc.index}: ${sc.title}">🎲 Generar 4</button>
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  detail.innerHTML = `
    <div class="chapter-detail-header">
      <h3>${ch.title}</h3>
      <p>${ch.summary || 'Sin resumen'}</p>
      ${isVN ? `
        <div class="scene-img-block">
          ${chImgHtml}
          <div class="scene-img-actions">
            <button class="btn btn-secondary btn-gen-img" data-chapter="${ch.id}" data-label="Cap. ${ch.index}: ${ch.title}">🎨 Generar portada</button>
            <button class="btn btn-secondary btn-edit-img" data-chapter="${ch.id}" data-label="Cap. ${ch.index}: ${ch.title}" ${ch.image ? '' : 'disabled'}>✏️ Editar</button>
          </div>
        </div>
      ` : ''}
    </div>
    <div class="scenes-list">${scenesHtml}</div>
  `;
  $('#modal-chapter').classList.add('open');
  bindSceneImgActions(ch);
}

// Vincula los botones de imagen de las escenas/capítulo del modal abierto.
function bindSceneImgActions(ch) {
  // Generar (una imagen)
  $$('.btn-gen-img').forEach(btn => {
    btn.addEventListener('click', () => {
      const label = btn.dataset.label;
      const prompt = prompt(`🎨 Prompt para generar la imagen de ${label}:\n(En blanco = usar el resumen de la escena)`, '');
      if (prompt === null) return;
      const finalPrompt = prompt.trim() || `${label} — ${ch.summary || ''}`.trim();
      generateSceneImage(btn.dataset.chapter, btn.dataset.scene || null, finalPrompt, 1);
    });
  });
  // Generar múltiple (4 variantes)
  $$('.btn-multi-img').forEach(btn => {
    btn.addEventListener('click', () => {
      const label = btn.dataset.label;
      const prompt = prompt(`🎲 Prompt para generar 4 variantes de ${label}:`, '');
      if (prompt === null) return;
      const finalPrompt = prompt.trim() || `${label} — ${ch.summary || ''}`.trim();
      generateSceneImage(btn.dataset.chapter, btn.dataset.scene || null, finalPrompt, 4);
    });
  });
  // Editar
  $$('.btn-edit-img').forEach(btn => {
    btn.addEventListener('click', () => {
      const label = btn.dataset.label;
      const prompt = prompt(`✏️ Prompt de edición para ${label}:`, '');
      if (prompt === null || !prompt.trim()) return;
      editSceneImage(btn.dataset.chapter, btn.dataset.scene || null, prompt.trim());
    });
  });
  // Quitar imagen
  $$('.btn-rm-img').forEach(btn => {
    btn.addEventListener('click', () => {
      removeSceneImage(btn.dataset.chapter, btn.dataset.scene || null);
    });
  });
}

// Genera imagen(s) con flux2 y las empareja con la escena/capítulo.
// Si hay un personaje con ficha seleccionado como referencia, usa el flujo
// multi-referencia de Flux 2 (POST /api/images/scene).
async function generateSceneImage(chapterId, sceneId, promptText, n) {
  if (!story) return;
  const btn = document.querySelector(`.btn-gen-img[data-chapter="${chapterId}"]${sceneId ? `[data-scene="${sceneId}"]` : ''}`);
  const orig = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Generando...'; }
  try {
    // Personaje de referencia seleccionado para esta escena
    const refSel = document.querySelector(`.scene-char-ref[data-chapter="${chapterId}"]${sceneId ? `[data-scene="${sceneId}"]` : ''}`);
    const characterId = refSel ? refSel.value : '';

    let data;
    if (characterId && n === 1) {
      // Flujo multi-referencia con la ficha del personaje
      data = await api('/images/scene', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyId: story.id, characterId, chapterId, sceneId, prompt: promptText })
      });
      story = data.story || story;
      toast('✅ Escena generada con la ficha del personaje', 'success');
    } else {
      // T2I puro (sin referencia) o variantes múltiples
      data = await api('/images/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: promptText, storyId: story.id, n, chapterId, sceneId })
      });
      story = data.story || story;
      const urls = data.images || [];
      if (urls.length === 1) {
        toast('✅ Imagen generada y emparejada', 'success');
      } else {
        toast(`✅ ${urls.length} variantes generadas (la 1ª emparejada)`, 'success');
      }
    }
    // Recargar el capítulo para mostrar la imagen
    const ch = (story.chapters || []).find(c => c.id === chapterId);
    if (ch) openChapter(ch);
  } catch (err) {
    toast('⚠️ ' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = orig; }
  }
}

// Edita la imagen actual de la escena/capítulo con flux2-edit.
async function editSceneImage(chapterId, sceneId, promptText) {
  if (!story) return;
  const ch = (story.chapters || []).find(c => c.id === chapterId);
  if (!ch) return;
  const imageUrl = sceneId
    ? (ch.scenes || []).find(s => s.id === sceneId)?.image
    : ch.image;
  if (!imageUrl) { toast('No hay imagen para editar', 'error'); return; }
  try {
    const data = await api('/images/edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: promptText, imageUrl, storyId: story.id, chapterId, sceneId })
    });
    story = data.story || story;
    toast('✅ Imagen editada y emparejada', 'success');
    const ch2 = (story.chapters || []).find(c => c.id === chapterId);
    if (ch2) openChapter(ch2);
  } catch (err) {
    toast('⚠️ ' + err.message, 'error');
  }
}

// Quita la imagen de una escena/capítulo.
async function removeSceneImage(chapterId, sceneId) {
  if (!story) return;
  const ch = (story.chapters || []).find(c => c.id === chapterId);
  if (!ch) return;
  if (sceneId) {
    const sc = (ch.scenes || []).find(s => s.id === sceneId);
    if (sc) delete sc.image;
  } else {
    delete ch.image;
  }
  story.updatedAt = new Date().toISOString();
  try {
    const data = await api(`/story/${story.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chapters: story.chapters })
    });
    story = data.story;
    const ch2 = (story.chapters || []).find(c => c.id === chapterId);
    if (ch2) openChapter(ch2);
    toast('Imagen quitada', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

function initModals() {
  $('#btn-close-chapter').addEventListener('click', () => $('#modal-chapter').classList.remove('open'));
  // Cerrar al hacer click fuera
  $$('.modal-overlay').forEach(ov => {
    ov.addEventListener('click', (e) => {
      if (e.target === ov) ov.classList.remove('open');
    });
  });
}

// ===== CHAT GM =====
let chatHistory = [];

function initChat() {
  const input = $('#chat-input');
  const sendBtn = $('#chat-send');

  async function send() {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    appendChatMsg('user', text);
    chatHistory.push({ role: 'user', content: text });

    const typing = appendChatMsg('bot', '…', true);
    sendBtn.disabled = true;
    try {
      const data = await api('/gm/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: chatHistory.slice(0, -1) })
      });
      typing.querySelector('.chat-bubble').textContent = data.reply || '(sin respuesta)';
      chatHistory.push({ role: 'assistant', content: data.reply || '' });
      // Actualizar la etiqueta de contexto con la historia activa
      if (data.storyId) {
        const s = stories.find(x => x.id === data.storyId);
        if (s) $('#chat-context-label').textContent = `Asistente con contexto de: ${s.title}`;
      }
      // Si el LLM ejecutó acciones sobre el juego, refrescar la UI para reflejarlas
      if (data.actions && data.actions.length > 0) {
        const changed = data.actions.some(a => a.ok);
        if (changed) {
          await loadStory();
          await loadCharacters();
          await loadEquipment();
          toast(`⚙️ ${data.actions.length} acción(es) ejecutada(s) sobre el juego`, 'success');
        }
      }
    } catch (err) {
      typing.querySelector('.chat-bubble').textContent = `⚠️ Error: ${err.message}`;
    } finally {
      sendBtn.disabled = false;
      scrollChat();
    }
  }

  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
}

function appendChatMsg(role, text, typing = false) {
  const wrap = document.createElement('div');
  wrap.className = `chat-msg chat-msg-${role}`;
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';
  if (typing) bubble.classList.add('typing');
  bubble.textContent = text;
  wrap.appendChild(bubble);
  $('#chat-messages').appendChild(wrap);
  scrollChat();
  return wrap;
}

function scrollChat() {
  const box = $('#chat-messages');
  box.scrollTop = box.scrollHeight;
}

// Registrar el chat en la inicialización
document.addEventListener('DOMContentLoaded', () => {
  initChat();
});
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.btn-suggest');
  if (!btn) return;
  const kind = btn.dataset.kind;
  const target = btn.dataset.target;

  let context = '';
  if (kind === 'name') context = `raza: ${$('#char-race').value}, clase: ${$('#char-class').value}`;
  if (kind === 'description') context = `personaje: ${$('#char-name').value}, raza: ${$('#char-race').value}, clase: ${$('#char-class').value}`;
  if (kind === 'stats') context = `personaje nivel ${$('#stat-level').value}, raza: ${$('#char-race').value}`;

  try {
    btn.disabled = true;
    btn.textContent = '⏳';
    const data = await api('/gm/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, context })
    });

    if (kind === 'stats' && typeof data.suggestion === 'object') {
      const s = data.suggestion;
      if (s.level !== undefined) $('#stat-level').value = s.level;
      if (s.hp !== undefined) { $('#stat-hp').value = s.hp; }
      if (s.mp !== undefined) { $('#stat-mp').value = s.mp; }
      if (s.str !== undefined) $('#stat-str').value = s.str;
      if (s.vit !== undefined) $('#stat-vit').value = s.vit;
      if (s.agi !== undefined) $('#stat-agi').value = s.agi;
      if (s.dex !== undefined) $('#stat-dex').value = s.dex;
      if (s.int !== undefined) $('#stat-int').value = s.int;
      if (s.luck !== undefined) $('#stat-luck').value = s.luck;
      toast('Stats sugeridos aplicados', 'success');
    } else {
      const val = typeof data.suggestion === 'string' ? data.suggestion : JSON.stringify(data.suggestion);
      if (target) {
        const el = $(`#${target}`);
        if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
          el.value = val;
        }
      }
      toast('Sugerencia aplicada', 'success');
    }
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '💡';
  }
});

// ===== VOCES (configuración global de TTS) =====
let voices = [];
function initVoices() {
  $('#btn-new-voice').addEventListener('click', () => openVoiceModal());
  $('#btn-cancel-voice').addEventListener('click', closeVoiceModal);
  $('#btn-close-voice').addEventListener('click', closeVoiceModal);
  $('#form-voice').addEventListener('submit', handleSaveVoice);
}

async function loadVoices() {
  try {
    const data = await api('/voices');
    voices = data.voices || [];
    renderVoices();
    populateStoryDefaultVoice();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderVoices() {
  const list = $('#voices-list');
  const empty = $('#voices-empty');
  list.innerHTML = '';
  if (!voices.length) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  voices.forEach(v => {
    const card = document.createElement('div');
    card.className = 'card';
    const sampleInfo = v.sampleUrl || v.sampleBase64
      ? '<span class="badge badge-ok">🎵 sample</span>'
      : '<span class="badge">sin sample</span>';
    card.innerHTML = `
      <div class="card-header">
        <strong>🎙️ ${escapeHtml(v.name)}</strong>
        ${v.registered
          ? '<span class="badge badge-ok">✅ en Fish</span>'
          : (v.sampleUrl || v.sampleBase64
            ? '<span class="badge badge-ok">🎵 sample</span>'
            : '<span class="badge">sin sample</span>')}
      </div>
      ${v.slug ? `<p class="muted" style="font-size:0.8rem;">Slug: <code>${escapeHtml(v.slug)}</code></p>` : ''}
      ${v.seiyu ? `<p class="muted" style="font-size:0.85rem;">Seiyu: ${escapeHtml(v.seiyu)}</p>` : ''}
      ${v.description ? `<p class="muted" style="font-size:0.85rem;">${escapeHtml(v.description)}</p>` : ''}
      <div class="card-actions">
        <button class="btn btn-sm btn-ghost btn-sample-voice" data-id="${v.id}">🔊 Sample</button>
        ${v.sampleUrl || v.sampleBase64 ? `
          <button class="btn btn-sm btn-primary btn-reg-voice" data-id="${v.id}">${v.registered ? '🔄 Re-registrar' : '📤 Registrar en Fish'}</button>
        ` : ''}
        <button class="btn btn-sm btn-ghost btn-edit-voice" data-id="${v.id}">✏️ Editar</button>
        <button class="btn btn-sm btn-danger btn-del-voice" data-id="${v.id}">🗑️</button>
      </div>
    `;
    list.appendChild(card);
  });
  $$('.btn-edit-voice').forEach(b => b.addEventListener('click', () => openVoiceModal(b.dataset.id)));
  $$('.btn-del-voice').forEach(b => b.addEventListener('click', () => deleteVoice(b.dataset.id)));
  $$('.btn-reg-voice').forEach(b => b.addEventListener('click', () => registerVoice(b.dataset.id, b)));
  $$('.btn-sample-voice').forEach(b => b.addEventListener('click', () => sampleVoice(b.dataset.id, b)));
}

function openVoiceModal(id = null) {
  const v = id ? voices.find(x => x.id === id) : null;
  $('#modal-voice-title').textContent = v ? `Editar: ${v.name}` : 'Nueva voz';
  $('#voice-id').value = v?.id || '';
  $('#voice-name').value = v?.name || '';
  $('#voice-slug').value = v?.slug || '';
  $('#voice-seiyu').value = v?.seiyu || '';
  $('#voice-sample-url').value = v?.sampleUrl || '';
  $('#voice-sample-b64').value = v?.sampleBase64 || '';
  $('#voice-ref-text').value = v?.refText || '';
  $('#voice-description').value = v?.description || '';
  $('#modal-voice').classList.add('open');
}

function closeVoiceModal() {
  $('#modal-voice').classList.remove('open');
  $('#form-voice').reset();
}

async function handleSaveVoice(e) {
  e.preventDefault();
  const id = $('#voice-id').value;
  const payload = {
    name: $('#voice-name').value,
    slug: $('#voice-slug').value,
    seiyu: $('#voice-seiyu').value,
    sampleUrl: $('#voice-sample-url').value,
    sampleBase64: $('#voice-sample-b64').value,
    refText: $('#voice-ref-text').value,
    description: $('#voice-description').value
  };
  try {
    if (id) {
      await api(`/voices/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      toast('Voz actualizada', 'success');
    } else {
      await api('/voices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      toast('Voz creada', 'success');
    }
    closeVoiceModal();
    await loadVoices();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function deleteVoice(id) {
  if (!confirm('¿Eliminar esta voz?')) return;
  try {
    await api(`/voices/${id}`, { method: 'DELETE' });
    toast('Voz eliminada', 'success');
    await loadVoices();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function registerVoice(id, btn) {
  const v = voices.find(x => x.id === id);
  if (!v) return;
  if (!v.sampleUrl && !v.sampleBase64) {
    toast('La voz necesita un sample para registrarse en Fish', 'error');
    return;
  }
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Registrando...';
  try {
    await api(`/voices/${id}/register`, { method: 'POST' });
    toast('Voz registrada en Fish ✔', 'success');
    await loadVoices();
  } catch (err) {
    toast('Error registrando: ' + err.message, 'error');
    btn.disabled = false;
    btn.textContent = original;
  }
}

// Reproduce un sample de la voz vía TTS para validarla.
let sampleAudio = null;
async function sampleVoice(id, btn) {
  const v = voices.find(x => x.id === id);
  if (!v) return;
  // Si ya está sonando esta voz, detenerla (toggle)
  if (sampleAudio && !sampleAudio.paused) {
    sampleAudio.pause();
    sampleAudio.currentTime = 0;
    sampleAudio = null;
    document.querySelectorAll('.btn-sample-voice').forEach(b => b.classList.remove('btn-sample-playing'));
    return;
  }
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Generando...';
  try {
    const data = await api('/vn/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: v.refText || `Hola, esta es la voz de ${v.name}.`,
        lang: 'es',
        voice: v.id
      })
    });
    if (!data.audio) throw new Error('No se recibió audio');
    const audio = new Audio(`data:${data.contentType || 'audio/wav'};base64,${data.audio}`);
    sampleAudio = audio;
    audio.play();
    document.querySelectorAll('.btn-sample-voice').forEach(b => b.classList.remove('btn-sample-playing'));
    btn.classList.add('btn-sample-playing');
    btn.textContent = '⏹ Detener';
    btn.disabled = false;
    audio.onended = () => {
      btn.textContent = original;
      btn.classList.remove('btn-sample-playing');
      sampleAudio = null;
    };
  } catch (err) {
    toast('Error sample: ' + err.message, 'error');
    btn.disabled = false;
    btn.textContent = original;
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

