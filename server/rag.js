// RAG: búsqueda de contexto relevante en el libro
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const index = JSON.parse(readFileSync(join(__dirname, 'book_index.json'), 'utf-8'));

// Palabras clave que el game master usa para buscar contexto
const KEYWORDS = ['ロクサーヌ','迷宮','ダンジョン','盗賊','賞金','奴隷','ギルド','英雄','鑑定','デュランダル','ナール','ベイル','スローラビット','加賀道夫','経験値','レベル','ジョブ','武器','スキル','再設定','ポイント','商人','街','村','モンスター','魔法','剣','盾','ポーション','回復','宿屋','市場','契約','ハーレム','異世界','自殺','いじめ','勇者','職','ステータス','HP','MP','ロクサーヌ'];

// Tokeniza la consulta en términos (japonés: busca subcadenas de keywords + palabras)
function extractTerms(query) {
  const terms = new Set();
  for (const kw of KEYWORDS) {
    if (query.includes(kw)) terms.add(kw);
  }
  // También añadir palabras latinas/numéricas
  const latin = query.match(/[a-zA-Z0-9]+/g);
  if (latin) latin.forEach(t => terms.add(t.toLowerCase()));
  return terms;
}

// Busca los chunks más relevantes
export function searchBook(query, topK = 3) {
  const terms = extractTerms(query);
  const scored = index.chunks.map(chunk => {
    let score = 0;
    for (const t of terms) {
      if (chunk.keywords.includes(t)) score += 3;
      if (chunk.text.includes(t)) score += 1;
    }
    return { chunk, score };
  }).filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  if (scored.length === 0) {
    // Fallback: devolver los primeros chunks (contexto general del inicio)
    return index.chunks.slice(0, 2).map(c => c.text);
  }
  return scored.map(x => x.chunk.text);
}

// Construye el bloque de contexto para el prompt del game master
export function buildContext(query) {
  const chunks = searchBook(query, 3);
  if (chunks.length === 0) return '';
  return '\n\n【参考：書籍の原文（日本語）】\n' + chunks.join('\n\n---\n\n');
}
