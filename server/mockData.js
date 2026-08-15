// Datos mock de ejemplo para el servidor Book-RPG.
// Se insertan al arrancar si la BD está vacía.

export async function seedMockData({ saveCharacter, saveEquipment, saveStory }) {
  // ── Personajes ─────────────────────────────────────────────────────────
  await saveCharacter({
    id: 'roxanne',
    name: 'ロクサーヌ',
    race: 'inu-mimi (perro)',
    class: 'esclava',
    description: 'Chica perro de 16 años, esclava en el mercado de esclavos de la ciudad de Beil. Tiene habilidades excepcionales para el combate cuerpo a cuerpo.',
    stats: { level: 1, hp: 100, maxHp: 100, mp: 50, maxMp: 50, str: 8, vit: 9, agi: 12, dex: 10, int: 6, luck: 10 },
    equipment: { weapon: null, armor: null, accessory: null },
    model3d: { status: 'none', url: null, imageUrl: null, generatedAt: null },
    tags: ['companion', 'main'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  await saveCharacter({
    id: 'michio',
    name: '加賀道夫',
    race: 'humano',
    class: '無職',
    description: 'El protagonista. Estudiante japonés de 17 años transportado a otro mundo. Posee la habilidad especial de 鑑定 (identificación).',
    stats: { level: 1, hp: 100, maxHp: 100, mp: 50, maxMp: 50, str: 10, vit: 10, agi: 10, dex: 10, int: 10, luck: 10 },
    equipment: { weapon: null, armor: null, accessory: null },
    model3d: { status: 'none', url: null, imageUrl: null, generatedAt: null },
    tags: ['main', 'protagonist'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  // ── Equipamiento ───────────────────────────────────────────────────────
  await saveEquipment({
    id: 'durandal',
    name: 'デュランダル',
    slot: 'weapon',
    type: 'espada',
    rarity: 'legendary',
    stats: { str: 15, vit: 0, agi: 5, dex: 0, int: 0, luck: 0, hp: 0, mp: 0 },
    value: 50000,
    description: 'Espada legendaria forjada con metal del laberinto. Brilla con una luz azulada.',
    model3d: { status: 'none', url: null, imageUrl: null, generatedAt: null },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  // ── Historia ─────────────────────────────────────────────────────────
  await saveStory({
    id: 'main',
    title: '異世界迷宮でハーレムを',
    source: 'manual',
    originalFile: null,
    language: 'ja',
    chapters: [
      {
        id: 'cap-1',
        index: 1,
        title: 'El despertar en otro mundo',
        summary: 'Michio despierta en un mundo de fantasía con habilidades de identificación.',
        content: 'Michio se despierta en un prado desconocido. Descubre que tiene la habilidad de 鑑定...',
        scenes: [
          { id: 'esc-1-1', index: 1, title: 'Despertar', summary: 'Michio abre los ojos en otro mundo.', content: 'Michio se despierta en un prado. Todo es extraño.' },
          { id: 'esc-1-2', index: 2, title: 'Descubrimiento', summary: 'Descubre su habilidad de identificación.', content: 'Michio descubre que puede ver el nivel y trabajo de cualquier persona.' }
        ]
      },
      {
        id: 'cap-2',
        index: 2,
        title: 'La primera aldea',
        summary: 'Michio llega al primer pueblo y conoce el sistema de este mundo.',
        content: 'Michio camina hasta llegar a un pequeño pueblo. Allí descubre el sistema de gremios...',
        scenes: [
          { id: 'esc-2-1', index: 1, title: 'Llegada al pueblo', summary: 'Michio entra en el pueblo.', content: 'El pueblo es pequeño pero acogedor. Hay una taberna y un gremio.' },
          { id: 'esc-2-2', index: 2, title: 'El gremio', summary: 'Michio se registra en el gremio de aventureros.', content: 'En el gremio, Michio aprende sobre los trabajos y habilidades.' }
        ]
      }
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  console.log('🌱 Datos mock insertados');
}
