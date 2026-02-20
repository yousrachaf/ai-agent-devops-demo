# ════════════════════════════════════════════════════════════════
# AWS ECS Fargate — Déploiement de l'agent IA
# ════════════════════════════════════════════════════════════════
#
# Ressources créées :
#   - Secrets Manager  : clés API (Anthropic + LangFuse)
#   - IAM              : rôle ECS + politique d'accès aux secrets
#   - ECS Cluster      : cluster Fargate avec Container Insights
#   - ECS Task         : définition de la tâche avec healthcheck natif
#   - ECS Service      : service avec déploiement rolling
#   - ALB              : Application Load Balancer (HTTP → port 3000)
#   - Security Groups  : ALB (port 80) + ECS tasks (port 3000 depuis ALB)
#   - CloudWatch Logs  : logs structurés avec rétention 30j
#
# Commandes :
#   terraform init
#   terraform plan -var-file=prod.tfvars
#   terraform apply -var-file=prod.tfvars

terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Backend S3 recommandé en production — décommenter et configurer
  # backend "s3" {
  #   bucket         = "your-terraform-state-bucket"
  #   key            = "ai-agent-demo/terraform.tfstate"
  #   region         = "eu-west-1"
  #   encrypt        = true
  #   dynamodb_table = "terraform-state-lock"
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = local.common_tags
  }
}

# ── Locals ───────────────────────────────────────────────────────

locals {
  name_prefix = "${var.project_name}-${var.environment}"

  common_tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
    Repository  = "ai-agent-devops-demo"
  }
}

# ── Data Sources — VPC par défaut ────────────────────────────────
# Utilise le VPC par défaut pour simplifier le démo.
# En production, créer un VPC dédié avec subnets privés.

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

# ── Secrets Manager ──────────────────────────────────────────────
# Les secrets sont injectés comme variables d'environnement ECS
# sans jamais transiter par les logs ou les variables Terraform en clair.

resource "aws_secretsmanager_secret" "anthropic_api_key" {
  name                    = "${local.name_prefix}/anthropic-api-key"
  description             = "Clé API Anthropic Claude pour ${local.name_prefix}"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "anthropic_api_key" {
  secret_id     = aws_secretsmanager_secret.anthropic_api_key.id
  secret_string = var.anthropic_api_key

  # Ne pas recréer la version si la valeur change hors Terraform (rotation manuelle)
  lifecycle {
    ignore_changes = [secret_string]
  }
}

resource "aws_secretsmanager_secret" "langfuse_public_key" {
  name                    = "${local.name_prefix}/langfuse-public-key"
  description             = "Clé publique LangFuse pour ${local.name_prefix}"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "langfuse_public_key" {
  secret_id     = aws_secretsmanager_secret.langfuse_public_key.id
  secret_string = var.langfuse_public_key

  lifecycle {
    ignore_changes = [secret_string]
  }
}

resource "aws_secretsmanager_secret" "langfuse_secret_key" {
  name                    = "${local.name_prefix}/langfuse-secret-key"
  description             = "Clé secrète LangFuse pour ${local.name_prefix}"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "langfuse_secret_key" {
  secret_id     = aws_secretsmanager_secret.langfuse_secret_key.id
  secret_string = var.langfuse_secret_key

  lifecycle {
    ignore_changes = [secret_string]
  }
}

# ── IAM — Rôle d'exécution ECS ───────────────────────────────────
# Ce rôle permet à ECS de : pull l'image, écrire les logs CloudWatch,
# et lire les secrets Secrets Manager.

resource "aws_iam_role" "ecs_task_execution" {
  name = "${local.name_prefix}-ecs-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Politique inline pour accéder aux secrets — principe de moindre privilège :
# accès uniquement aux secrets de ce projet
resource "aws_iam_role_policy" "ecs_secrets_access" {
  name = "${local.name_prefix}-secrets-access"
  role = aws_iam_role.ecs_task_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["secretsmanager:GetSecretValue"]
      Resource = [
        aws_secretsmanager_secret.anthropic_api_key.arn,
        aws_secretsmanager_secret.langfuse_public_key.arn,
        aws_secretsmanager_secret.langfuse_secret_key.arn,
      ]
    }]
  })
}

