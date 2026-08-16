// Game Master: interpreta las acciones del jugador usando el LLM + RAG del libro + historia real
import { chatLLM } from './llm.js';
import { buildContext } from './rag.js';
import { GAME_CONSTANTS, addLog, gainExp, addJob, gainMoney, advanceDay, canBuyRoxanne } from './gameState.js';
import { listStories } from './db.js';
import { getActiveStoryId } from './session.js';
import { getActiveStoryContext } from './storyContext.js';

// Prompt de sistema del game master. Se construye a partir de la historia ACTIVA
// (título, objetivo, protagonista, escena inicial), no hardcodeado a una novela.
function buildSystemPrompt() {
  const ctx = getActiveStoryContext();
  return `Eres el Game Master de un RPG de mundo abierto basado en la historia "${ctx.title}".

El jugador es ${ctx.playerName}, el protagonista de esta historia.

Tu trabajo es dirigir la historia de forma fiel a la obra, pero también permitir al jugador tomar decisiones libres.

OBJETIVO DE LA HISTORIA:
${ctx.objective}

ESCENA INICIAL:
${ctx.startingScene}

REGLAS IMPORTANTES:
1. Responde SIEMPRE en español, con narración inmersiva en segunda persona.
2. Sé fiel a la historia: usa el contexto de la obra que se te proporciona. No inventes personajes o lugares que contradigan la historia.
3. Interpreta las acciones del jugador de forma creativa pero coherente con el mundo.
4. Cuando el jugador use "鑑定" (identificación), describe el nombre, nivel y trabajo del objetivo.
5. Mantén el tono de la novela: aventura, humor cínico del protagonista, y el sistema de juego tipo RPG.
6. No rompas la cuarta pared. Actúa como el mundo.
7. Al final de tu respuesta, SIEMPRE devuelve un bloque JSON con las consecuencias mecánicas de la acción, con este formato exacto:
   {"action":"","result":"","exp":0,"money":0,"day_advance":false,"job":null,"flag":null,"description":""}
   Donde:
   - "action": la acción que realizó el jugador
   - "result": "success" | "fail" | "neutral"
   - "exp": experiencia ganada (número)
   - "money": dinero ganado o perdido (número, negativo si pierde)
   - "day_advance": true si el día avanza
   - "job": nuevo trabajo obtenido (o null)
   - "flag": flag de historia a activar (o null)
   - "description": resumen breve de la consecuencia

   El bloque JSON debe ir en la última línea de tu respuesta, precedido por "###MECANICA###".`;
}

// Obtiene la historia ACTIVA de la BD para enriquecer el prompt
function getStoryContext() {
  try {
    const id = getActiveStoryId();
    const stories = listStories();
    const story = id ? stories.find(s => s.id === id) : stories[0];
    if (!story) return '';
    const chapters = story.chapters || [];
    let ctx = `\n\nHISTORIA CARGADA: "${story.title}"\n`;
    chapters.forEach(ch => {
      ctx += `- Capítulo ${ch.index}: ${ch.title}\n  ${ch.summary || ''}\n`;
    });
    return ctx;
  } catch (e) {
    return '';
  }
}

// Convierte el estado del juego a un resumen para el prompt
function stateToPrompt(state) {
  const p = state.player;
  const storyCtx = getStoryContext();
  return `ESTADO ACTUAL DEL JUGADOR:
- Nombre: ${p.name}
- Nivel: ${p.level} (EXP: ${p.exp}/${p.expToNext})
- HP: ${p.hp}/${p.maxHp} | MP: ${p.mp}/${p.maxMp}
- Trabajo: ${p.job} (trabajos: ${p.jobs.join(', ')})
- Arma: ${p.weapon}
- Habilidades: ${p.skills.join(', ')}
- Fuerza: ${p.str} | Vitalidad: ${p.vit} | Agilidad: ${p.agi} | Destreza: ${p.dex} | Inteligencia: ${p.int} | Suerte: ${p.luck}
- Dinero: ${state.money} ${GAME_CONSTANTS.CURRENCY}
- Ubicación: ${state.location}
- Día: ${state.day} (quedan ${state.daysRemaining} días para el mercado de esclavos)
- Reputación: ${state.reputation}
- Inventario: ${state.inventory.length > 0 ? state.inventory.join(', ') : 'vacío'}
- Progreso: ${JSON.stringify(state.flags)}${storyCtx}`;
}

// Parsea el bloque JSON mecánico de la respuesta del LLM
function parseMechanics(text) {
  const marker = '###MECANICA###';
  const idx = text.lastIndexOf(marker);
  if (idx === -1) return null;
  const jsonStr = text.slice(idx + marker.length).trim();
  // Extraer el primer objeto JSON
  try {
    const start = jsonStr.indexOf('{');
    const end = jsonStr.lastIndexOf('}');
    if (start === -1 || end === -1) return null;
    return JSON.parse(jsonStr.slice(start, end + 1));
  } catch (e) {
    return null;
  }
}

// Aplica las consecuencias mecánicas al estado
function applyMechanics(state, mech) {
  if (!mech) return;
  if (mech.exp) gainExp(state, mech.exp);
  if (mech.money) gainMoney(state, mech.money);
  if (mech.day_advance) advanceDay(state);
  if (mech.job) addJob(state, mech.job);
  if (mech.flag) state.flags[mech.flag] = true;
}

// Procesa una acción del jugador
export async function processAction(state, action) {
  // Construir el contexto RAG relevante para la acción
  const context = buildContext(action);
  const system = buildSystemPrompt();
  const stateStr = stateToPrompt(state);

  const userMsg = `${stateStr}

${context}

El jugador realiza la siguiente acción:
"${action}"

Responde como el Game Master, narrando la escena y sus consecuencias. Luego añade el bloque mecánico ###MECANICA### con el JSON de consecuencias.`;

  const response = await chatLLM({
    system,
    messages: [{ role: 'user', content: userMsg }],
    temperature: 0.8,
    maxTokens: 1000
  });

  // Separar la narración del JSON mecánico
  const mech = parseMechanics(response);
  let narrative = response;
  if (mech) {
    const marker = '###MECANICA###';
    narrative = response.slice(0, response.lastIndexOf(marker)).trim();
  }

  // Aplicar mecánicas
  applyMechanics(state, mech);

  addLog(state, action);

  return {
    narrative,
    mechanics: mech,
    state: serializeState(state)
  };
}

// Estado serializable para el frontend
function serializeState(state) {
  return JSON.parse(JSON.stringify(state));
}

// Acción especial: usar 鑑定 (identificación)
export async function identifyTarget(state, target) {
  const context = buildContext('鑑定 ' + target);
  const system = buildSystemPrompt();
  const userMsg = `${stateToPrompt(state)}

${context}

El jugador usa su habilidad especial 鑑定 (identificación) sobre: "${target}".

Describe con detalle lo que ve: nombre, nivel, trabajo/raza, y cualquier detalle relevante. Sé fiel al libro. No uses el bloque ###MECANICA### en esta respuesta.`;

  const response = await chatLLM({
    system,
    messages: [{ role: 'user', content: userMsg }],
    temperature: 0.6,
    maxTokens: 500
  });

  return { narrative: response };
}
