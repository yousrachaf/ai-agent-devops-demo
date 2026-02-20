# ════════════════════════════════════════════════════════════════
# Variables — GCP Cloud Run Deployment
# ════════════════════════════════════════════════════════════════

# ── Identité du projet ───────────────────────────────────────────

variable "project_name" {
  description = "Nom du projet — utilisé comme préfixe pour toutes les ressources GCP"
  type        = string
  default     = "ai-agent-demo"

  validation {
    condition     = can(regex("^[a-z0-9-]+$", var.project_name))
    error_message = "project_name doit être en minuscules, chiffres et tirets uniquement."
  }
}

variable "environment" {
  description = "Environnement de déploiement"
  type        = string
  default     = "prod"

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment doit être dev, staging ou prod."
  }
}

# ── Infrastructure GCP ───────────────────────────────────────────

variable "gcp_project_id" {
  description = "ID du projet GCP (ex: my-project-123456)"
  type        = string
}

variable "gcp_region" {
  description = "Région GCP de déploiement"
  type        = string
  default     = "europe-west1"
}

variable "container_image" {
  description = "Image Docker à déployer (ex: ghcr.io/user/repo:v1.2.3)"
  type        = string
}

# ── Scaling Cloud Run ────────────────────────────────────────────

variable "min_instances" {
  description = "Nombre minimum d'instances Cloud Run (0 = scale to zero — économique)"
  type        = number
  default     = 0
}

variable "max_instances" {
  description = "Nombre maximum d'instances Cloud Run"
  type        = number
  default     = 10
}

variable "cpu_limit" {
  description = "Limite CPU par instance Cloud Run (ex: '1', '2')"
  type        = string
  default     = "1"
}

variable "memory_limit" {
  description = "Limite mémoire par instance Cloud Run (ex: '512Mi', '1Gi')"
  type        = string
  default     = "512Mi"
}

variable "concurrency" {
  description = "Nombre max de requêtes simultanées par instance"
  type        = number
  default     = 80
}

# ── Accès ────────────────────────────────────────────────────────

variable "allow_public_access" {
  description = "Autoriser les requêtes non authentifiées (true = endpoint public)"
  type        = bool
  default     = true
}

# ── Secrets (sensibles) ──────────────────────────────────────────

variable "anthropic_api_key" {
  description = "Clé API Anthropic Claude — stockée dans GCP Secret Manager"
  type        = string
  sensitive   = true
}

variable "langfuse_public_key" {
  description = "Clé publique LangFuse (pk-lf-...)"
  type        = string
  sensitive   = true
}

variable "langfuse_secret_key" {
  description = "Clé secrète LangFuse (sk-lf-...)"
  type        = string
  sensitive   = true
}

# ── Configuration applicative ────────────────────────────────────

variable "langfuse_host" {
  description = "URL de l'instance LangFuse"
  type        = string
  default     = "https://cloud.langfuse.com"
}

variable "log_level" {
  description = "Niveau de log de l'application"
  type        = string
  default     = "warn"

  validation {
    condition     = contains(["debug", "info", "warn", "error"], var.log_level)
    error_message = "log_level doit être debug, info, warn ou error."
  }
}
