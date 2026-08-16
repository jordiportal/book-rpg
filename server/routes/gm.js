// Rutas de asistencia IA para la GUI del Game Master
import { Router } from 'express';
import { chatLLM, chatLLMFull } from '../llm.js';
import { getStory, listStories, listCharacters, listEquipment } from '../db.js';
import { getActiveStoryId } from '../session.js';
import { GM_TOOLS, executeTool } from '../gmTools.js';

const router = Router();

// Construye el contexto de la historia activa (título, capítulos, personajes, equipamiento)
// para que el asistente del GM pueda responder con conocimiento del juego.
function buildStoryContext() {
  const stories = listStories();
  const activeId = getActiveStoryId();
  const story = stories.find(s => s.id === activeId) || stories[0] || null;
  if (!story) return { story: null, context: 'No hay ninguna historia cargada todavía.' };

  const chars = listCharacters(null, story.id);
  const items = listEquipment(null, story.id);

  // Incluye el contenido REAL y COMPLETO de las escenas en el contexto del chat.
  // El modelo (deepseek-v4-flash) tiene una ventana de 512K tokens y el libro
  // completo (~73K tokens) cabe de sobra. Así el GM tiene todo el texto en memoria
  // y no alucina. El caché del modelo local hace que la 1ª consulta sea lenta
  // pero las siguientes sean rápidas.
  const chaptersDesc = (story.chapters || []).map(ch => {
    const scenesText = (ch.scenes || []).map(sc => sc.content || '').join('\n\n') || ch.content || '';
    return `- Cap. ${ch.index}: ${ch.title} — ${ch.summary || 'sin resumen'}\n${scenesText}`;
  }).join('\n') || 'Sin capítulos';

  const charsDesc = chars.map(c =>
    `- ${c.name} (${c.race || '?'} / ${c.class || '?'}): ${c.description || 'sin descripción'}`
  ).join('\n') || 'Sin personajes';

  const itemsDesc = items.map(e =>
    `- ${e.name} (${e.slot || '?'}, ${e.rarity || '?'}): ${e.description || 'sin descripción'}`
  ).join('\n') || 'Sin equipamiento';

  const context = `HISTORIA ACTIVA: "${story.title}" (id: ${story.id}, fuente: ${story.source || '?'}, ${story.chapters?.length || 0} capítulos, ${story.images?.length || 0} imágenes)\n\nCAPÍTULOS:\n${chaptersDesc}\n\nPERSONAJES:\n${charsDesc}\n\nEQUIPAMIENTO:\n${itemsDesc}`;

  return { story, context };
}

