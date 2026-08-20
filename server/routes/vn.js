// Rutas del modo Novela Visual — traducción JA→ES con caché.
// El texto del libro está en japonés (language: 'ja'). El modo VN muestra el
// original y, debajo, la traducción al español como subtítulo. La traducción
// se hace por fragmento con el LLM y se cachea en memoria para no repetir.
import { Router } from 'express';
import { chatLLM, LLM_CONFIG } from '../llm.js';

const router = Router();

// Caché de traducciones en memoria: clave = texto normalizado → traducción
const translateCache = new Map();
const MAX_CACHE = 2000;

// POST /api/vn/translate — traduce un fragmento de texto al español
router.post('/translate', async (req, res) => {
  const { text } = req.body || {};
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Texto vacío' });
  }
  const key = text.trim().slice(0, 3000);
  if (translateCache.has(key)) {
    return res.json({ translation: translateCache.get(key), cached: true });
  }
  try {
    const system = `Eres un traductor profesional de japonés a ESPAÑOL para novelas visuales (eroge).
Tu idioma de salida es SIEMPRE español (es-ES). NUNCA traduzcas al chino, inglés ni ningún otro idioma.
Traduce el texto al español manteniendo:
- El tono y registro del original (coloquial, formal, narrativo).
- Los nombres propios y onomatopeyas sin traducir (p. ej. 加賀道夫, ロクサーヌ).
- Las marcas de diálogo (「」) como comillas españolas si ayuda a la lectura.
Responde ÚNICAMENTE con la traducción en español, sin comentarios, sin comillas envolventes, sin markdown.`;
    const response = await chatLLM({
      system,
      messages: [{ role: 'user', content: `Traduce al español:\n\n${text}` }],
      temperature: 0.3,
      maxTokens: 2000
    });
    const translation = response.trim();
    // Mantener la caché acotada
    translateCache.set(key, translation);
    if (translateCache.size > MAX_CACHE) {
      const firstKey = translateCache.keys().next().value;
      translateCache.delete(firstKey);
    }
    res.json({ translation, cached: false });
  } catch (err) {
    console.error('Error traduciendo:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/vn/tts — sintetiza voz (fish-speech) de un texto.
// Devuelve el audio (WAV) como base64 en JSON para reproducirlo en el cliente.
// `lang` puede ser 'ja' (original) o 'es' (traducido); por ahora ambos usan la
// misma voz de fish-speech, pero se deja el campo para futuras voces distintas.
// `voice` es el id de una voz configurada globalmente (campo 'voice' del perfil).
// El servidor de fish-speech solo soporta 'default' de momento, así que se acepta
// el campo (para futuras voces con sample) pero se fuerza 'default' si no es válida.
import { getVoice } from '../db.js';
const SUPPORTED_VOICES = new Set(['default']);
router.post('/tts', async (req, res) => {
  const { text, lang, voice } = req.body || {};
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Texto vacío' });
  }
  // Resolver la voz: si `voice` es un id de voz configurada, usar su sample si existe.
  let voiceId = 'default';
  let sample = null;
  if (voice && typeof voice === 'string') {
    if (SUPPORTED_VOICES.has(voice)) {
      voiceId = voice;
    } else {
      const v = getVoice(voice);
      if (v) {
        voiceId = v.name || 'default';
        sample = v.sampleBase64 || v.sampleUrl || null;
      }
    }
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    const body = {
      model: 'fish-speech',
      input: text.trim(),
      voice: voiceId
    };
    // Si hay sample de referencia, pasarlo (fish-speech lo usa para clonar la voz).
    // El servidor actual lo ignora (solo 'default'), pero queda preparado.
    if (sample) {
      body.reference_audio = sample;
    }
    const ttsRes = await fetch(`${LLM_CONFIG.baseUrl}/audio/speech`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LLM_CONFIG.apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!ttsRes.ok) {
      const errText = await ttsRes.text();
      throw new Error(`TTS error ${ttsRes.status}: ${errText.slice(0, 300)}`);
    }
    const arrayBuffer = await ttsRes.arrayBuffer();
    const audioBase64 = Buffer.from(arrayBuffer).toString('base64');
    const contentType = ttsRes.headers.get('content-type') || 'audio/wav';
    res.json({ audio: audioBase64, contentType, lang: lang || 'ja', voice: voiceId, hasSample: !!sample });
  } catch (err) {
    console.error('Error TTS:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
