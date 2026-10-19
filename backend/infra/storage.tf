locals {
  name = "grupuxo-${var.environment}"
}

# Tabela única sob demanda: espelha `src/adapters/dynamodb/table-definition.ts` (BACKEND.md seção 4).
resource "aws_dynamodb_table" "main" {
  name         = local.name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  attribute {
    name = "PK"
    type = "S"
  }
  attribute {
    name = "SK"
    type = "S"
  }
  attribute {
    name = "GSI1PK"
    type = "S"
  }
  attribute {
    name = "GSI1SK"
    type = "S"
  }

  global_secondary_index {
    name            = "GSI1"
    hash_key        = "GSI1PK"
    range_key       = "GSI1SK"
    projection_type = "ALL"
  }

  # Época Unix em segundos; o TTL só limpa, a lógica nunca depende dele.
  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  # Proteção contra exclusão também no dev: a tabela foi apagada por engano em out/2026 (BACKEND.md seção 10).
  # Apagar de propósito exige desligar isto antes. PITR fica para `prod`.
  deletion_protection_enabled = true

  point_in_time_recovery {
    enabled = false
  }
}

# Fila do webhook para o worker: FIFO por telefone, deduplicação pelo `wamid` (nunca pelo conteúdo).
resource "aws_sqs_queue" "whatsapp_dlq" {
  name                        = "${local.name}-whatsapp-dlq.fifo"
  fifo_queue                  = true
  content_based_deduplication = false
  message_retention_seconds   = 14 * 24 * 60 * 60
}

resource "aws_sqs_queue" "whatsapp" {
  name                        = "${local.name}-whatsapp.fifo"
  fifo_queue                  = true
  content_based_deduplication = false
  # Pelo menos 6x o timeout do worker (recomendação da AWS para gatilho SQS).
  visibility_timeout_seconds = 6 * local.worker_timeout_seconds
  message_retention_seconds  = 24 * 60 * 60

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.whatsapp_dlq.arn
    maxReceiveCount     = 3
  })
}

# Segredo **sem valor**: o dono grava o JSON pelo console, e o valor nunca entra no estado do Terraform.
resource "aws_secretsmanager_secret" "whatsapp" {
  name        = "grupuxo/${var.environment}/whatsapp"
  description = "WHATSAPP_TOKEN, WHATSAPP_APP_SECRET, PHONE_NUMBER_ID, VERIFY_TOKEN, GEMINI_API_KEY (BACKEND.md seção 10)"
}

# Sem alarme da DLQ no Terraform: o usuário de deploy não tem cloudwatch:ListTagsForResource, que o provider exige.
# O alarme grupuxo-dev-whatsapp-dlq-not-empty criado antes continua na conta, fora do Terraform. Fila com
# mensagens: ver `dlq_url` (README, Diagnóstico).
