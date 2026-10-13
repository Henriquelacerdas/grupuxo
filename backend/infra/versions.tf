terraform {
  required_version = ">= 1.9"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.40"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
    }
  }

  # Estado local (atalho da trilha, PLANO.md seção 2): um ambiente só, sem CI de deploy.
}

provider "aws" {
  region  = var.region
  profile = var.aws_profile

  # Trava contra aplicar na conta errada.
  allowed_account_ids = [var.account_id]

  default_tags {
    tags = {
      Project     = "grupuxo"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
