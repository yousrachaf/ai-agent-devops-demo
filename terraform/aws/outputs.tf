# ════════════════════════════════════════════════════════════════
# Outputs — AWS ECS
# ════════════════════════════════════════════════════════════════
# Ces valeurs sont affichées après terraform apply.
# Utiles pour configurer le CD pipeline et les DNS.

output "agent_url" {
  description = "URL publique de l'agent IA (via l'ALB)"
  value       = "http://${aws_lb.agent.dns_name}"
}

output "alb_dns_name" {
  description = "DNS de l'Application Load Balancer — à pointer avec un CNAME dans votre DNS"
  value       = aws_lb.agent.dns_name
}

output "ecs_cluster_name" {
  description = "Nom du cluster ECS — utilisé dans le pipeline CD pour les déploiements"
  value       = aws_ecs_cluster.main.name
}

output "ecs_service_name" {
  description = "Nom du service ECS — utilisé pour les mises à jour via aws ecs update-service"
  value       = aws_ecs_service.agent.name
}

output "cloudwatch_log_group" {
  description = "Nom du groupe de logs CloudWatch — pour les dashboards et alertes"
  value       = aws_cloudwatch_log_group.agent.name
}

output "secrets_manager_arns" {
  description = "ARNs des secrets Secrets Manager — référencer dans d'autres ressources Terraform"
  value = {
    anthropic_api_key   = aws_secretsmanager_secret.anthropic_api_key.arn
    langfuse_public_key = aws_secretsmanager_secret.langfuse_public_key.arn
    langfuse_secret_key = aws_secretsmanager_secret.langfuse_secret_key.arn
  }
  sensitive = true
}

output "health_check_command" {
  description = "Commande curl pour vérifier que l'agent est opérationnel"
  value       = "curl http://${aws_lb.agent.dns_name}/health"
}
