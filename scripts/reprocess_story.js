// Script de re-procesamiento: extrae el texto COMPLETO de un epub y lo guarda
// en la BD dividido en capítulos deterministas (cada fragmento XHTML = un capítulo).
// Uso: node scripts/reprocess_story.js <ruta_epub> <storyId>
import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import AdmZip from 'adm-zip';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_FILE = join(__dirname, '..', 'server', 'zones.db');

// Extrae texto plano de un epub (misma lógica que server/routes/story.js)
function extractEpubText(buffer) {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  const fragments = [];
  for (const entry of entries) {
    const en = entry.entryName.toLowerCase();
    if (!en.endsWith('.xhtml') && !en.endsWith('.html') && !en.endsWith('.htm')) continue;
    if (en.includes('toc') || en.includes('nav') || en.includes('cover')) continue;
    let html;
    try { html = entry.getData().toString('utf-8'); } catch { continue; }
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/h[1-6]>/gi, '\n\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (text.length > 20) fragments.push(text);
  }
  return fragments;
}

// Extrae el título real del epub desde el OPF
function extractEpubTitle(buffer) {
  try {
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries();
    const opf = entries.find(e => e.entryName.toLowerCase().endsWith('.opf'));
    if (opf) {
      const content = opf.getData().toString('utf-8');
      const m = content.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i);
      if (m) {
        const title = m[1]
          .replace(/<[^>]+>/g, '')
          .replace(/&amp;/gi, '&')
          .replace(/&lt;/gi, '<')
          .replace(/&gt;/gi, '>')
          .replace(/&quot;/gi, '"')
          .replace(/&#39;/gi, "'")
          .trim();
        if (title) return title;
      }
    }
  } catch (err) {
    console.error('Error extrayendo título del OPF:', err.message);
  }
  return null;
}

async function main() {
  const epubPath = process.argv[2];
  const storyId = process.argv[3];
  if (!epubPath || !storyId) {
    console.error('Uso: node scripts/reprocess_story.js <ruta_epub> <storyId>');
    process.exit(1);
  }

  const buffer = readFileSync(epubPath);
  const fragments = extractEpubText(buffer);
  console.log(`Fragmentos extraídos: ${fragments.length}`);
  const totalChars = fragments.reduce((a, f) => a + f.length, 0);
  console.log(`Total texto: ${totalChars} chars (~${Math.round(totalChars / 2)} tokens)`);

  // Dividir en capítulos deterministas: cada fragmento = un capítulo
  const chapters = fragments.map((text, i) => ({
    id: `cap-${i + 1}`,
    index: i + 1,
    title: `Capítulo ${i + 1}`,
    summary: text.slice(0, 120).replace(/\n/g, ' '),
    content: text,
    scenes: [{
      id: `esc-${i + 1}-1`,
      index: 1,
      title: `Escena ${i + 1}`,
      summary: text.slice(0, 120).replace(/\n/g, ' '),
      content: text
    }]
  }));

  // Cargar BD y actualizar la historia
  const SQL = await initSqlJs();
  const db = new SQL.Database(readFileSync(DB_FILE));
  const res = db.exec('SELECT data_json FROM story WHERE id = ?', [storyId]);
  if (!res.length) {
    console.error(`Historia ${storyId} no encontrada`);
    process.exit(1);
  }
  const story = JSON.parse(res[0].values[0][0]);
  const oldChars = (story.chapters || []).reduce((a, c) => a + (c.content || '').length + (c.scenes || []).reduce((x, sc) => x + (sc.content || '').length, 0), 0);
  console.log(`Antes: ${oldChars} chars en BD`);

  story.chapters = chapters;
  story.updatedAt = new Date().toISOString();
  // Actualizar el título si el OPF tiene uno fiable
  const opfTitle = extractEpubTitle(buffer);
  if (opfTitle) story.title = opfTitle;

  // Guardar en BD
  db.run(
    'UPDATE story SET data_json = ?, updated_at = ? WHERE id = ?',
    [JSON.stringify(story), story.updatedAt, storyId]
  );
  const data = db.export();
  writeFileSync(DB_FILE, Buffer.from(data));

  const newChars = (story.chapters || []).reduce((a, c) => a + (c.content || '').length + (c.scenes || []).reduce((x, sc) => x + (sc.content || '').length, 0), 0);
  console.log(`Después: ${newChars} chars en BD (${story.chapters.length} capítulos)`);
  console.log(`Título: ${story.title}`);
  console.log('✅ Re-procesado correctamente');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
