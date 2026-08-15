# Contrato de Datos y API Común — Book-RPG

> **Fuente de verdad** para los 3 frentes: **Servidor**, **GUI del Game Master** y **Cliente**.
> Cualquier implementación DEBE respetar este documento. Si algo no encaja, se actualiza AQUÍ primero y luego en el código.
> Repo: `github.com/jordiportal/book-rpg` · Stack: Node.js + Express, SQLite (sql.js/WASM), frontend vanilla + Three.js.

---

## 1. Principios

1. **El servidor es la fuente de verdad.** Expone la API; GUI GM y cliente solo consumen.
2. **Un solo contrato.** Los 3 frentes implementan contra este documento, sin inventar modelos propios.
3. **Compatibilidad con lo publicado.** No se rompe lo ya existente (zonas dinámicas, SSE, persistencia).
4. **IDs estables.** El `id` de una entidad lo asigna el servidor (UUID o slug) y nunca cambia.
5. **JSON en toda la API.** Request/response siempre `application/json` (salvo subida de archivos y SSE).

---

## 2. Inventario del modelo actual (lo que ya existe)

| Entidad | Dónde vive | Forma |
|---------|-----------|-------|
| **Estado del jugador** | `server/savegame.json` | `gameState.js` → `createInitialState()` |
| **Zonas** | `server/zones.db` (tabla `zones`) | `db.js` → `saveZone/getZone/listZones` |
| **Zona generada** | JSON dentro de `zones.data_json` | `zoneGenerator.js` → `generateZone()` |
| **RAG del libro** | `server/book_index.json` (46 chunks) | `rag.js` → `buildContext/searchBook` |
| **Game Master** | `server/gameMaster.js` | `processAction/identifyTarget` |

### 2.1 Zona generada (esquema actual, se mantiene)
```json
{
  "id": "laberinto_piso1",
  "name": "Laberinto del Primer Piso",
  "theme": "dungeon | village | forest | town | cave",
  "ambient": "descripción breve",
  "layout": {
    "width": 40, "depth": 40,
    "wallColor": "#4a4a55", "floorColor": "#3a3a42",
    "fogColor": "#0a0a12", "fogNear": 10, "fogFar": 60,
    "ambientLight": "#444466", "ambientIntensity": 0.7
  },
  "npcs": [{ "name": "", "role": "", "color": "", "dialog": "", "x": 0, "z": 0 }],
  "enemies": [{ "name": "", "level": 3, "hp": 30, "color": "", "count": 4, "x": 0, "z": 0 }],
  "items": [{ "name": "", "type": "heal|weapon|key|treasure|consumable", "value": 10, "x": 0, "z": 0 }],
  "exits": [{ "direction": "north|south|east|west", "target": "id_zona", "label": "texto" }]
}
```

### 2.2 Estado del jugador (esquema actual, se mantiene)
```json
{
  "player": {
    "name": "加賀道夫", "level": 1, "exp": 0, "expToNext": 100,
    "hp": 100, "maxHp": 100, "mp": 50, "maxMp": 50,
    "job": "無職", "jobs": ["無職"], "weapon": "なし",
    "skills": ["鑑定"], "bonusPoints": 99,
    "str": 10, "vit": 10, "agi": 10, "dex": 10, "int": 10, "luck": 10
  },
  "money": 0, "inventory": [],
  "location": "最初の村", "day": 1, "daysRemaining": 5,
  "reputation": 0, "flags": {}, "log": []
}
```

---

## 3. Esquema de Personajes principales (nuevo)

Personajes gestionados por la GUI del GM y mostrados en el mundo. **NO** es el jugador (加賀道夫); son los personajes del mundo (compañeros, NPCs relevantes, Roxanne…).

```json
{
  "id": "uuid-o-slug",
  "name": "ロクサーヌ",
  "race": "inu-mimi (perro)",
  "class": "esclava / mercader / guerrera",
  "description": "descripción narrativa breve",
  "stats": {
    "level": 1, "hp": 100, "maxHp": 100, "mp": 50, "maxMp": 50,
    "str": 10, "vit": 10, "agi": 10, "dex": 10, "int": 10, "luck": 10
  },
  "equipment": {
    "weapon": "equipment_id | null",
    "armor": "equipment_id | null",
    "accessory": "equipment_id | null"
  },
  "model3d": {
    "status": "none | pending | ready | failed",
    "url": "ruta al modelo glb/gltf | null",
    "imageUrl": "imagen 2D de referencia | null",
    "generatedAt": "ISO | null"
  },
  "tags": ["companion", "main"],
  "createdAt": "ISO",
  "updatedAt": "ISO"
}
```

