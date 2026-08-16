// Contexto de la historia activa: deriva el objetivo, la escena inicial, el
// protagonista y la ubicación a partir del contenido REAL de la historia
// (título, capítulos, personajes), en lugar de hardcodear la novela de Roxanne.
// Así cada historia es un juego independiente con su propio objetivo y arranque.
import { getActiveStoryId } from './session.js';
import { getStory, listStories, listCharacters } from './db.js';

// Contexto por defecto cuando no hay historia cargada
export function defaultContext() {
  return {
    title: 'un mundo desconocido',
    playerName: 'Protagonista',
    objective: 'Descubre los secretos de este mundo.',
    startingScene: 'Despiertas en un mundo desconocido. A tu alrededor solo hay silencio y un horizonte por explorar.',
    location: 'un lugar desconocido',
    currency: 'ナール',
    daysRemaining: 5
  };
}

// Deriva el contexto de una historia concreta (heurística, sin LLM: rápido y fiable)
export function deriveStoryContext(story) {
  if (!story) return defaultContext();

  const chapters = story.chapters || [];
  const firstChapter = chapters[0];
  const firstScene = firstChapter?.scenes?.[0];
  const title = story.title || 'este mundo';

  // Protagonista: personaje marcado como 'protagonist', o 'main' no-compañero
  let protagonist = null;
  try {
    const chars = listCharacters(null, story.id) || [];
    protagonist = chars.find(c => (c.tags || []).includes('protagonist'))
      || chars.find(c => (c.tags || []).includes('main') && !(c.tags || []).includes('companion'))
      || null;
  } catch (e) { /* sin personajes aún */ }

  // Objetivo: derivar del primer capítulo (summary) o del título.
  // Evita resúmenes genéricos tipo "Texto completo" o vacíos, y títulos de
  // capítulo genéricos ("Capítulo único", "Capítulo 1", etc.).
  let objective = '';
  const summary = (firstChapter?.summary || '').trim();
  const chapterTitle = (firstChapter?.title || '').trim();
  const isGenericChapter = /^cap[ií]tulo\s*(ú|u)?nico|^cap[ií]tulo\s*\d+$/i.test(chapterTitle) || chapterTitle === '';
  if (summary && summary !== 'Texto completo' && summary.length > 3) {
    objective = summary;
  } else if (chapterTitle && !isGenericChapter) {
    objective = `Explora: ${chapterTitle}`;
  } else {
    objective = `Descubre los secretos de ${title}`;
  }

  // Escena inicial: contenido de la primera escena/capítulo, o genérica.
  // Se trunca a un párrafo razonable para no abrumar al jugador.
  let startingScene = '';
  const rawScene = firstScene?.content || firstChapter?.content || '';
  const clean = rawScene.replace(/\s+/g, ' ').trim();
  if (clean) {
    startingScene = clean.length > 400 ? clean.slice(0, 400) + '…' : clean;
  } else {
    startingScene = `Despiertas en ${title}, un mundo desconocido.`;
  }

  return {
    title,
    playerName: protagonist?.name || 'Protagonista',
    objective,
    startingScene,
    location: (chapterTitle && !isGenericChapter) ? chapterTitle : 'un lugar desconocido',
    currency: 'ナール',
    daysRemaining: 5,
    gameType: story.gameType || 'open_world',
    protagonist
  };
}

// Contexto de la historia activa (o la primera si no hay activa)
export function getActiveStoryContext() {
  try {
    const id = getActiveStoryId();
    const story = id ? getStory(id) : (listStories()[0] || null);
    return deriveStoryContext(story);
  } catch (e) {
    // BD aún no inicializada (p.ej. durante el arranque): contexto por defecto
    return defaultContext();
  }
}
