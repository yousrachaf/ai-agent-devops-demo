# ════════════════════════════════════════════════════════════════
# GCP Cloud Run — Déploiement de l'agent IA
# ════════════════════════════════════════════════════════════════
#
# Ressources créées :
#   - APIs GCP activées   : Cloud Run, Secret Manager, IAM
#   - Service Account     : identité du service Cloud Run
#   - Secret Manager      : clés API (Anthropic + LangFuse)
#   - IAM Bindings        : accès secrets + invocation Cloud Run
#   - Cloud Run Service   : service avec probes santé, scaling auto
#
# Avantages Cloud Run vs ECS pour ce use case :
#   - Scale to zero (min_instances=0) — coût ~$0 si pas de trafic
#   - Pas de gestion de load balancer — URL HTTPS automatique
#   - Déploiements atomiques avec rollback intégré
#
# Commandes :
#   terraform init
#   terraform plan -var-file=prod.tfvars
#   terraform apply -var-file=prod.tfvars

terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }

  # Backend GCS recommandé en production — décommenter et configurer
  # backend "gcs" {
  #   bucket = "your-terraform-state-bucket"
  #   prefix = "ai-agent-demo/terraform.tfstate"
  # }
}

provider "google" {
  project = var.gcp_project_id
  region  = var.gcp_region
}

# ── Locals ───────────────────────────────────────────────────────

locals {
  service_name = "${var.project_name}-${var.environment}"

  common_labels = {
    project     = var.project_name
    environment = var.environment
    managed-by  = "terraform"
  }
}

# ── APIs GCP requises ────────────────────────────────────────────
# Activer les APIs nécessaires — idempotent (pas de recréation si déjà actives)

resource "google_project_service" "run" {
  service            = "run.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "secretmanager" {
  service            = "secretmanager.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "iam" {
  service            = "iam.googleapis.com"
  disable_on_destroy = false
}

# ── Service Account ──────────────────────────────────────────────
# Identité du service Cloud Run — principe de moindre privilège :
# accès uniquement aux secrets nécessaires, pas d'autres permissions GCP.

resource "google_service_account" "cloud_run" {
  account_id   = "${var.project_name}-run-sa"
  display_name = "Service Account — ${local.service_name} Cloud Run"

  depends_on = [google_project_service.iam]
}

# ── Secret Manager ───────────────────────────────────────────────

resource "google_secret_manager_secret" "anthropic_api_key" {
  secret_id = "${local.service_name}-anthropic-api-key"
  labels    = local.common_labels

  replication {
    auto {}
  }

  depends_on = [google_project_service.secretmanager]
}

resource "google_secret_manager_secret_version" "anthropic_api_key" {
  secret      = google_secret_manager_secret.anthropic_api_key.id
  secret_data = var.anthropic_api_key

  lifecycle {
    ignore_changes = [secret_data]
  }
}

resource "google_secret_manager_secret" "langfuse_public_key" {
  secret_id = "${local.service_name}-langfuse-public-key"
  labels    = local.common_labels

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "langfuse_public_key" {
  secret      = google_secret_manager_secret.langfuse_public_key.id
  secret_data = var.langfuse_public_key

  lifecycle {
    ignore_changes = [secret_data]
  }
}

resource "google_secret_manager_secret" "langfuse_secret_key" {
  secret_id = "${local.service_name}-langfuse-secret-key"
  labels    = local.common_labels

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "langfuse_secret_key" {
  secret      = google_secret_manager_secret.langfuse_secret_key.id
  secret_data = var.langfuse_secret_key

  lifecycle {
    ignore_changes = [secret_data]
  }
}

# ── IAM — Accès aux secrets ──────────────────────────────────────
# Le service account peut lire les secrets — rien de plus

resource "google_secret_manager_secret_iam_member" "anthropic_api_key" {
  secret_id = google_secret_manager_secret.anthropic_api_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run.email}"
}

resource "google_secret_manager_secret_iam_member" "langfuse_public_key" {
  secret_id = google_secret_manager_secret.langfuse_public_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run.email}"
}

resource "google_secret_manager_secret_iam_member" "langfuse_secret_key" {
  secret_id = google_secret_manager_secret.langfuse_secret_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run.email}"
}

# ── Cloud Run Service ─────────────────────────────────────────────

resource "google_cloud_run_v2_service" "agent" {
  name     = local.service_name
  location = var.gcp_region
  labels   = local.common_labels

  template {
    service_account = google_service_account.cloud_run.email

    scaling {
      # Scale to zero économise les coûts — la première requête a ~1s de cold start
      # Passer à min_instance_count = 1 si la latence est critique
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    # Nombre de requêtes simultanées par instance — 80 est un bon équilibre
    max_instance_request_concurrency = var.concurrency

    containers {
      image = var.container_image

      ports {
        container_port = 3000
      }

      resources {
        limits = {
          cpu    = var.cpu_limit
          memory = var.memory_limit
        }
        # Allouer le CPU uniquement pendant les requêtes (économie de coût)
        cpu_idle = true
      }

      # Variables d'environnement non sensibles
      env {
        name  = "NODE_ENV"
        value = "production"
      }

      env {
        name  = "PORT"
        value = "3000"
      }

      env {
        name  = "LOG_LEVEL"
        value = var.log_level
      }

      env {
        name  = "LANGFUSE_HOST"
        value = var.langfuse_host
      }

      env {
        name  = "LANGFUSE_ENABLED"
        value = "true"
      }

      # Secrets injectés comme variables d'environnement depuis Secret Manager
      env {
        name = "ANTHROPIC_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.anthropic_api_key.secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "LANGFUSE_PUBLIC_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.langfuse_public_key.secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "LANGFUSE_SECRET_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.langfuse_secret_key.secret_id
            version = "latest"
          }
        }
      }

      # Startup probe : vérifié une fois au démarrage du container
      startup_probe {
        http_get {
          path = "/health"
          port = 3000
        }
        initial_delay_seconds = 10
        timeout_seconds       = 5
        period_seconds        = 10
        failure_threshold     = 3
      }

      # Liveness probe : vérifié périodiquement — redémarre le container si KO
      liveness_probe {
        http_get {
          path = "/health"
          port = 3000
        }
        initial_delay_seconds = 30
        timeout_seconds       = 5
        period_seconds        = 30
        failure_threshold     = 3
      }
    }
  }

  depends_on = [
    google_project_service.run,
    google_secret_manager_secret_iam_member.anthropic_api_key,
    google_secret_manager_secret_iam_member.langfuse_public_key,
    google_secret_manager_secret_iam_member.langfuse_secret_key,
  ]

  lifecycle {
    # Permet les déploiements d'images hors Terraform sans conflit
    ignore_changes = [
      template[0].containers[0].image,
      client,
      client_version,
    ]
  }
}

# ── IAM — Accès public (optionnel) ──────────────────────────────
# Si allow_public_access = false, seuls les services GCP authentifiés
# peuvent invoquer le Cloud Run (plus sécurisé pour les APIs internes)

resource "google_cloud_run_v2_service_iam_member" "public_access" {
  count = var.allow_public_access ? 1 : 0

  name     = google_cloud_run_v2_service.agent.name
  location = google_cloud_run_v2_service.agent.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}