> **Nota 3D (decisión del usuario):** la generación 3D se deja **sencilla** por ahora. El `model3d` guarda el resultado (URL del glb/gltf o imagen 2D). La integración con modelos de generación de imagen/omni se decide más adelante; el contrato ya reserva el campo `model3d` para no romper nada después.

---

## 4. Esquema de Equipamiento (nuevo)

```json
{
  "id": "uuid-o-slug",
  "name": "デュランダル",
  "slot": "weapon | armor | accessory",
  "type": "espada | arco | armadura | anillo | ...",
  "rarity": "common | uncommon | rare | epic | legendary",
  "stats": { "str": 5, "vit": 0, "agi": 0, "dex": 0, "int": 0, "luck": 0, "hp": 0, "mp": 0 },
  "value": 150,
  "description": "descripción breve",
  "model3d": { "status": "none", "url": null, "imageUrl": null, "generatedAt": null },
  "createdAt": "ISO",
  "updatedAt": "ISO"
}
```

---

## 5. Esquema de Historia / Capítulos (nuevo)

La historia se carga (epub/texto) en la GUI del GM, se parsea a capítulos/escenas y se guarda. El Game Master la usa para narrar.

```json
{
  "id": "uuid-o-slug",
  "title": "異世界迷宮でハーレムを",
  "source": "epub | text | manual",
  "originalFile": "nombre_original.epub | null",
  "language": "ja",
  "chapters": [
    {
      "id": "cap-1",
      "index": 1,
      "title": "Título del capítulo",
      "summary": "resumen breve (asistido por IA)",
      "content": "texto completo del capítulo",
      "scenes": [
        { "id": "esc-1-1", "index": 1, "title": "Escena", "summary": "", "content": "texto de la escena" }
      ]
    }
  ],
  "createdAt": "ISO",
  "updatedAt": "ISO"
}
```

> El **parseo** (epub → capítulos/escenas) lo hace el servidor, **asistido por IA** para estructurar títulos, resúmenes y escenas.

---

## 6. Contrato de API REST

Base URL: `/api`. Todas las respuestas JSON. Errores: `{ "error": "mensaje" }` con el código HTTP adecuado.

### 6.1 Estado del jugador (ya existe, se mantiene)
| Método | Ruta | Descripción | Request | Response |
|--------|------|-------------|---------|----------|
| GET | `/api/state` | Estado actual | — | `{ ...estado_jugador }` |
| POST | `/api/action` | Acción del jugador (Game Master) | `{ "action": "texto" }` | `{ narrative, mechanics, state }` |
| POST | `/api/identify` | Usar 鑑定 | `{ "target": "texto" }` | `{ narrative }` |
| POST | `/api/reset` | Reiniciar partida | — | `{ ...estado_nuevo }` |
| POST | `/api/save` | Guardar partida | — | `{ ok: true, savedAt }` |

### 6.2 Zonas (ya existe, se mantiene)
| Método | Ruta | Descripción | Request | Response |
|--------|------|-------------|---------|----------|
| GET | `/api/zones` | Lista zonas guardadas | — | `{ zones: [{id,name,theme,generated_at}] }` |
| GET | `/api/zone/:id` | Zona (BD o genera) | — | `{ zone, generated: bool }` |
| GET | `/api/zone/:id/stream` | Zona con progreso **SSE** | — | eventos `step` + `zone` |
| POST | `/api/zone/generate` | Forzar regeneración | `{ id, location? }` | `{ zone, generated: true }` |

### 6.3 Personajes (NUEVO)
| Método | Ruta | Descripción | Request | Response |
|--------|------|-------------|---------|----------|
| GET | `/api/characters` | Listar personajes | `?tag=` opcional | `{ characters: [Character] }` |
| POST | `/api/characters` | Crear personaje | `Character` (sin id) | `{ character: Character }` (201) |
| GET | `/api/characters/:id` | Obtener personaje | — | `{ character: Character }` |
| PUT | `/api/characters/:id` | Actualizar personaje | `Character` (parcial) | `{ character: Character }` |
| DELETE | `/api/characters/:id` | Borrar personaje | — | `{ ok: true }` |
| POST | `/api/characters/:id/equip` | Equipar item | `{ slot, equipmentId }` | `{ character: Character }` |
| POST | `/api/characters/:id/unequip` | Desequipar slot | `{ slot }` | `{ character: Character }` |
| POST | `/api/characters/:id/generate3d` | Generar modelo 3D | — | `{ character: Character }` (model3d.status actualizado) |

