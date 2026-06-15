#!/bin/bash
# Switch between staging and production environment files

ENV=$1

if [ "$ENV" = "staging" ]; then
  if [ ! -f .env.staging ]; then
    echo "Error: .env.staging file not found"
    exit 1
  fi
  cp .env.staging .env
  echo "✅ Switched to staging environment"
elif [ "$ENV" = "production" ]; then
  if [ ! -f .env.production ]; then
    echo "Error: .env.production file not found"
    exit 1
  fi
  cp .env.production .env
  echo "✅ Switched to production environment"
else
  echo "Usage: ./scripts/switch-env.sh [staging|production]"
  echo ""
  echo "This script copies .env.staging or .env.production to .env"
  exit 1
fi
