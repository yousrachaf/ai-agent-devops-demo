# ════════════════════════════════════════════════════════════════
# Dockerfile — AI Agent DevOps Demo
# ════════════════════════════════════════════════════════════════
#
# Pattern multi-stage :
#   Stage 1 (deps)       — installe uniquement les dépendances de production
#   Stage 2 (production) — image finale légère : code + deps + non-root user
#
# Objectifs :
#   - Image finale < 200 Mo
#   - Aucun secret dans l'image (variables d'env injectées au runtime)
#   - Utilisateur non-root (UID 1001) — principe de moindre privilège
#   - Health check natif Docker pour docker-compose et Kubernetes

# ── Stage 1 : Dépendances de production ─────────────────────────

FROM node:20-alpine AS deps

# Les métadonnées OCI permettent aux outils de registre d'indexer l'image
LABEL org.opencontainers.image.source="https://github.com/YOUR_USER/ai-agent-devops-demo"
LABEL org.opencontainers.image.description="AI agent with production-grade DevOps stack"

WORKDIR /app

# Copier les manifestes de dépendances AVANT le code source :
# Docker met en cache cette couche tant que package-lock.json ne change pas.
# Si seul src/ change, npm ci n'est pas relancé → builds beaucoup plus rapides.
COPY package.json package-lock.json ./

# --omit=dev  : exclure devDependencies (jest, eslint, nodemon…)
# --ignore-scripts : ne pas exécuter de scripts post-install arbitraires (sécurité)
RUN npm ci --omit=dev --ignore-scripts

# ── Stage 2 : Image de production ────────────────────────────────

FROM node:20-alpine AS production

# Installer wget pour le HEALTHCHECK (disponible dans alpine via busybox)
# Regrouper en une seule couche RUN pour limiter la taille de l'image
RUN apk add --no-cache wget \
    && addgroup -g 1001 appgroup \
    && adduser -u 1001 -G appgroup -s /bin/sh -D appuser

WORKDIR /app

# Copier les dépendances depuis le stage deps (pas de node_modules de dev)
COPY --from=deps --chown=appuser:appgroup /app/node_modules ./node_modules

# Copier le code applicatif
# COPY granulaire plutôt que COPY . . — évite d'inclure des fichiers non listés
COPY --chown=appuser:appgroup src/ ./src/

# La base de connaissances est chargée au runtime depuis le filesystem
COPY --chown=appuser:appgroup knowledge/ ./knowledge/

# package.json pour process.env.npm_package_version dans les logs
COPY --chown=appuser:appgroup package.json ./

# Appliquer le principe de moindre privilège : le processus Node.js ne peut pas
# écrire hors de /app ni accéder aux fichiers root
USER appuser

# Port documenté — l'hôte fait le mapping via docker run -p ou docker-compose
EXPOSE 3000

# HEALTHCHECK natif Docker :
# --interval  : fréquence de vérification
# --timeout   : délai max pour une réponse
# --start-period : délai de grâce au démarrage (Node.js + dotenv loading)
# --retries   : nombre d'échecs avant de passer à l'état "unhealthy"
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

# Utiliser la forme exec (tableau JSON) plutôt que la forme shell :
# - Pas de shell intermédiaire → SIGTERM reçu directement par Node.js
# - Arrêt gracieux (SIGTERM handler dans src/server/index.js)
CMD ["node", "src/server/index.js"]