# ── CloudWatch Logs ──────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "agent" {
  name              = "/ecs/${local.name_prefix}"
  retention_in_days = 30
}

# ── Security Groups ──────────────────────────────────────────────

resource "aws_security_group" "alb" {
  name        = "${local.name_prefix}-alb"
  description = "Trafic entrant vers l'ALB (HTTP port 80)"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "HTTP depuis internet"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "Tout le trafic sortant"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "ecs_tasks" {
  name        = "${local.name_prefix}-ecs-tasks"
  description = "Trafic entrant vers les tâches ECS (port 3000 depuis l'ALB uniquement)"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description     = "Port 3000 depuis l'ALB uniquement"
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    description = "Tout le trafic sortant (Claude API, LangFuse, ECR, Secrets Manager)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# ── ALB — Application Load Balancer ─────────────────────────────

resource "aws_lb" "agent" {
  name               = "${local.name_prefix}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = data.aws_subnets.default.ids

  # Activer les access logs en production :
  # access_logs { bucket = "your-logs-bucket" enabled = true }
}

resource "aws_lb_target_group" "agent" {
  name        = "${local.name_prefix}-tg"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = data.aws_vpc.default.id
  target_type = "ip"

  health_check {
    path                = "/health"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 10
    interval            = 30
    matcher             = "200"
  }
}

resource "aws_lb_listener" "agent" {
  load_balancer_arn = aws_lb.agent.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.agent.arn
  }
}

# ── ECS Cluster ──────────────────────────────────────────────────

resource "aws_ecs_cluster" "main" {
  name = local.name_prefix

  setting {
    name  = "containerInsights"
    value = "enabled" # Métriques CPU/mémoire dans CloudWatch
  }
}

# ── ECS Task Definition ──────────────────────────────────────────

resource "aws_ecs_task_definition" "agent" {
  family                   = local.name_prefix
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn

  container_definitions = jsonencode([{
    name  = "agent"
    image = var.container_image

    portMappings = [{
      containerPort = 3000
      protocol      = "tcp"
    }]

    # Les secrets sont injectés directement par ECS depuis Secrets Manager
    # Jamais exposés dans les logs de la task definition
    secrets = [
      {
        name      = "ANTHROPIC_API_KEY"
        valueFrom = aws_secretsmanager_secret.anthropic_api_key.arn
      },
      {
        name      = "LANGFUSE_PUBLIC_KEY"
        valueFrom = aws_secretsmanager_secret.langfuse_public_key.arn
      },
      {
        name      = "LANGFUSE_SECRET_KEY"
        valueFrom = aws_secretsmanager_secret.langfuse_secret_key.arn
      }
    ]

    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "PORT", value = "3000" },
      { name = "LOG_LEVEL", value = var.log_level },
      { name = "LANGFUSE_HOST", value = var.langfuse_host },
      { name = "LANGFUSE_ENABLED", value = "true" },
      { name = "RATE_LIMIT_MAX", value = tostring(var.rate_limit_max) },
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.agent.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "agent"
      }
    }

    healthCheck = {
      command     = ["CMD-SHELL", "wget -qO- http://localhost:3000/health || exit 1"]
      interval    = 30
      timeout     = 10
      retries     = 3
      startPeriod = 30
    }
  }])
}

# ── ECS Service ──────────────────────────────────────────────────

resource "aws_ecs_service" "agent" {
  name            = "${local.name_prefix}-agent"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.agent.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = data.aws_subnets.default.ids
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.agent.arn
    container_name   = "agent"
    container_port   = 3000
  }

  # Déploiement rolling : 0% min healthy, 200% max — pas de downtime
  deployment_minimum_healthy_percent = 50
  deployment_maximum_percent         = 200

  depends_on = [aws_lb_listener.agent]

  lifecycle {
    # Permet les déploiements manuels sans que Terraform reverte la task definition
    ignore_changes = [task_definition]
  }
}
