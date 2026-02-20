# ai-agent-devops-demo

![CI](https://github.com/your-username/ai-agent-devops-demo/actions/workflows/ci.yml/badge.svg)
![Docker](https://img.shields.io/badge/docker-ready-blue?logo=docker)
![LangFuse](https://img.shields.io/badge/observability-langfuse-purple)
![Claude API](https://img.shields.io/badge/powered%20by-Claude%20API-orange)
![License](https://img.shields.io/badge/license-MIT-green)
![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen?logo=node.js)
![Coverage](https://img.shields.io/badge/coverage-%3E80%25-brightgreen)

> Agent IA déployé en production avec monitoring complet. Démontre les bonnes pratiques DevOps
> pour les applications IA : observabilité, CI/CD, sécurité, déploiement cloud.

Un agent IA qui répond aux questions sur la documentation d'une API fictive (TechCorp API).
Architecture production-ready : retry automatique, tracing LangFuse, rate limiting, CI/CD complet,
déploiement Terraform sur AWS ECS ou GCP Cloud Run.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLIENT HTTP                                  │
│               POST /api/ask  { question, session_id }               │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     EXPRESS SERVER (port 3000)                       │
│                                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  Helmet  │  │   CORS   │  │ Rate Limiter │  │  API Key Auth │  │
│  │ (headers)│  │(origines)│  │ (20 req/min) │  │  (optionnel)  │  │
│  └──────────┘  └──────────┘  └──────────────┘  └───────────────┘  │
│                                    │                                 │
│                              ┌─────▼──────┐                        │
│                              │   ROUTES   │                        │
│                              │ POST /ask  │                        │
│                              │ GET /health│                        │
│                              │GET /metrics│                        │
│                              └─────┬──────┘                        │
└────────────────────────────────────┼───────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          AGENT ORCHESTRATOR                          │
│                                                                      │
│  ┌──────────────────────────┐    ┌──────────────────────────────┐  │
│  │    KNOWLEDGE BASE        │    │       CLAUDE WRAPPER         │  │
│  │                          │    │                              │  │
│  │  knowledge/*.md          │    │  • Retry 3x (backoff expo.)  │  │
│  │  → chunks par heading    │───▶│  • Timeout 30s               │  │
│  │  → scoring TF-IDF léger  │    │  • Coût calculé ($/token)    │  │
│  │  → top 3 chunks          │    │  • claude-sonnet-4-5         │  │
│  └──────────────────────────┘    └──────────────┬───────────────┘  │
│                                                  │                  │
│  ┌───────────────────────────────────────────────┼──────────────┐  │
│  │              LANGFUSE TRACING (async)          │              │  │
│  │  trace_id • tokens • coût • latence • chunks  │              │  │
│  └───────────────────────────────────────────────┼──────────────┘  │
└──────────────────────────────────────────────────┼─────────────────┘
                                                   │
                          ┌────────────────────────┼───────────────┐
                          │                        ▼               │
                          │          ┌─────────────────────────┐   │
                          │          │      CLAUDE API          │   │
                          │          │   (Anthropic cloud)      │   │
                          │          └─────────────────────────┘   │
                          │                                         │
                          │          ┌─────────────────────────┐   │
                          │          │     LANGFUSE CLOUD       │   │
                          │          │  (ou self-hosted Docker) │   │
                          │          └─────────────────────────┘   │
                          └─────────────────────────────────────────┘
```

---

## Démarrage rapide (< 5 minutes)

**Pré-requis :** Docker, Docker Compose, clé API Anthropic.

```bash
# 1. Cloner et configurer les variables d'environnement
git clone https://github.com/your-username/ai-agent-devops-demo.git
cd ai-agent-devops-demo
cp .env.example .env
# → Éditer .env : renseigner ANTHROPIC_API_KEY et les clés LangFuse

# 2. Démarrer la stack complète (agent + LangFuse + PostgreSQL)
docker-compose up -d

# 3. Tester l'agent
curl -X POST http://localhost:3000/api/ask \
  -H "Content-Type: application/json" \
  -d '{"question": "What are the rate limits for the TechCorp API?"}'
```

**Réponse attendue :**
```json
{
  "answer": "The TechCorp API has three rate limit tiers: Free (60 req/min), Starter (300 req/min), Pro (1000 req/min)...",
  "trace_id": "550e8400-e29b-41d4-a716-446655440000",
  "latency_ms": 1243,
  "tokens_used": 680,
  "cost_usd": 0.0021,
  "knowledge_chunks": ["api-reference#rate-limits", "faq#rate-limits"]
}
```

**Dashboard LangFuse :** http://localhost:3001 (créer un compte au premier démarrage)

---

## Monitoring LangFuse

LangFuse trace chaque appel Claude avec les métriques complètes :

| Métrique tracée    | Description                                    |
|--------------------|------------------------------------------------|
| `trace_id`         | UUID unique par requête — corrélation des logs |
| `session_id`       | Grouper les échanges d'une même conversation   |
| `input` / `output` | Question et réponse complètes                  |
| `model`            | Nom du modèle Claude utilisé                   |
| `tokens_input`     | Tokens consommés en entrée                     |
| `tokens_output`    | Tokens consommés en sortie                     |
| `cost_usd`         | Coût estimé en dollars (input + output)        |
| `latency_ms`       | Latence end-to-end de l'appel Claude           |
| `knowledge_chunks` | IDs des chunks de la KB utilisés               |

**Accès au dashboard :**

```bash
# Démarrage local
docker-compose up -d
open http://localhost:3001

# Premier démarrage : créer un compte → créer un projet → Settings → API Keys
# Puis mettre à jour LANGFUSE_PUBLIC_KEY et LANGFUSE_SECRET_KEY dans .env
docker-compose restart agent
```

**Alertes coût recommandées :** Configurer une alerte à $5/jour dans LangFuse → Settings → Billing Alerts.

---

## CI/CD Pipeline

```
Push → GitHub Actions
│
├── lint          ESLint — zéro tolérance sur le code de production
│
├── test          Jest 30 tests, coverage > 80%, artefact lcov uploadé
│
├── build         Docker build (cache GHA BuildKit), image exportée en .tar
│
├── scan          Trivy — scan CVE sur l'image, résultats uploadés GitHub Security
│
├── push ─────── (main seulement) ghcr.io/user/ai-agent-devops-demo:sha-xxxxx
│                                                     :latest
│
└── prompt-tests  (optionnel, si ENABLE_PROMPT_TESTS=true) 4 tests Claude réels
                  • Réponse en français
                  • Citation knowledge base
                  • Refus hors périmètre
                  • Latence < 8s

Release tag v*.*.* → CD Pipeline
│
├── deploy        SSH → VPS → docker pull + compose up (sauvegarde .previous-tag)
│
├── healthcheck   10 tentatives × 5s → GET /health → 200 OK
│
├── rollback      (si healthcheck échoue) → redéploie .previous-tag automatiquement
│
└── notify        Slack (si SLACK_WEBHOOK_URL configuré)
```

**Secrets GitHub à configurer (Settings → Secrets → Actions) :**

| Secret                | Description                              |
|-----------------------|------------------------------------------|
| `ANTHROPIC_API_KEY`   | Clé API Anthropic pour les prompt tests  |
| `LANGFUSE_PUBLIC_KEY` | Clé publique LangFuse                    |
| `LANGFUSE_SECRET_KEY` | Clé secrète LangFuse                     |
| `DEPLOY_HOST`         | IP ou hostname du VPS de production      |
| `DEPLOY_USER`         | Utilisateur SSH de déploiement           |
| `DEPLOY_KEY`          | Clé SSH privée (RSA ou Ed25519)          |

---

## Docker

```bash
# Développement — build local + stack complète
docker-compose up                          # Stack de base (agent + LangFuse + PostgreSQL)
docker-compose --profile analytics up     # + ClickHouse pour analytics avancées (LangFuse v3)
docker-compose up agent                   # Agent seul (si LangFuse déjà démarré)
docker-compose restart agent              # Redémarrer après changement .env
docker-compose logs -f agent              # Logs en temps réel
docker-compose down                       # Arrêter (conserve les volumes)
docker-compose down -v                    # Arrêter + supprimer les volumes

# Image de production
docker build -t ai-agent-devops-demo:latest .
docker run -p 3000:3000 --env-file .env ai-agent-devops-demo:latest

# Inspecter l'image
docker images ai-agent-devops-demo        # Taille : ~143MB
docker run --rm ai-agent-devops-demo:latest id  # uid=1001(appuser) — non-root confirmé

# Production (avec docker-compose.prod.yml)
IMAGE_TAG=sha-abc1234 GITHUB_USER=your-username \
  docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

**Caractéristiques de l'image :**
- Base : `node:20-alpine` (minimal)
- Build multi-stage : `deps` → `production` (node_modules prod seulement)
- Utilisateur non-root : `appuser` uid=1001
- Health check intégré : `wget /health` toutes les 30s
- Taille finale : ~143MB

---

## Déploiement Cloud

### AWS — ECS Fargate

```bash
cd terraform/aws

# Configurer les variables
cat > prod.tfvars <<EOF
gcp_project_id     = "your-project-id"   # ou aws_region pour AWS
container_image    = "ghcr.io/your-username/ai-agent-devops-demo:latest"
anthropic_api_key  = "sk-ant-api03-..."
langfuse_public_key = "pk-lf-..."
langfuse_secret_key = "sk-lf-..."
EOF

# Déployer
terraform init
terraform plan -var-file=prod.tfvars
terraform apply -var-file=prod.tfvars

# Outputs utiles
terraform output agent_url          # http://xxx.elb.amazonaws.com
terraform output health_check_command
```

**Ressources créées :**
- VPC default + Security Groups (ALB port 80, ECS port 3000)
- Application Load Balancer + Target Group (health check `/health`)
- ECS Cluster + Task Definition (Fargate, 256CPU/512MB)
- IAM Role avec accès Secrets Manager uniquement
- Secrets Manager (3 secrets : Anthropic + LangFuse)
- CloudWatch Log Group (rétention 30 jours)

### GCP — Cloud Run

```bash
cd terraform/gcp

cat > prod.tfvars <<EOF
gcp_project_id     = "my-gcp-project-123"
container_image    = "ghcr.io/your-username/ai-agent-devops-demo:latest"
anthropic_api_key  = "sk-ant-api03-..."
langfuse_public_key = "pk-lf-..."
langfuse_secret_key = "sk-lf-..."
EOF

terraform init
terraform plan -var-file=prod.tfvars
terraform apply -var-file=prod.tfvars

terraform output agent_url          # https://ai-agent-demo-prod-xxxx-uc.a.run.app
```

**Avantages Cloud Run vs ECS pour ce use case :**
- Scale to zero (`min_instances=0`) — coût ~$0 sans trafic
- URL HTTPS automatique (pas de load balancer à gérer)
- Déploiements atomiques avec rollback intégré en une commande

---

## Tests

```bash
# Tests unitaires (mock Claude — aucun coût)
npm test                    # 30 tests, ~3s
npm run test:coverage       # + rapport de couverture (>80%)

# Tests de qualité IA (appels Claude réels — ~$0.01 par run)
ENABLE_PROMPT_TESTS=true npm test -- tests/prompts/quality.test.js

# Lint
npm run lint                # Zéro tolérance (no-console, no-unused-vars)
npm run lint:fix            # Correction automatique des erreurs fixables
```

**Couverture actuelle :**

| Module         | Lignes | Branches | Fonctions |
|----------------|--------|----------|-----------|
| `src/agent/`   | >85%   | >80%     | 100%      |
| `src/server/`  | >90%   | >85%     | 100%      |
| Global         | >80%   | >80%     | >95%      |

**Tests de qualité IA (`tests/prompts/quality.test.js`) :**

| Test                              | Assertion                                     |
|-----------------------------------|-----------------------------------------------|
| Détection de langue               | Réponse en français si question en français   |
| Citation knowledge base           | ≥1 chunk "rate" utilisé pour les rate limits  |
| Refus hors périmètre              | Refuse de donner une recette de gâteau        |
| Latence                           | Répond en < 8s pour une question simple       |

---

## Sécurité

**Implémenté par défaut :**

| Mesure               | Détail                                                      |
|----------------------|-------------------------------------------------------------|
| Headers HTTP sécurisés | Helmet.js : CSP, HSTS, X-Frame-Options, etc.              |
| Rate limiting        | 20 req/min par IP (configurable via `RATE_LIMIT_MAX`)       |
| CORS                 | Origines whitelist via `CORS_ORIGINS` (pas de `*` en prod) |
| Validation input     | Longueur max 2000 caractères sur `question`                |
| Utilisateur non-root | Image Docker uid=1001 — pas de privileges d'escalade        |
| Secrets externalisés | Jamais dans le code — env vars ou Secrets Manager          |

**Optionnel (configurable) :**

| Mesure               | Activation                             |
|----------------------|----------------------------------------|
| API Key auth         | `API_KEY_REQUIRED=true` dans `.env`    |
| HTTPS                | Termination TLS sur ALB (AWS) ou Cloud Run (GCP) |
| Scan CVE             | Trivy automatique dans la CI à chaque build     |

**Générer une API Key sécurisée :**
```bash
openssl rand -hex 32
# → Mettre la valeur dans API_KEY et activer API_KEY_REQUIRED=true
```

**Headers envoyés avec chaque requête (Helmet) :**
```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 0
Strict-Transport-Security: max-age=31536000; includeSubDomains
Content-Security-Policy: default-src 'self'
```

---

## Structure du projet

```
ai-agent-devops-demo/
│
├── src/
│   ├── agent/
│   │   ├── index.js          # Orchestrateur : KB → Claude → LangFuse → réponse
│   │   ├── claude.js         # Wrapper Claude API (retry, timeout, coût)
│   │   ├── knowledge.js      # Chargement + scoring des chunks Markdown
│   │   └── tracing.js        # Fire-and-forget LangFuse (ne bloque jamais la réponse)
│   ├── server/
│   │   ├── index.js          # Factory createApp() + graceful shutdown SIGTERM
│   │   ├── routes.js         # POST /api/ask, GET /health, GET /metrics
│   │   └── middleware.js     # Helmet, CORS, rate limiter, API key, validation
│   └── utils/
│       └── logger.js         # pino — JSON en prod, pretty-print en dev
│
├── knowledge/                # Base de connaissances Markdown (TechCorp API fictive)
│   ├── api-reference.md      # Auth, rate limits, endpoints, webhooks, SDKs
│   ├── faq.md                # 10 questions fréquentes développeurs
│   └── troubleshooting.md    # 5 problèmes courants + solutions pas-à-pas
│
├── tests/
│   ├── unit/
│   │   ├── agent.test.js     # 14 tests agent (Claude mock, retry, LangFuse)
│   │   └── server.test.js    # 16 tests HTTP (routes, middleware, rate limit)
│   └── prompts/
│       └── quality.test.js   # 4 tests IA réels (désactivés par défaut)
│
├── .github/
│   └── workflows/
│       ├── ci.yml            # lint → test → build → scan → push → prompt-tests
│       └── cd.yml            # deploy → healthcheck → rollback → notify
│
├── terraform/
│   ├── aws/                  # ECS Fargate + ALB + Secrets Manager + CloudWatch
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   └── gcp/                  # Cloud Run v2 + Secret Manager + IAM
│       ├── main.tf
│       ├── variables.tf
│       └── outputs.tf
│
├── Dockerfile                # Multi-stage (deps → production), non-root uid=1001
├── docker-compose.yml        # Dev : agent + LangFuse + PostgreSQL (+ ClickHouse opt-in)
├── docker-compose.prod.yml   # Prod : image ghcr.io, limites CPU/mémoire, no .env
├── .env.example              # Template variables d'environnement (toutes documentées)
├── .dockerignore             # Exclut tests/, terraform/, .env, node_modules/
├── .eslintrc.js              # eslint:recommended + no-console + no-unused-vars
└── jest.config.js            # Exclut tests/prompts/, coverage >80%, timeout 10s
```

---

## Variables d'environnement

| Variable               | Requis | Défaut                        | Description                                      |
|------------------------|--------|-------------------------------|--------------------------------------------------|
| `ANTHROPIC_API_KEY`    | Oui    | —                             | Clé API Anthropic (`sk-ant-api03-...`)           |
| `ANTHROPIC_MODEL`      | Non    | `claude-sonnet-4-5-20250929`  | Modèle Claude à utiliser                         |
| `ANTHROPIC_TIMEOUT_MS` | Non    | `30000`                       | Timeout appels Claude (ms)                       |
| `LANGFUSE_PUBLIC_KEY`  | Oui*   | —                             | Clé publique LangFuse (`pk-lf-...`)              |
| `LANGFUSE_SECRET_KEY`  | Oui*   | —                             | Clé secrète LangFuse (`sk-lf-...`)               |
| `LANGFUSE_HOST`        | Non    | `https://cloud.langfuse.com`  | Host LangFuse (cloud ou self-hosted)             |
| `LANGFUSE_ENABLED`     | Non    | `true`                        | Désactiver en test : `false`                     |
| `PORT`                 | Non    | `3000`                        | Port d'écoute du serveur HTTP                    |
| `NODE_ENV`             | Non    | `development`                 | `production` active JSON logs + optimisations    |
| `LOG_LEVEL`            | Non    | `info`                        | `debug`, `info`, `warn`, `error`                 |
| `API_KEY_REQUIRED`     | Non    | `false`                       | `true` = header `X-API-Key` obligatoire          |
| `API_KEY`              | Non    | —                             | Valeur de la clé API (si `API_KEY_REQUIRED=true`)|
| `RATE_LIMIT_WINDOW_MS` | Non    | `60000`                       | Fenêtre du rate limiter (ms)                     |
| `RATE_LIMIT_MAX`       | Non    | `20`                          | Requêtes max par IP par fenêtre                  |
| `CORS_ORIGINS`         | Non    | `http://localhost:3000`       | Origines CORS autorisées (virgules)              |
| `ENABLE_PROMPT_TESTS`  | Non    | `false`                       | Activer les tests IA réels (coûteux)             |

*Requis si `LANGFUSE_ENABLED=true` (défaut).

---

## Contribution

### Standards de code

- **Pas de `console.log`** — utiliser `logger.info/warn/error` (pino)
- **Gestion d'erreurs explicite** — chaque `catch` doit logger l'erreur ET propager ou retourner
- **Variables d'env** — jamais de valeurs en dur, toujours via `process.env.*`
- **Tests obligatoires** — tout nouveau code doit avoir une couverture >80%

### Workflow

```bash
# Fork → clone → branche
git checkout -b feat/ma-feature

# Développer avec auto-reload
npm run dev

# Vérifier avant de commiter
npm run lint && npm test

# Commit avec message conventionnel
git commit -m "feat: ajouter support multi-langue"

# Push → Pull Request
git push origin feat/ma-feature
```

### Conventions de commit

| Préfixe    | Usage                                      |
|------------|--------------------------------------------|
| `feat:`    | Nouvelle fonctionnalité                    |
| `fix:`     | Correction de bug                          |
| `docs:`    | Documentation uniquement                  |
| `test:`    | Ajout ou correction de tests              |
| `refactor:`| Refactoring sans changement de comportement|
| `chore:`   | Maintenance (deps, config, CI)             |

---

## License

[MIT](LICENSE) — Yousra, 2025

---

*Construit pour démontrer les bonnes pratiques de déploiement d'agents IA en production.*
*Stack complète disponible comme template sur Gumroad.*
