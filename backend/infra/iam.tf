# Uma role por Lambda, com o mínimo (BACKEND.md seção 10): nada de `dynamodb:*` nem `Resource: "*"`.

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

locals {
  table_resources = [aws_dynamodb_table.main.arn, "${aws_dynamodb_table.main.arn}/index/GSI1"]
  table_actions = [
    "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query",
    "dynamodb:BatchGetItem", "dynamodb:ConditionCheckItem",
  ]
}

resource "aws_iam_role" "lambda" {
  for_each           = local.lambdas
  name               = "${local.name}-${each.key}"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "logs" {
  for_each = local.lambdas
  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.lambda[each.key].arn}:*"]
  }
}

resource "aws_iam_role_policy" "logs" {
  for_each = local.lambdas
  name     = "logs"
  role     = aws_iam_role.lambda[each.key].id
  policy   = data.aws_iam_policy_document.logs[each.key].json
}

data "aws_iam_policy_document" "webhook" {
  statement {
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.whatsapp.arn]
  }
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.whatsapp.arn]
  }
}

data "aws_iam_policy_document" "worker" {
  statement {
    actions   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes", "sqs:ChangeMessageVisibility"]
    resources = [aws_sqs_queue.whatsapp.arn]
  }
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.whatsapp.arn]
  }
  statement {
    actions   = local.table_actions
    resources = local.table_resources
  }
}

data "aws_iam_policy_document" "api" {
  statement {
    actions   = local.table_actions
    resources = local.table_resources
  }
  # Excluir a conta: o servidor apaga o usuário do Cognito (o `DeleteUser` do app exige um escopo que o login com a
  # Apple não traz). Só esta ação, só neste user pool; o usuário a apagar vem do access token de quem chama.
  statement {
    actions   = ["cognito-idp:AdminDeleteUser"]
    resources = ["arn:aws:cognito-idp:${var.region}:${var.account_id}:userpool/${var.cognito_user_pool_id}"]
  }
  # Fotos de perfil: as URLs pré-assinadas herdam estas permissões; só o prefixo `photos/` do bucket de fotos.
  statement {
    actions   = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.photos.arn}/photos/*"]
  }
}

data "aws_iam_policy_document" "scheduled" {
  statement {
    actions   = local.table_actions
    resources = local.table_resources
  }
  # Enumerar as casas (itens META) por varredura filtrada; só esta Lambda faz isso.
  statement {
    actions   = ["dynamodb:Scan"]
    resources = [aws_dynamodb_table.main.arn]
  }
}

data "aws_iam_policy_document" "push" {
  statement {
    actions   = ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:DeleteItem"]
    resources = [aws_dynamodb_table.main.arn]
  }
  statement {
    actions   = ["dynamodb:DescribeStream", "dynamodb:GetRecords", "dynamodb:GetShardIterator", "dynamodb:ListStreams"]
    resources = ["${aws_dynamodb_table.main.arn}/stream/*"]
  }
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.apns.arn]
  }
}

resource "aws_iam_role_policy" "app" {
  for_each = {
    push      = data.aws_iam_policy_document.push.json
    scheduled = data.aws_iam_policy_document.scheduled.json
    webhook   = data.aws_iam_policy_document.webhook.json
    worker    = data.aws_iam_policy_document.worker.json
    api       = data.aws_iam_policy_document.api.json
  }
  name   = "app"
  role   = aws_iam_role.lambda[each.key].id
  policy = each.value
}
