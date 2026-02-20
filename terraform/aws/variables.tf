# ════════════════════════════════════════════════════════════════
# Variables — AWS ECS Deployment
# ════════════════════════════════════════════════════════════════
#
# Utilisation :
#   terraform plan -var-file=prod.tfvars
#
# Exemple prod.tfvars (ne jamais committer ce fichier) :
#   container_image   = "ghcr.io/your-user/ai-agent-devops-demo:v1.2.3"
#   anthropic_api_key = "sk-ant-..."
#   langfuse_public_key = "pk-lf-..."
#   langfuse_secret_key = "sk-lf-..."

# ── Identité du projet ───────────────────────────────────────────

variable "project_name" {
  description = "Nom du projet — utilisé comme préfixe pour toutes les ressources AWS"
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

# ── Infrastructure ───────────────────────────────────────────────

variable "aws_region" {
  description = "Région AWS de déploiement"
  type        = string
  default     = "eu-west-1"
}

variable "container_image" {
  description = "Image Docker à déployer (ex: ghcr.io/user/repo:v1.2.3)"
  type        = string
  # Pas de default — doit être fourni explicitement pour chaque déploiement
}

variable "desired_count" {
  description = "Nombre de tâches ECS en cours d'exécution"
  type        = number
  default     = 1
}

variable "task_cpu" {
  description = "CPU alloué à la tâche ECS (unités CPU Fargate : 256=0.25vCPU)"
  type        = number
  default     = 256

  validation {
    condition     = contains([256, 512, 1024, 2048, 4096], var.task_cpu)
    error_message = "task_cpu doit être une valeur Fargate valide : 256, 512, 1024, 2048 ou 4096."
  }
}

variable "task_memory" {
  description = "Mémoire allouée à la tâche ECS (MiB)"
  type        = number
  default     = 512
}

# ── Secrets (sensibles — ne jamais afficher dans les logs) ────────

variable "anthropic_api_key" {
  description = "Clé API Anthropic Claude — stockée dans AWS Secrets Manager"
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

variable "rate_limit_max" {
  description = "Nombre max de requêtes par fenêtre (rate limiting)"
  type        = number
  default     = 20
}
