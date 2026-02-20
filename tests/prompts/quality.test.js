'use strict';

/**
 * Tests de qualité des réponses IA — appellent la vraie API Claude.
 *
 * Ces tests sont DÉSACTIVÉS par défaut car ils :
 *   - Consomment des tokens (coût réel)
 *   - Nécessitent une clé API valide
 *   - Ont une latence réseau réelle (~1-3s par test)
 *
 * Pour activer :
 *   ENABLE_PROMPT_TESTS=true npm test -- tests/prompts/quality.test.js
 *
 * En CI, activés uniquement si le secret ENABLE_PROMPT_TESTS=true est défini.
 * Voir .github/workflows/ci.yml job "prompt-tests".
 */

require('dotenv').config();

// Guard global — ignorer le fichier entier si non activé
if (process.env.ENABLE_PROMPT_TESTS !== 'true') {
  describe('Qualité des réponses IA (désactivé)', () => {
    it.todo('activer avec ENABLE_PROMPT_TESTS=true');
  });
  // eslint-disable-next-line no-process-exit
  process.nextTick(() => {}); // Sortie propre
} else {
  // Désactiver LangFuse pour éviter des dépendances externes dans les tests de prompts
  process.env.LANGFUSE_ENABLED = 'false';

  const { ask } = require('../../src/agent/index');

  // Timeout généreux : les appels Claude peuvent prendre 3-8s selon la charge
  jest.setTimeout(30_000);

  describe('Qualité des réponses IA', () => {
    // ─── Test 1 : Détection de la langue ──────────────────────────
    it('répond en français quand la question est en français', async () => {
      const result = await ask({
        question: "Comment puis-je m'authentifier avec l'API TechCorp ?",
        sessionId: 'quality-test-fr',
      });

      expect(result.answer).toBeDefined();
      expect(result.answer.length).toBeGreaterThan(50);

      // Vérifier que la réponse contient des mots français courants
      const frenchIndicators = [
        'vous', 'pour', 'dans', 'avec', 'une', 'les', 'est', 'votre',
        'clé', 'API', 'utiliser', 'Bearer', 'authentification',
      ];
      const lowerAnswer = result.answer.toLowerCase();
      const matchCount = frenchIndicators.filter((w) => lowerAnswer.includes(w)).length;

      expect(matchCount).toBeGreaterThanOrEqual(3);
    });

    // ─── Test 2 : Citation de la base de connaissances ────────────
    it('cite les sections de la knowledge base pertinentes', async () => {
      const result = await ask({
        question: 'What are the rate limits for the TechCorp API?',
        sessionId: 'quality-test-kb',
      });

      expect(result.knowledge_chunks.length).toBeGreaterThan(0);

      // Au moins un chunk "rate" doit avoir été utilisé
      const usedRateChunk = result.knowledge_chunks.some((id) =>
        id.toLowerCase().includes('rate')
      );
      expect(usedRateChunk).toBe(true);

      // La réponse doit mentionner des chiffres concrets de la KB
      // (60 req/min Free, 300 Starter, 1000 Pro ou les headers RateLimit)
      const mentionsNumbers = /\d+/.test(result.answer);
      expect(mentionsNumbers).toBe(true);
    });

    // ─── Test 3 : Refus hors périmètre ────────────────────────────
    it("refuse de répondre hors du périmètre de l'API TechCorp", async () => {
      const result = await ask({
        question: 'Can you give me a recipe for chocolate cake?',
        sessionId: 'quality-test-scope',
      });

      const lowerAnswer = result.answer.toLowerCase();

      // L'agent doit signaler qu'il ne peut pas répondre à cette question
      const refusalIndicators = [
        'not', "don't", 'cannot', 'only', 'outside', 'scope',
        'techcorp', 'documentation', 'unable', 'beyond', 'not able',
        'not related', 'not within',
      ];
      const hasRefusal = refusalIndicators.some((w) => lowerAnswer.includes(w));

      expect(hasRefusal).toBe(true);
    });

    // ─── Test 4 : Latence pour une question simple ─────────────────
    it('répond en moins de 8 secondes pour une question simple', async () => {
      const start = Date.now();

      const result = await ask({
        question: 'What is the base URL of the TechCorp API?',
        sessionId: 'quality-test-perf',
      });

      const elapsed = Date.now() - start;

      // 8s est conservateur — le p99 réel est ~3-5s
      // Ajuster si le modèle ou le réseau change
      expect(elapsed).toBeLessThan(8_000);
      expect(result.answer).toContain('api.techcorp.io');
    });
  });
}
