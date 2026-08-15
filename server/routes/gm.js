// Rutas de asistencia IA para la GUI del Game Master
import { Router } from 'express';
import { chatLLM } from '../llm.js';

const router = Router();

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
