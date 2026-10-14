variable "account_id" {
  description = "Conta AWS do ambiente (o provider recusa qualquer outra)."
  type        = string
}

variable "aws_profile" {
  description = "Perfil local do AWS CLI (usuário IAM de deploy na conta do ambiente)."
  type        = string
  default     = "grupuxo-dev"
}

variable "region" {
  description = "Região (provisório: us-east-1, a mesma do Cognito; BACKEND.md pergunta 4)."
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Nome do ambiente; entra no nome dos recursos."
  type        = string
  default     = "dev"
}

variable "gemini_model" {
  description = "GEMINI_MODEL do worker (sem modelo padrão escondido; conferir que segue GA antes do apply)."
  type        = string
}

variable "graph_version" {
  description = "WHATSAPP_GRAPH_VERSION do worker, ex.: v25.0 (sem versão padrão escondida)."
  type        = string
}

variable "bot_phone_number" {
  description = "Número do bot em E.164 (BOT_PHONE_NUMBER; monta o link wa.me do vínculo)."
  type        = string
}

variable "rate_limit_max_messages" {
  description = "RATE_LIMIT_MAX_MESSAGES por número e janela."
  type        = number
}

variable "rate_limit_window_seconds" {
  description = "RATE_LIMIT_WINDOW_SECONDS."
  type        = number
}

variable "cognito_user_pool_id" {
  description = "User pool do app (o JWKS é público, então a api valida tokens de um pool de outra conta)."
  type        = string
}

variable "cognito_client_id" {
  description = "App client do app (conferido no client_id do access token)."
  type        = string
}

variable "reserved_concurrency" {
  description = "Concorrência reservada por Lambda (-1 = sem reserva). Conta nova costuma ter limite total 10, e a AWS recusa reservar abaixo do mínimo não reservado."
  type        = object({ api = number, webhook = number, worker = number })
  default     = { api = -1, webhook = -1, worker = -1 }
}

variable "log_retention_days" {
  description = "Retenção dos logs das Lambdas."
  type        = number
  default     = 14
}
