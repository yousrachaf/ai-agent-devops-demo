'use strict';

/**
 * Knowledge base loader and relevance retrieval.
 *
 * Why this approach (file-based + keyword matching) instead of a vector DB:
 * - Zero infrastructure dependencies — works in Docker without a Postgres/Redis sidecar
 * - Fast enough for a demo knowledge base (< 50 documents)
 * - Easily swappable: the interface (loadKnowledge / findRelevantChunks) stays
 *   the same when you upgrade to embeddings + pgvector
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const KNOWLEDGE_DIR = path.join(process.cwd(), 'knowledge');

// Cache parsed chunks in memory — files don't change at runtime
let chunksCache = null;

/**
 * Split a markdown document into sections by level-2 headings (##).
 * Each chunk carries the file source for citation in LangFuse traces.
 *
 * @param {string} content - Raw markdown string
 * @param {string} filename - Source filename (without extension)
 * @returns {Array<{id: string, title: string, content: string, source: string}>}
 */
function parseMarkdownChunks(content, filename) {
  const chunks = [];
  const sections = content.split(/^## /m);

  // First section is the document header (# Title + intro paragraph)
  const intro = sections.shift().trim();
  if (intro) {
    const titleMatch = intro.match(/^# (.+)/m);
    const title = titleMatch ? titleMatch[1] : filename;
    chunks.push({
      id: `${filename}#intro`,
      title,
      content: intro,
      source: filename,
    });
  }

  for (const section of sections) {
    const lines = section.split('\n');
    const title = lines.shift().trim();
    const body = lines.join('\n').trim();

    if (body) {
      // Slug the title for a stable, readable chunk ID (used in LangFuse metadata)
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      chunks.push({
        id: `${filename}#${slug}`,
        title,
        content: `## ${title}\n\n${body}`,
        source: filename,
      });
    }
  }

  return chunks;
}

/**
 * Load and parse all markdown files in the knowledge directory.
 * Results are cached after the first call.
 *
 * @returns {Array<{id, title, content, source}>}
 */
function loadKnowledge() {
  if (chunksCache) return chunksCache;

  if (!fs.existsSync(KNOWLEDGE_DIR)) {
    logger.warn({ dir: KNOWLEDGE_DIR }, 'Knowledge directory not found');
    chunksCache = [];
    return chunksCache;
  }

  const files = fs.readdirSync(KNOWLEDGE_DIR).filter((f) => f.endsWith('.md'));
  const allChunks = [];

  for (const file of files) {
    const filePath = path.join(KNOWLEDGE_DIR, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const filename = path.basename(file, '.md');
    const chunks = parseMarkdownChunks(content, filename);

    allChunks.push(...chunks);
    logger.debug({ file, chunks: chunks.length }, 'Knowledge file loaded');
  }

  logger.info(
    { files: files.length, totalChunks: allChunks.length },
    'Knowledge base loaded'
  );

  chunksCache = allChunks;
  return chunksCache;
}

/**
 * Score a chunk's relevance to a query using simple term frequency.
 * Good enough for a focused knowledge base; replace with embeddings for scale.
 *
 * @param {string} query
 * @param {object} chunk
 * @returns {number} relevance score (higher = more relevant)
 */
function scoreChunk(query, chunk) {
  const queryTerms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  const chunkText = (chunk.title + ' ' + chunk.content).toLowerCase();

  let score = 0;
  for (const term of queryTerms) {
    // Title matches are weighted 3x — a section title is a strong signal
    const titleMatches = (chunk.title.toLowerCase().match(new RegExp(term, 'g')) || []).length;
    const bodyMatches = (chunkText.match(new RegExp(term, 'g')) || []).length;
    score += titleMatches * 3 + bodyMatches;
  }

  return score;
}

/**
 * Find the most relevant knowledge chunks for a given query.
 *
 * @param {string} query - User's question
 * @param {number} topK  - How many chunks to return (default: 3)
 * @returns {Array<{id, title, content, source, score}>}
 */
function findRelevantChunks(query, topK = 3) {
  const chunks = loadKnowledge();

  const scored = chunks
    .map((chunk) => ({ ...chunk, score: scoreChunk(query, chunk) }))
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  logger.debug(
    { query: query.slice(0, 50), results: scored.map((c) => c.id) },
    'Knowledge retrieval complete'
  );

  return scored;
}

/**
 * Reset the in-memory cache — used in tests to reload fixtures.
 */
function resetCache() {
  chunksCache = null;
}

module.exports = { loadKnowledge, findRelevantChunks, resetCache };
