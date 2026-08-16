// Sesión: gestiona qué historia está activa (la que se está jugando/editando).
// La historia activa se persiste en un archivo JSON para que sobreviva a reinicios.
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSION_FILE = join(__dirname, 'session.json');

let activeStoryId = null;

export function initSession() {
  try {
    if (existsSync(SESSION_FILE)) {
      const raw = readFileSync(SESSION_FILE, 'utf-8');
      const data = JSON.parse(raw);
      activeStoryId = data.activeStoryId || null;
    }
  } catch (err) {
    console.error('Error cargando sesión:', err.message);
    activeStoryId = null;
  }
  return activeStoryId;
}

function persist() {
  try {
    writeFileSync(SESSION_FILE, JSON.stringify({ activeStoryId }, null, 2));
  } catch (err) {
    console.error('Error guardando sesión:', err.message);
  }
}

// Devuelve el id de la historia activa (o null si no hay)
export function getActiveStoryId() {
  return activeStoryId;
}

// Establece la historia activa y la persiste
export function setActiveStoryId(id) {
  activeStoryId = id || null;
  persist();
  return activeStoryId;
}