// POST /api/gm/chat — chat del Game Master con la IA sobre la historia activa
router.post('/chat', async (req, res) => {
  const { message, history } = req.body || {};
  if (!message || typeof message !== 'string' || message.trim() === '') {
    return res.status(400).json({ error: 'Mensaje vacío' });
  }

  const { story, context } = buildStoryContext();

  const system = `Eres el asistente del Game Master de un RPG de mundo abierto guiado por IA, basado en una novela (isekai). Tu rol es ayudar al GM a PREPARAR la partida: aclarar la trama, sugerir escenas, desarrollar personajes, plantear encuentros, enemigos, recompensas, giros de guion, etc. Responde en español, de forma práctica y concreta, como un copiloto de narración. Si te preguntan por algo que no está en la historia, dilo con honestidad y propón opciones coherentes con el tono de la obra.

IMPORTANTE — TIENES HERRAMIENTAS PARA MODIFICAR EL JUEGO:
Puedes ejecutar acciones reales sobre los datos del juego (historias, capítulos, personajes, equipamiento) usando las herramientas disponibles. Cuando el GM te pida crear, editar, borrar, equipar o generar algo, USA la herramienta correspondiente en lugar de limitarte a describirlo. Tras ejecutar una herramienta, confirma al GM qué has hecho y el resultado obtenido. Si una operación requiere un ID que no conoces, lista primero (list_stories, list_characters, list_equipment, list_chapters) para obtenerlo.

CONTEXTO ACTUAL DEL JUEGO (historia activa):
${context}`;

  // Historial reciente (últimos 10 mensajes) para dar continuidad a la conversación
  const recent = Array.isArray(history) ? history.slice(-10) : [];

  try {
    // Bucle de function calling: el LLM puede pedir ejecutar varias tools seguidas
    const messages = [
      ...recent,
      { role: 'user', content: message }
    ];
    const toolResults = [];
    let finalReply = '';
    let iterations = 0;
    const MAX_ITER = 8;

    while (iterations < MAX_ITER) {
      const msg = await chatLLMFull({
        system,
        messages,
        tools: GM_TOOLS,
        temperature: 0.7,
        maxTokens: 900
      });

      if (!msg) throw new Error('LLM no devolvió respuesta');

      const toolCalls = msg.tool_calls || [];
      if (toolCalls.length === 0) {
        finalReply = msg.content?.trim() || '';
        break;
      }

      // Ejecutar todas las tool calls de este turno
      for (const tc of toolCalls) {
        if (tc.type !== 'function') continue;
        const name = tc.function?.name;
        let args = {};
        try { args = JSON.parse(tc.function?.arguments || '{}'); } catch { args = {}; }
        const { ok, result, error } = await executeTool(name, args);
        toolResults.push({ name, args, ok, result, error });
        messages.push({ role: 'assistant', content: null, tool_calls: [tc] });
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(ok ? result : { error })
        });
      }
      iterations++;
    }

    // Si se ejecutaron tools, añadir un resumen de acciones al final
    let actionsSummary = '';
    if (toolResults.length > 0) {
      actionsSummary = '\n\n[Acciones ejecutadas sobre el juego]:\n' + toolResults
        .map(t => {
          const okTxt = t.ok ? 'OK' : `ERROR: ${t.error}`;
          return `- ${t.name}(${JSON.stringify(t.args)}) → ${okTxt}`;
        })
        .join('\n');
    }

    res.json({
      reply: (finalReply || 'Hecho.') + actionsSummary,
      storyId: story ? story.id : null,
      actions: toolResults.map(t => ({ name: t.name, args: t.args, ok: t.ok, error: t.error }))
    });
  } catch (err) {
    console.error('Error en gm/chat:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/gm/suggest — sugerencias IA para la GUI GM
router.post('/suggest', async (req, res) => {
  const { kind, context } = req.body || {};
  if (!kind || !['name', 'stats', 'description', 'chapter'].includes(kind)) {
    return res.status(400).json({ error: 'kind inválido (name|stats|description|chapter)' });
  }

  const system = `Eres un asistente creativo para un RPG basado en "異世界迷宮でハーレムを". Responde en español. Sé conciso y útil.`;

  let prompt = '';
  switch (kind) {
    case 'name':
      prompt = `Sugiere 5 nombres de personajes para un RPG de fantasía japonesa (isekai). Contexto: ${context || 'personaje genérico'}. Devuelve solo los nombres, uno por línea, sin numerar.`;
      break;
    case 'stats':
      prompt = `Sugiere stats de RPG para: ${context || 'un personaje nivel 1'}. Devuelve un JSON con: { level, hp, maxHp, mp, maxMp, str, vit, agi, dex, int, luck }. Solo el JSON.`;
      break;
    case 'description':
      prompt = `Escribe una descripción breve (2-3 frases) para: ${context || 'un personaje genérico'}. En español, tono de novela ligera japonesa.`;
      break;
    case 'chapter':
      prompt = `Sugiere un título y resumen breve para un capítulo de novela ligera japonesa. Contexto: ${context || 'capítulo genérico'}. Devuelve: Título: ...\nResumen: ...`;
      break;
  }

  try {
    const response = await chatLLM({
      system,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      maxTokens: 500
    });

    let suggestion = response.trim();

    // Para stats, intentar parsear JSON
    if (kind === 'stats') {
      try {
        const start = suggestion.indexOf('{');
        const end = suggestion.lastIndexOf('}');
        if (start !== -1 && end !== -1) {
          suggestion = JSON.parse(suggestion.slice(start, end + 1));
        }
      } catch {
        // si falla el parseo, devolver el texto crudo
      }
    }

    res.json({ suggestion });
  } catch (err) {
    console.error('Error en gm/suggest:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
