// ===== Modo Novela Visual (estilo eroge) =====
// Se activa cuando la historia activa tiene gameType === 'visual_novel'.
// Layout estilo eroge: imagen de fondo arriba, caja de diálogo abajo.
// El texto del libro se divide en párrafos y se muestra UNO a la vez:
// el original (japonés) arriba y su traducción al español como subtítulo
// (vía /api/vn/translate con caché). Incluye menú de guardado/carga en
// slots (localStorage), modo auto y navegación por capítulos.
//
// API expuesta:
//   window.VN = { start(story), destroy(), advance(), sendAction(text) }

export function createVisualNovel() {
  let story = null;
  let chapterIdx = 0;
  let paraIdx = 0;      // índice del párrafo dentro de la escena actual
  let bgImages = [];
  let bgIdx = 0;
  let overlay = null;
  let nameEl = null;
  let jaEl = null;
  let esEl = null;
  let chapterEl = null;
  let saveMenuEl = null;
  let loadMenuEl = null;
  let thinkingEl = null;
  let translateCache = {}; // caché local de traducciones
  let autoMode = false;
  let autoTimer = null;
  let currentSpeaker = '';
  let autoVoice = 'none'; // 'none' | 'ja' | 'es' — voz a reproducir en autoplay
  const AUTO_VOICE_KEY = 'bookrpg_vn_autovoice';
  let ttsJaBtn = null;
  let ttsEsBtn = null;

  const SAVE_KEY = 'bookrpg_vn_saves';

  // ---- Utilidades ----
  function currentScene() {
    const ch = story.chapters[chapterIdx];
    if (!ch) return null;
    const scenes = ch.scenes || [];
    if (scenes.length > 0) return scenes[Math.min(0, scenes.length - 1)];
    return ch;
  }

  // Divide el texto de la escena en párrafos legibles
  function splitParagraphs(text) {
    if (!text) return [];
    return text
      .split(/\n{2,}/)            // separar por líneas en blanco
      .map(p => p.replace(/\s+/g, ' ').trim())
      .filter(p => p.length > 0);
  }

  function currentParagraphs() {
    const scene = currentScene();
    const text = (scene && (scene.content || scene.summary)) || '';
    return splitParagraphs(text);
  }

  function speakerName(para) {
    const m = para.match(/^「([^」]{1,20})」/);
    if (m) return m[1];
    return '';
  }

  function cleanDialogue(para) {
    return para.replace(/^「[^」]{1,20}」\s*/, '');
  }

  // Devuelve la voz del personaje que habla (por nombre), si está definida.
  // Si el personaje no tiene voz asignada, usa la voz por defecto de la historia.
  function voiceForSpeaker(name) {
    if (name) {
      const ch = characters.find(c => c.name && c.name.trim() === name.trim());
      if (ch && ch.voice) return ch.voice;
    }
    return (story && story.defaultVoice) || '';
  }

  // ---- Construcción del DOM ----
  function build() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.id = 'vn-overlay';
    overlay.innerHTML = `
      <div class="vn-bg" id="vn-bg"></div>
      <div class="vn-shade"></div>

      <!-- Barra superior -->
      <div class="vn-top">
        <div class="vn-chapter" id="vn-chapter"></div>
        <div class="vn-top-btns">
          <select class="vn-btn vn-btn-ghost vn-auto-voice" id="vn-auto-voice" title="Voz en autoplay">
            <option value="none">🔇 Sin voz</option>
            <option value="ja">🗣️ Voz JA</option>
            <option value="es">🗣️ Voz ES</option>
          </select>
          <button class="vn-btn vn-btn-ghost" id="vn-auto">⏩ Auto</button>
          <button class="vn-btn vn-btn-ghost" id="vn-save">💾 Guardar</button>
          <button class="vn-btn vn-btn-ghost" id="vn-load">📂 Cargar</button>
          <button class="vn-btn vn-btn-ghost" id="vn-exit">✕ Salir</button>
        </div>
      </div>

      <!-- Zona de imagen (arriba) -->
      <div class="vn-stage" id="vn-stage">
        <div class="vn-stage-title" id="vn-stage-title"></div>
        <div class="vn-stage-progress" id="vn-progress"></div>
      </div>

      <!-- Caja de diálogo (abajo) -->
      <div class="vn-dialog" id="vn-dialog">
        <div class="vn-name" id="vn-name"></div>
        <div class="vn-dialog-text">
          <div class="vn-line">
            <div class="vn-ja" id="vn-ja"></div>
            <button class="vn-tts-btn" id="vn-tts-ja" title="Escuchar original (JA)">🔊</button>
          </div>
          <div class="vn-line">
            <div class="vn-es" id="vn-es"></div>
            <button class="vn-tts-btn" id="vn-tts-es" title="Escuchar traducción (ES)">🔊</button>
          </div>
        </div>
        <div class="vn-dialog-actions">
          <button class="vn-btn" id="vn-prev">⬅</button>
          <button class="vn-btn vn-btn-primary" id="vn-next">Siguiente ➡</button>
          <button class="vn-btn" id="vn-action-btn">✎ Acción</button>
        </div>
        <div class="vn-input-row hidden" id="vn-input-row">
          <input id="vn-input" type="text" placeholder="Acción libre para el GM..." autocomplete="off">
          <button class="vn-btn vn-btn-primary" id="vn-send">➤</button>
        </div>
      </div>

      <!-- Menú de guardado / carga -->
      <div class="vn-menu hidden" id="vn-save-menu">
        <div class="vn-menu-title">💾 Guardar partida</div>
        <div class="vn-slots" id="vn-save-slots"></div>
        <button class="vn-btn vn-btn-ghost vn-menu-close" data-close="save">Cerrar</button>
      </div>
      <div class="vn-menu hidden" id="vn-load-menu">
        <div class="vn-menu-title">📂 Cargar partida</div>
        <div class="vn-slots" id="vn-load-slots"></div>
        <button class="vn-btn vn-btn-ghost vn-menu-close" data-close="load">Cerrar</button>
      </div>

      <div class="vn-thinking" id="vn-thinking"><div class="vn-spinner"></div><span>Traduciendo / consultando al GM...</span></div>
    `;
    document.body.appendChild(overlay);

    nameEl = overlay.querySelector('#vn-name');
    jaEl = overlay.querySelector('#vn-ja');
    esEl = overlay.querySelector('#vn-es');
    const ttsJaBtnLocal = overlay.querySelector('#vn-tts-ja');
    const ttsEsBtnLocal = overlay.querySelector('#vn-tts-es');
    ttsJaBtn = ttsJaBtnLocal;
    ttsEsBtn = ttsEsBtnLocal;
    chapterEl = overlay.querySelector('#vn-chapter');
    saveMenuEl = overlay.querySelector('#vn-save-menu');
    loadMenuEl = overlay.querySelector('#vn-load-menu');
    thinkingEl = overlay.querySelector('#vn-thinking');

    // Navegación
    overlay.querySelector('#vn-next').addEventListener('click', () => advance());
    overlay.querySelector('#vn-prev').addEventListener('click', () => prev());
    overlay.querySelector('#vn-auto').addEventListener('click', toggleAuto);
    const autoVoiceSel = overlay.querySelector('#vn-auto-voice');
    autoVoiceSel.value = autoVoice;
    autoVoiceSel.addEventListener('change', () => {
      autoVoice = autoVoiceSel.value;
      try { localStorage.setItem(AUTO_VOICE_KEY, autoVoice); } catch (e) {}
    });
    overlay.querySelector('#vn-save').addEventListener('click', () => openMenu('save'));
    overlay.querySelector('#vn-load').addEventListener('click', () => openMenu('load'));
    overlay.querySelector('#vn-exit').addEventListener('click', () => {
      if (confirm('¿Salir de la novela visual?')) destroy();
    });
    overlay.querySelector('#vn-action-btn').addEventListener('click', () => {
      overlay.querySelector('#vn-input-row').classList.toggle('hidden');
    });
    overlay.querySelector('#vn-send').addEventListener('click', () => {
      const inp = overlay.querySelector('#vn-input');
      if (inp.value.trim()) sendAction(inp.value);
    });
    // TTS: escuchar el texto original (JA) o el traducido (ES)
    ttsJaBtn.addEventListener('click', () => {
      const text = cleanDialogue(jaEl.textContent || '');
      speak(text, 'ja', ttsJaBtn, voiceForSpeaker(currentSpeaker));
    });
    ttsEsBtn.addEventListener('click', () => {
      const text = esEl.textContent || '';
      if (text && text !== '…') speak(text, 'es', ttsEsBtn, voiceForSpeaker(currentSpeaker));
    });
    overlay.querySelector('#vn-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const inp = overlay.querySelector('#vn-input');
        if (inp.value.trim()) sendAction(inp.value);
      }
    });
    // Cerrar menús
    overlay.querySelectorAll('.vn-menu-close').forEach((b) => {
      b.addEventListener('click', () => closeMenus());
    });
    // Click en la caja de diálogo → avanzar
    overlay.querySelector('#vn-dialog').addEventListener('click', (e) => {
      if (e.target.closest('button') || e.target.closest('input')) return;
      if (thinkingEl.style.display === 'flex') return;
      advance();
    });
    // Teclado
    document.addEventListener('keydown', vnKeyHandler);
  }

  function vnKeyHandler(e) {
    if (!overlay || overlay.style.display === 'none') return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (thinkingEl.style.display === 'flex') return;
      advance();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      prev();
    }
  }

  function setBg() {
    const bg = overlay.querySelector('#vn-bg');
    // Imagen emparejada de la escena/capítulo actual (si existe), si no las del epub
    const ch = story.chapters[chapterIdx];
    const scene = currentScene();
    const sceneImg = (scene && scene.image) || (ch && ch.image) || null;
    const src = sceneImg || (bgImages.length > 0 ? bgImages[bgIdx % bgImages.length] : null);
    if (src) {
      bg.style.backgroundImage = `url(${src})`;
      bg.style.display = 'block';
    } else {
      bg.style.backgroundImage = '';
      bg.style.display = 'none';
    }
  }

  // ---- TTS (fish-speech) ----
  let currentAudio = null;
  let characters = []; // personajes de la historia activa (para la voz)
  let audioCache = {}; // caché de audio generado: key -> {base64, contentType}
  function audioKey(text, lang, voice) {
    return `${lang}|${voice || ''}|${text.slice(0, 200)}`;
  }
  // Obtiene el audio (con caché) sin reproducirlo. Devuelve {base64, contentType} o null.
  async function fetchAudio(text, lang, voice) {
    if (!text || !text.trim()) return null;
    const key = audioKey(text, lang, voice);
    if (audioCache[key]) return audioCache[key];
    try {
      const res = await fetch('/api/vn/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, lang, voice: voice || '' })
      });
      const data = await res.json();
      if (data.error) {
        showToast('⚠️ TTS: ' + data.error);
        return null;
      }
      const entry = { base64: data.audio, contentType: data.contentType || 'audio/wav' };
      audioCache[key] = entry;
      return entry;
    } catch (err) {
      console.error('Error TTS:', err);
      return null;
    }
  }
  async function speak(text, lang, btn, voice) {
    if (!text || !text.trim()) return;
    // Si ya está sonando este botón, lo detenemos
    if (currentAudio && !currentAudio.paused) {
      currentAudio.pause();
      currentAudio = null;
      btn.classList.remove('vn-tts-playing');
      return;
    }
    btn.classList.add('vn-tts-playing');
    const entry = await fetchAudio(text, lang, voice);
    if (!entry) {
      btn.classList.remove('vn-tts-playing');
      return;
    }
    const audio = new Audio(`data:${entry.contentType};base64,${entry.base64}`);
    currentAudio = audio;
    audio.onended = () => {
      currentAudio = null;
      btn.classList.remove('vn-tts-playing');
    };
    audio.onerror = () => {
      currentAudio = null;
      btn.classList.remove('vn-tts-playing');
      showToast('⚠️ No se pudo reproducir el audio');
    };
    try {
      await audio.play();
    } catch (err) {
      console.error('Error reproduciendo:', err);
      btn.classList.remove('vn-tts-playing');
    }
  }

  // ---- Traducción ----
  async function translate(text) {
    if (!text || !text.trim()) return '';
    const key = text.trim().slice(0, 3000);
    if (translateCache[key]) return translateCache[key];
    setThinking(true);
    try {
      const res = await fetch('/api/vn/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: key })
      });
      const data = await res.json();
      const t = data.translation || '';
      translateCache[key] = t;
      return t;
    } catch (err) {
      console.error('Error traduciendo:', err);
      return '';
    } finally {
      setThinking(false);
    }
  }

  // ---- Render ----
  async function render() {
    const ch = story.chapters[chapterIdx];
    if (!ch) return;
    const paras = currentParagraphs();
    if (paras.length === 0) return;
    paraIdx = Math.min(paraIdx, paras.length - 1);
    const para = paras[paraIdx];

    chapterEl.textContent = `第${ch.index}章 · ${ch.title}`;
    overlay.querySelector('#vn-stage-title').textContent = ch.title || '';
    overlay.querySelector('#vn-progress').textContent = `${paraIdx + 1} / ${paras.length}`;
    nameEl.textContent = speakerName(para) || '';
    currentSpeaker = speakerName(para) || '';
    jaEl.textContent = cleanDialogue(para);
    esEl.textContent = '…';
    setBg();
    // Traducir en segundo plano
    const t = await translate(cleanDialogue(para));
    esEl.textContent = t || '';
    updateNavButtons();
    // Pre-cargar la traducción/audio del siguiente diálogo (en background)
    prefetchNext();
    // Autoplay: reproducir la voz automáticamente y ESPERAR a que termine
    if (autoMode && autoVoice !== 'none') {
      await playAutoVoice();
    }
  }

  // Reproduce la voz automática del diálogo actual según autoVoice ('ja' | 'es').
  // Devuelve una promesa que resuelve cuando el audio termina (o falla).
  function playAutoVoice() {
    return new Promise((resolve) => {
      if (!ttsJaBtn || !ttsEsBtn) return resolve();
      const voice = voiceForSpeaker(currentSpeaker);
      let text = '';
      let lang = '';
      let btn = null;
      if (autoVoice === 'ja') {
        text = cleanDialogue(jaEl.textContent || '');
        lang = 'ja';
        btn = ttsJaBtn;
      } else if (autoVoice === 'es') {
        text = esEl.textContent || '';
        lang = 'es';
        btn = ttsEsBtn;
        if (!text || text === '…') return resolve();
      }
      if (!text) return resolve();
      speakAuto(text, lang, btn, voice).then(resolve);
    });
  }

  // Como speak pero pensado para autoplay: resuelve al terminar el audio.
  function speakAuto(text, lang, btn, voice) {
    return new Promise(async (resolve) => {
      const entry = await fetchAudio(text, lang, voice);
      if (!entry) return resolve();
      const audio = new Audio(`data:${entry.contentType};base64,${entry.base64}`);
      currentAudio = audio;
      btn.classList.add('vn-tts-playing');
      const done = () => {
        currentAudio = null;
        btn.classList.remove('vn-tts-playing');
        resolve();
      };
      audio.onended = done;
      audio.onerror = done;
      try {
        await audio.play();
      } catch (err) {
        done();
      }
    });
  }

  // Pre-carga (en background) la traducción y el audio del siguiente párrafo
  // para que el autoplay no tenga esperas al avanzar.
  async function prefetchNext() {
    const paras = currentParagraphs();
    let nextPara = null;
    if (paraIdx < paras.length - 1) {
      nextPara = paras[paraIdx + 1];
    } else if (chapterIdx < story.chapters.length - 1) {
      const nextCh = story.chapters[chapterIdx + 1];
      const nextScenes = nextCh.scenes || [];
      const nextScene = nextScenes.length > 0 ? nextScenes[0] : nextCh;
      const nextText = (nextScene && (nextScene.content || nextScene.summary)) || '';
      nextPara = splitParagraphs(nextText)[0];
    }
    if (!nextPara) return;
    const nextClean = cleanDialogue(nextPara);
    const nextSpeaker = speakerName(nextPara);
    const voice = voiceForSpeaker(nextSpeaker);
    if (autoVoice === 'ja') {
      // Pre-cargar audio JA directamente
      fetchAudio(nextClean, 'ja', voice);
    } else if (autoVoice === 'es') {
      // El audio ES depende de la traducción: esperar a que esté lista
      const t = await translate(nextClean);
      if (t && t !== '…') fetchAudio(t, 'es', voice);
    } else {
      // Sin voz: pre-cargar solo la traducción para que se muestre al instante
      translate(nextClean);
    }
  }

  function updateNavButtons() {
    const next = overlay.querySelector('#vn-next');
    const prev = overlay.querySelector('#vn-prev');
    const paras = currentParagraphs();
    const isLastPara = paraIdx >= paras.length - 1;
    const isLastChapter = chapterIdx >= story.chapters.length - 1;
    next.textContent = (isLastPara && isLastChapter) ? 'Fin' : 'Siguiente ➡';
    prev.disabled = chapterIdx === 0 && paraIdx === 0;
  }

  async function advance() {
    const paras = currentParagraphs();
    if (paraIdx < paras.length - 1) {
      paraIdx++;
    } else if (chapterIdx < story.chapters.length - 1) {
      chapterIdx++;
      paraIdx = 0;
    } else {
      showToast('🏁 Fin del libro');
      return;
    }
    // Espera a que render (y su voz automática) terminen
    await render();
  }

  function prev() {
    if (paraIdx > 0) {
      paraIdx--;
    } else if (chapterIdx > 0) {
      chapterIdx--;
      paraIdx = currentParagraphs().length - 1;
    } else {
      return;
    }
    render();
  }

  // ---- Auto ----
  function toggleAuto() {
    autoMode = !autoMode;
    const btn = overlay.querySelector('#vn-auto');
    btn.textContent = autoMode ? '⏸ Pausa' : '⏩ Auto';
    btn.classList.toggle('vn-active', autoMode);
    if (autoMode) {
      // Bucle de autoplay: avanza respetando el fin de la voz.
      // Si hay voz configurada, espera a que termine; si no, usa un intervalo base.
      scheduleAuto();
    } else if (autoTimer) {
      clearTimeout(autoTimer);
      autoTimer = null;
    }
  }

  // Programa el siguiente avance del autoplay.
  // El avance (advance) ya espera a que termine la voz del diálogo actual,
  // así que aquí solo encadenamos el siguiente paso tras completarse.
  function scheduleAuto() {
    if (!autoMode) return;
    const delay = (autoVoice !== 'none') ? 600 : 4000;
    autoTimer = setTimeout(async () => {
      if (thinkingEl.style.display === 'flex') {
        scheduleAuto();
        return;
      }
      if (!autoMode) return;
      await advance(); // espera a render + voz
      scheduleAuto();
    }, delay);
  }

  // ---- Guardado / Carga (slots en localStorage) ----
  function getSaves() {
    try {
      return JSON.parse(localStorage.getItem(SAVE_KEY)) || {};
    } catch {
      return {};
    }
  }
  function setSaves(saves) {
    localStorage.setItem(SAVE_KEY, JSON.stringify(saves));
  }

  function openMenu(type) {
    closeMenus();
    const menu = type === 'save' ? saveMenuEl : loadMenuEl;
    const slotsEl = menu.querySelector('.vn-slots');
    slotsEl.innerHTML = '';
    const saves = getSaves();
    for (let i = 1; i <= 6; i++) {
      const slot = document.createElement('div');
      slot.className = 'vn-slot';
      const data = saves[i];
      const label = data
        ? `Slot ${i} — ${data.chapterTitle || ''} · párrafo ${(data.paraIdx || 0) + 1}`
        : `Slot ${i} — Vacío`;
      slot.innerHTML = `<span class="vn-slot-label">${label}</span>`;
      if (type === 'save') {
        slot.addEventListener('click', () => {
          const ch = story.chapters[chapterIdx];
          saves[i] = {
            chapterIdx, paraIdx, bgIdx,
            chapterTitle: ch ? `第${ch.index}章 ${ch.title}` : '',
            savedAt: new Date().toISOString()
          };
          setSaves(saves);
          showToast(`💾 Guardado en Slot ${i}`);
          closeMenus();
        });
      } else {
        if (data) {
          slot.classList.add('vn-slot-filled');
          slot.addEventListener('click', () => {
            chapterIdx = data.chapterIdx || 0;
            paraIdx = data.paraIdx || 0;
            bgIdx = data.bgIdx || 0;
            closeMenus();
            render();
            showToast(`📂 Cargado Slot ${i}`);
          });
        } else {
          slot.classList.add('vn-slot-empty');
        }
      }
      slotsEl.appendChild(slot);
    }
    menu.classList.remove('hidden');
  }

  function closeMenus() {
    saveMenuEl.classList.add('hidden');
    loadMenuEl.classList.add('hidden');
  }

  function showToast(msg) {
    let toast = overlay.querySelector('.vn-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'vn-toast';
      overlay.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2000);
  }

  function setThinking(on) {
    thinkingEl.style.display = on ? 'flex' : 'none';
  }

  // ---- Acción libre al GM ----
  async function sendAction(text) {
    if (!text || !text.trim()) return;
    const inp = overlay.querySelector('#vn-input');
    inp.value = '';
    overlay.querySelector('#vn-input-row').classList.add('hidden');
    showToast('🧑 ' + text);
    setThinking(true);
    try {
      const res = await fetch('/api/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: text })
      });
      const data = await res.json();
      if (data.error) {
        showToast('⚠️ ' + data.error);
      } else {
        showToast('📖 ' + (data.narrative || '(sin respuesta)'));
      }
    } catch (err) {
      showToast('⚠️ Error de conexión');
    } finally {
      setThinking(false);
    }
  }

  // ---- API pública ----
  function start(storyData) {
    story = storyData;
    chapterIdx = 0;
    paraIdx = 0;
    bgImages = (story.images || []).slice();
    bgIdx = 0;
    // Cargar preferencia de voz en autoplay
    try {
      const saved = localStorage.getItem(AUTO_VOICE_KEY);
      if (saved === 'ja' || saved === 'es' || saved === 'none') autoVoice = saved;
    } catch (e) {}
    // Cargar personajes de la historia activa (para usar su voz en el TTS)
    fetch('/api/characters').then(r => r.json()).then(d => {
      characters = (d.characters || []).slice();
    }).catch(() => { characters = []; });
    build();
    overlay.style.display = 'flex';
    render();
  }

  function destroy() {
    if (autoTimer) clearInterval(autoTimer);
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
    document.removeEventListener('keydown', vnKeyHandler);
  }

  return { start, destroy, advance, sendAction };
}
