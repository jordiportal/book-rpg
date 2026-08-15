// Game Master: interpreta las acciones del jugador usando el LLM + RAG del libro
import { chatLLM } from './llm.js';
import { buildContext } from './rag.js';
import { GAME_CONSTANTS, addLog, gainExp, addJob, gainMoney, advanceDay, canBuyRoxanne } from './gameState.js';

// Prompt de sistema del game master. Le decimos que es el director de juego
// del mundo del libro y que debe ser fiel a la obra.
function buildSystemPrompt() {
  return `Eres el Game Master de un RPG de mundo abierto basado en la novela japonesa "異世界迷宮でハーレムを" (Harem in the Labyrinth of Another World) de 蘇我捨恥.

El jugador es 加賀道夫 (Kaga Michio), un estudiante japonés de 17 años que fue transportado a este mundo de fantasía. Tiene la habilidad especial de "鑑定" (identificación/appraisal) que le permite ver el nombre, nivel y trabajo de cualquier persona o monstruo.

Tu trabajo es dirigir la historia de forma fiel al libro, pero también permitir al jugador tomar decisiones libres. El mundo incluye:
- 最初の村 (el primer pueblo) donde despertó
- ベイル (Beil), la ciudad principal
- 迷宮 (el laberinto/dungeon) donde se gana experiencia
- Monstruos como スローラビット (conejos monstruo)
- El sistema de gremios, monedas (ナール), y el mercado de esclavos

El objetivo principal del volumen 1 es que el jugador consiga 420,000 nales para comprar a ロクサーヌ (Roxanne), una chica perro (inu-mimi) de 16 años, en el mercado de esclavos, antes de que pasen 5 días.

REGLAS IMPORTANTES:
1. Responde SIEMPRE en español, con narración inmersiva en segunda persona.
2. Sé fiel al libro: usa el contexto de la obra que se te proporciona. No inventes personajes o lugares que contradigan la historia.
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

// Convierte el estado del juego a un resumen para el prompt
function stateToPrompt(state) {
  const p = state.player;
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
- Progreso: ${JSON.stringify(state.flags)}`;
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
