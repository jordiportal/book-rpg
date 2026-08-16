// ===== Modo Novela Visual =====
// Se activa cuando la historia activa tiene gameType === 'visual_novel'.
// En lugar del mundo 3D, muestra una interfaz de novela visual que sigue el
// texto del libro (capítulos/escenas) directamente, con fondo de las imágenes
// del epub y acciones puntuales al Game Master. Requiere menos LLM que el
// mundo abierto: el texto viene del libro, no se genera.
//
// API expuesta:
//   window.VN = { start(story), advance(), choose(option), sendAction(text), destroy() }

export function createVisualNovel() {
  let story = null;
  let chapterIdx = 0;
  let sceneIdx = 0;
  let bgImages = [];
  let bgIdx = 0;
  let overlay = null;
  let textEl = null;
  let titleEl = null;
  let chapterEl = null;
  let optionsEl = null;
  let inputEl = null;
  let sendBtn = null;
  let thinkingEl = null;
  let history = []; // historial de texto mostrado
  let autoScroll = true;

  function build() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.id = 'vn-overlay';
    overlay.innerHTML = `
      <div class="vn-bg" id="vn-bg"></div>
      <div class="vn-shade"></div>
      <div class="vn-top">
        <div class="vn-chapter" id="vn-chapter"></div>
        <button class="vn-btn vn-btn-ghost" id="vn-exit">✕ Salir</button>
      </div>
      <div class="vn-content">
        <div class="vn-title" id="vn-title"></div>
        <div class="vn-scroll" id="vn-scroll">
          <div class="vn-text" id="vn-text"></div>
        </div>
        <div class="vn-options" id="vn-options"></div>
        <div class="vn-input-row">
          <input id="vn-input" type="text" placeholder="Acción libre (opcional)..." autocomplete="off">
          <button class="vn-btn" id="vn-send">➤</button>
        </div>
        <div class="vn-hint">Click / Enter para avanzar · escribe una acción para pedir al GM</div>
      </div>
      <div class="vn-thinking" id="vn-thinking"><div class="vn-spinner"></div><span>El Game Master está respondiendo...</span></div>
    `;
    document.body.appendChild(overlay);

    textEl = overlay.querySelector('#vn-text');
    titleEl = overlay.querySelector('#vn-title');
    chapterEl = overlay.querySelector('#vn-chapter');
    optionsEl = overlay.querySelector('#vn-options');
    inputEl = overlay.querySelector('#vn-input');
    sendBtn = overlay.querySelector('#vn-send');
    thinkingEl = overlay.querySelector('#vn-thinking');
    const scrollEl = overlay.querySelector('#vn-scroll');

    // Click en el área de texto → avanzar
    overlay.querySelector('#vn-scroll').addEventListener('click', () => {
      if (thinkingEl.style.display === 'flex') return;
      advance();
    });
    // Enter en input → enviar acción (o avanzar si vacío)
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (inputEl.value.trim()) sendAction(inputEl.value);
        else advance();
      }
    });
    sendBtn.addEventListener('click', () => {
      if (inputEl.value.trim()) sendAction(inputEl.value);
      else advance();
    });
    overlay.querySelector('#vn-exit').addEventListener('click', () => {
      if (confirm('¿Salir de la novela visual?')) destroy();
    });
    // Tecla espacio/Enter global → avanzar
    document.addEventListener('keydown', vnKeyHandler);
  }

  function vnKeyHandler(e) {
    if (!overlay || overlay.style.display === 'none') return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (thinkingEl.style.display === 'flex') return;
      advance();
    }
  }

  function setBg() {
    const bg = overlay.querySelector('#vn-bg');
    if (bgImages.length > 0) {
      const src = bgImages[bgIdx % bgImages.length];
      bg.style.backgroundImage = `url(${src})`;
      bg.style.display = 'block';
    } else {
      bg.style.backgroundImage = '';
      bg.style.display = 'none';
    }
  }

  function currentScene() {
    const ch = story.chapters[chapterIdx];
    if (!ch) return null;
    const scenes = ch.scenes || [];
    if (scenes.length > 0) return scenes[Math.min(sceneIdx, scenes.length - 1)];
    return ch; // capítulo sin escenas: usar el propio capítulo
  }

  function render() {
    const ch = story.chapters[chapterIdx];
    if (!ch) return;
    const scene = currentScene();
    const text = (scene && (scene.content || scene.summary)) || ch.content || ch.summary || '';
    chapterEl.textContent = `Capítulo ${ch.index}: ${ch.title}`;
    titleEl.textContent = story.title || '';
    textEl.textContent = text;
    // Mostrar resumen del capítulo como cabecera de escena
    if (scene && scene !== ch && scene.summary && scene.summary !== 'Texto completo') {
      // añadir el resumen como párrafo introductorio
    }
    setBg();
    // Scroll al inicio
    const scrollEl = overlay.querySelector('#vn-scroll');
    scrollEl.scrollTop = 0;
    // Botones de navegación de capítulo
    renderNav();
  }

  function renderNav() {
    optionsEl.innerHTML = '';
    const prevBtn = document.createElement('button');
    prevBtn.className = 'vn-btn';
    prevBtn.textContent = '⬅ Capítulo anterior';
    prevBtn.disabled = chapterIdx <= 0;
    prevBtn.addEventListener('click', () => { chapterIdx = Math.max(0, chapterIdx - 1); sceneIdx = 0; render(); });
    optionsEl.appendChild(prevBtn);

    const nextBtn = document.createElement('button');
    nextBtn.className = 'vn-btn vn-btn-primary';
    nextBtn.textContent = 'Capítulo siguiente ➡';
    nextBtn.disabled = chapterIdx >= story.chapters.length - 1;
    nextBtn.addEventListener('click', () => { chapterIdx = Math.min(story.chapters.length - 1, chapterIdx + 1); sceneIdx = 0; render(); });
    optionsEl.appendChild(nextBtn);

    // Si hay escenas, navegación de escena
    const ch = story.chapters[chapterIdx];
    if (ch && (ch.scenes || []).length > 1) {
      const sceneNav = document.createElement('div');
      sceneNav.className = 'vn-scene-nav';
      const prevScene = document.createElement('button');
      prevScene.className = 'vn-btn';
      prevScene.textContent = '⬅ Escena';
      prevScene.disabled = sceneIdx <= 0;
      prevScene.addEventListener('click', () => { sceneIdx = Math.max(0, sceneIdx - 1); render(); });
      sceneNav.appendChild(prevScene);
      const nextScene = document.createElement('button');
      nextScene.className = 'vn-btn';
      nextScene.textContent = 'Escena ➡';
      nextScene.disabled = sceneIdx >= (ch.scenes || []).length - 1;
      nextScene.addEventListener('click', () => { sceneIdx = Math.min((ch.scenes || []).length - 1, sceneIdx + 1); render(); });
      sceneNav.appendChild(nextScene);
      optionsEl.appendChild(sceneNav);
    }
  }

  function advance() {
    // Avanzar: si hay escenas, pasar a la siguiente; si no, siguiente capítulo
    const ch = story.chapters[chapterIdx];
    if (!ch) return;
    const scenes = ch.scenes || [];
    if (scenes.length > 0 && sceneIdx < scenes.length - 1) {
      sceneIdx++;
    } else if (chapterIdx < story.chapters.length - 1) {
      chapterIdx++;
      sceneIdx = 0;
    } else {
      addLine('— Fin del libro —');
      return;
    }
    render();
  }

  function addLine(text) {
    const p = document.createElement('div');
    p.className = 'vn-line';
    p.textContent = text;
    textEl.appendChild(p);
    const scrollEl = overlay.querySelector('#vn-scroll');
    scrollEl.scrollTop = scrollEl.scrollHeight;
  }

  function setThinking(on) {
    thinkingEl.style.display = on ? 'flex' : 'none';
    sendBtn.disabled = on;
  }

  async function sendAction(text) {
    if (!text || !text.trim()) return;
    addLine('🧑 ' + text);
    inputEl.value = '';
    setThinking(true);
    try {
      const res = await fetch('/api/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: text })
      });
      const data = await res.json();
      if (data.error) {
        addLine('⚠️ ' + data.error);
      } else {
        addLine('📖 ' + (data.narrative || '(sin respuesta)'));
        if (data.mechanics) {
          const m = data.mechanics;
          const parts = [];
          if (m.exp) parts.push(`+${m.exp} EXP`);
          if (m.money) parts.push(`${m.money > 0 ? '+' : ''}${m.money} ナール`);
          if (parts.length) addLine('📊 ' + parts.join(' · '));
        }
      }
    } catch (err) {
      addLine('⚠️ Error de conexión: ' + err.message);
    } finally {
      setThinking(false);
    }
  }

  function start(storyData) {
    story = storyData;
    chapterIdx = 0;
    sceneIdx = 0;
    bgImages = (story.images || []).slice();
    bgIdx = 0;
    build();
    overlay.style.display = 'flex';
    render();
    addLine('📖 Modo novela visual. Haz click o pulsa Enter para avanzar por el libro.');
  }

  function destroy() {
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
    document.removeEventListener('keydown', vnKeyHandler);
  }

  return { start, advance, sendAction, destroy };
}
