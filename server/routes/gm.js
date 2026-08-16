// Rutas de asistencia IA para la GUI del Game Master
import { Router } from 'express';
import { chatLLM } from '../llm.js';
import { getStory, listStories, listCharacters, listEquipment } from '../db.js';
import { getActiveStoryId } from '../session.js';

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

  const chaptersDesc = (story.chapters || []).map(ch =>
    `- Cap. ${ch.index}: ${ch.title} — ${ch.summary || 'sin resumen'}`
  ).join('\n') || 'Sin capítulos';

  const charsDesc = chars.map(c =>
    `- ${c.name} (${c.race || '?'} / ${c.class || '?'}): ${c.description || 'sin descripción'}`
  ).join('\n') || 'Sin personajes';

  const itemsDesc = items.map(e =>
    `- ${e.name} (${e.slot || '?'}, ${e.rarity || '?'}): ${e.description || 'sin descripción'}`
  ).join('\n') || 'Sin equipamiento';

  const context = `HISTORIA ACTIVA: "${story.title}" (fuente: ${story.source || '?'}, ${story.chapters?.length || 0} capítulos, ${story.images?.length || 0} imágenes)\n\nCAPÍTULOS:\n${chaptersDesc}\n\nPERSONAJES:\n${charsDesc}\n\nEQUIPAMIENTO:\n${itemsDesc}`;

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

CONTEXTO ACTUAL DEL JUEGO (historia activa):
${context}`;

  // Historial reciente (últimos 10 mensajes) para dar continuidad a la conversación
  const recent = Array.isArray(history) ? history.slice(-10) : [];

  try {
    const response = await chatLLM({
      system,
      messages: [
        ...recent,
        { role: 'user', content: message }
      ],
      temperature: 0.8,
      maxTokens: 900
    });

    res.json({ reply: response, storyId: story ? story.id : null });
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
