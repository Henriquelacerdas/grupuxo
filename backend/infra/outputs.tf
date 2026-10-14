output "webhook_url" {
  description = "Callback URL a cadastrar na Meta (WhatsApp → Configuration → Webhook)."
  value       = aws_lambda_function_url.public["webhook"].function_url
}

output "api_url" {
  description = "URL base da api (vai em grupuxo/Config/Local.xcconfig, ver README §6)."
  value       = aws_lambda_function_url.public["api"].function_url
}

output "table_name" {
  value = aws_dynamodb_table.main.name
}

output "secret_name" {
  description = "Segredo a preencher no console do Secrets Manager."
  value       = aws_secretsmanager_secret.whatsapp.name
}

output "dlq_url" {
  value = aws_sqs_queue.whatsapp_dlq.url
}