### 6.4 Equipamiento (NUEVO)
| Método | Ruta | Descripción | Request | Response |
|--------|------|-------------|---------|----------|
| GET | `/api/equipment` | Listar items | `?slot=` opcional | `{ equipment: [Equipment] }` |
| POST | `/api/equipment` | Crear item | `Equipment` (sin id) | `{ equipment: Equipment }` (201) |
| GET | `/api/equipment/:id` | Obtener item | — | `{ equipment: Equipment }` |
| PUT | `/api/equipment/:id` | Actualizar item | `Equipment` (parcial) | `{ equipment: Equipment }` |
| DELETE | `/api/equipment/:id` | Borrar item | — | `{ ok: true }` |

### 6.5 Historia (NUEVO)
| Método | Ruta | Descripción | Request | Response |
|--------|------|-------------|---------|----------|
| GET | `/api/story` | Obtener historia actual | — | `{ story: Story | null }` |
| POST | `/api/story/upload` | Subir epub/texto (multipart) | `multipart/form-data` con `file` | `{ story: Story }` (parsea y estructura) |
| POST | `/api/story/parse` | Re-estructurar historia con IA | — | `{ story: Story }` |
| PUT | `/api/story` | Actualizar historia/metadatos | `Story` (parcial) | `{ story: Story }` |
| DELETE | `/api/story` | Borrar historia | — | `{ ok: true }` |
| GET | `/api/story/chapters` | Listar capítulos | — | `{ chapters: [Chapter] }` |
| GET | `/api/story/chapters/:id` | Obtener capítulo | — | `{ chapter: Chapter }` |

### 6.6 Asistencia IA para la GUI del GM (NUEVO)
| Método | Ruta | Descripción | Request | Response |
|--------|------|-------------|---------|----------|
| POST | `/api/gm/suggest` | Sugerencias IA (nombres, stats, descripciones) | `{ kind: "name|stats|description|chapter", context }` | `{ suggestion: string \| object }` |

---

## 7. Generación 3D (integración)

- **Disparador:** `POST /api/characters/:id/generate3d` (y análogo para equipment si aplica).
- **Flujo:** el servidor orquesta el servicio de generación (imagen/omni, a decidir más adelante) y actualiza `character.model3d`.
- **Estados de `model3d.status`:** `none` → `pending` → `ready` | `failed`.
- **Respuesta:** el `Character` completo con `model3d` actualizado. El cliente/GUI poll o recibe el resultado.
- **Sencillo por ahora:** se guarda la URL del resultado (glb/gltf o imagen 2D). El motor de generación concreto se decide en una fase posterior; el contrato ya lo soporta.

---

## 8. Persistencia (BD)

Se amplía `server/zones.db` (sql.js/WASM) con tablas nuevas:

```sql
CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS equipment (
  id TEXT PRIMARY KEY,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS story (
  id TEXT PRIMARY KEY,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

> Patrón: cada entidad se guarda como JSON en `data_json` (igual que `zones`). Así el esquema evoluciona sin migraciones.

---

## 9. Cómo se conectan los 3 frentes

```
┌─────────────┐   contrato   ┌──────────────┐   contrato   ┌──────────────┐
│ GUI Game    │ ───────────▶ │  Servidor    │ ───────────▶ │   Cliente    │
│ Master (GM) │   consume    │ (fuente de   │   consume    │  (juego 3D)  │
│ React       │   la API     │  verdad)     │   la API     │ vanilla+Three│
└─────────────┘              └──────────────┘              └──────────────┘
```

1. **GUI GM (React)** crea/edita personajes, equipamiento e historia → llama a la API del servidor.
2. **Servidor** persiste en SQLite y expone la API según este contrato.
3. **Cliente (juego)** consume personajes/equipamiento/historia reales → los muestra en el mundo y narra con ellos.

**Garantía de coherencia:** los 3 frentes solo se comunican vía este contrato. Si un frente necesita algo nuevo, primero se añade aquí y luego se implementa en los otros.

---

## 10. Decisiones registradas

| Decisión | Valor |
|----------|-------|
| GUI GM | **React** (menú complejo, muchas opciones) servida por el mismo Express |
| Generación 3D | **Sencilla por ahora**; se reserva `model3d`; motor de imagen/omni se decide después |
| Persistencia | SQLite (sql.js/WASM), entidades como JSON en `data_json` |
| Frontend del juego | Vanilla + Three.js (se mantiene) |
| Idioma | Español (UI y narración); nombres/objetos del libro en japonés |
