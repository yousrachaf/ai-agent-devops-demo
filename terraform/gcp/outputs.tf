# ════════════════════════════════════════════════════════════════
# Outputs — GCP Cloud Run
# ════════════════════════════════════════════════════════════════
# Ces valeurs sont affichées après terraform apply.
# Utiles pour configurer le CD pipeline et les DNS.

output "agent_url" {
  description = "URL HTTPS de l'agent IA (Cloud Run fournit automatiquement TLS)"
  value       = google_cloud_run_v2_service.agent.uri
}

output "cloud_run_service_name" {
  description = "Nom du service Cloud Run — utilisé dans le pipeline CD pour les déploiements"
  value       = google_cloud_run_v2_service.agent.name
}

output "cloud_run_location" {
  description = "Région du service Cloud Run"
  value       = google_cloud_run_v2_service.agent.location
}

output "service_account_email" {
  description = "Email du Service Account Cloud Run — référencer pour les IAM bindings additionnels"
  value       = google_service_account.cloud_run.email
}

output "secret_ids" {
  description = "IDs des secrets Secret Manager — référencer dans d'autres ressources Terraform"
  value = {
    anthropic_api_key   = google_secret_manager_secret.anthropic_api_key.secret_id
    langfuse_public_key = google_secret_manager_secret.langfuse_public_key.secret_id
    langfuse_secret_key = google_secret_manager_secret.langfuse_secret_key.secret_id
  }
  sensitive = true
}

output "health_check_command" {
  description = "Commande curl pour vérifier que l'agent est opérationnel"
  value       = "curl ${google_cloud_run_v2_service.agent.uri}/health"
}

output "deploy_command" {
  description = "Commande gcloud pour déployer une nouvelle image sans Terraform"
  value       = "gcloud run deploy ${google_cloud_run_v2_service.agent.name} --image NEW_IMAGE --region ${google_cloud_run_v2_service.agent.location} --project ${var.gcp_project_id}"
}
