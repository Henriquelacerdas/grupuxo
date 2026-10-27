# Três Lambdas Node 22, um bundle cada (`npm run build` gera `../dist/<nome>/index.mjs` antes do plan).

locals {
  worker_timeout_seconds = 60

  lambdas = {
    webhook = { memory = 256, timeout = 10 }
    worker  = { memory = 512, timeout = local.worker_timeout_seconds }
    # 1769 MB = 1 vCPU: o tempo da `api` é CPU (carga e cópia da partição da casa), ver docs/LATENCIA.md.
    api     = { memory = 1769, timeout = 15 }
  }

  environment = {
    webhook = {
      SECRET_ID = aws_secretsmanager_secret.whatsapp.arn
      QUEUE_URL = aws_sqs_queue.whatsapp.url
    }
    worker = {
      SECRET_ID                 = aws_secretsmanager_secret.whatsapp.arn
      TABLE_NAME                = aws_dynamodb_table.main.name
      GEMINI_MODEL              = var.gemini_model
      WHATSAPP_GRAPH_VERSION    = var.graph_version
      RATE_LIMIT_MAX_MESSAGES   = tostring(var.rate_limit_max_messages)
      RATE_LIMIT_WINDOW_SECONDS = tostring(var.rate_limit_window_seconds)
      BOT_PHONE_NUMBER          = var.bot_phone_number
    }
    api = {
      TABLE_NAME           = aws_dynamodb_table.main.name
      COGNITO_USER_POOL_ID = var.cognito_user_pool_id
      COGNITO_CLIENT_ID    = var.cognito_client_id
      BOT_PHONE_NUMBER     = var.bot_phone_number
    }
  }
}

data "archive_file" "lambda" {
  for_each    = local.lambdas
  type        = "zip"
  source_file = "${path.module}/../dist/${each.key}/index.mjs"
  output_path = "${path.module}/build/${each.key}.zip"
}

resource "aws_cloudwatch_log_group" "lambda" {
  for_each          = local.lambdas
  name              = "/aws/lambda/${local.name}-${each.key}"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "lambda" {
  for_each         = local.lambdas
  function_name    = "${local.name}-${each.key}"
  role             = aws_iam_role.lambda[each.key].arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  handler          = "index.handler"
  filename         = data.archive_file.lambda[each.key].output_path
  source_code_hash = data.archive_file.lambda[each.key].output_base64sha256
  memory_size      = each.value.memory
  timeout          = each.value.timeout

  reserved_concurrent_executions = var.reserved_concurrency[each.key]

  environment {
    variables = local.environment[each.key]
  }

  logging_config {
    log_format = "JSON"
    log_group  = aws_cloudwatch_log_group.lambda[each.key].name
  }

  depends_on = [aws_iam_role_policy.logs]
}

resource "aws_lambda_event_source_mapping" "worker" {
  event_source_arn        = aws_sqs_queue.whatsapp.arn
  function_name           = aws_lambda_function.lambda["worker"].arn
  batch_size              = 5
  function_response_types = ["ReportBatchItemFailures"]

  depends_on = [aws_iam_role_policy.app]
}

# URLs públicas (`AuthType = NONE`): a defesa está no código (HMAC no webhook, JWT do Cognito na api).
resource "aws_lambda_function_url" "public" {
  for_each           = toset(["webhook", "api"])
  function_name      = aws_lambda_function.lambda[each.key].function_name
  authorization_type = "NONE"
}

# Desde out/2025, URL nova exige as duas permissões (BACKEND.md seção 3.2).
resource "aws_lambda_permission" "url_invoke_function_url" {
  for_each               = aws_lambda_function_url.public
  statement_id           = "FunctionURLAllowPublicAccess"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.lambda[each.key].function_name
  principal              = "*"
  function_url_auth_type = "NONE"
}

resource "aws_lambda_permission" "url_invoke_function" {
  for_each                 = aws_lambda_function_url.public
  statement_id             = "FunctionURLAllowInvokeAction"
  action                   = "lambda:InvokeFunction"
  function_name            = aws_lambda_function.lambda[each.key].function_name
  principal                = "*"
  invoked_via_function_url = true
}
