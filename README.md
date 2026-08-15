# Book-RPG — RPG de mundo abierto guiado por LLM

RPG de mundo abierto en 3D (Three.js) cuyo contenido se **genera dinámicamente** a partir de una historia, dirigido por un Game Master LLM. Basado en la novela japonesa *異世界迷宮でハーレムを* (Harem in the Labyrinth of Another World).

## Características

- **Mundo 3D** en el navegador con Three.js (cámara en tercera persona, WASD + Q/E para orbitar).
- **Game Master LLM**: narración inmersiva en español con bloque mecánico JSON.
- **Generador dinámico de zonas**: el LLM genera estancias, NPCs, monstruos y objetos a partir del contexto del libro (RAG), y el resultado se **persiste en SQLite** para no regenerarlo.
- **Pantalla de carga con pasos reales** vía Server-Sent Events (SSE) mientras se genera una zona.
- **Persistencia** del estado del jugador.
- **鑑定 (identificación)**: haz clic en NPCs/monstruos para que el LLM los describa.
- **Combate** (tecla F) con sistema de EXP.
- **Interacción por proximidad**: acércate a NPCs/monstruos/portales y pulsa `E`/`F` o haz clic.

## Stack

- **Backend**: Node.js + Express
- **Frontend**: HTML/CSS/JS vanilla + Three.js (CDN)
- **LLM**: litellm → ollama.khlloreda.com (modelo `deepseek-v4-flash`)
- **RAG**: `server/book_index.json` (46 chunks del libro)
- **BD**: SQLite vía `sql.js` (WASM, sin compilación nativa) → `server/zones.db`

## Cómo ejecutar

```bash
npm install
npm start        # → http://0.0.0.0:4200
```

## Pruebas e2e

```bash
node test/e2e.js          # asume servidor en 4200
node test/e2e.js --spawn  # arranca y cierra el servidor él mismo
```

Valida: estado, acción, identificación, generación de zona (LLM), persistencia (no regenera), listado de zonas y SSE con progreso.

## Estructura

```
server/
  index.js         # servidor Express + endpoints (incl. SSE de progreso)
  db.js            # SQLite (sql.js/WASM) — tabla zones
  zoneGenerator.js # generador de zonas con el LLM (schema JSON estricto)
  gameMaster.js    # narración del Game Master
  gameState.js     # estado del jugador
  llm.js           # cliente LLM
  rag.js           # búsqueda en el índice del libro
  book_index.json  # índice RAG del libro
public/
  index.html       # UI + overlay de carga con pasos
  main.js          # lógica del juego, zonas dinámicas, modo texto
  zoneRenderer.js  # materializa el JSON de una zona en 3D
test/
  e2e.js           # pruebas end-to-end
```

## Modo texto / API de control

Sin WebGL, el juego cae a modo texto. Para validar flujos desde la consola del navegador:

```js
window.__game.enterZone('laberinto_piso1')  // entra a una zona (la genera si es nueva)
window.__game.goVillage()                   // vuelve al pueblo
window.__game.interactNearest()             // interactúa con lo más cercano
window.__game.attackNearest()               // ataca al monstruo más cercano
window.__game.currentZone()                 // zona actual
window.__game.interactables()               // interactables visibles
```
