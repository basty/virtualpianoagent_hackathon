#!/bin/bash

# 🚀 AI Piano Coach — Automated GCP Deployment
# This script automates the build and deployment to Google Cloud Run.

set -e # Exit on error

# 1. Configuration
PROJECT_ID=$(gcloud config get-value project)
SERVICE_NAME="piano-coach"
REGION="us-central1"
MEMORY="2Gi"
CPU="1"

echo "---------------------------------------------------"
echo "🎹 Deploying $SERVICE_NAME to GCP Project: $PROJECT_ID"
echo "---------------------------------------------------"

# 2. Prepare Environment Variables
# gcloud run deploy --env-vars-file expects YAML format
echo "⚙️  Preparing environment variables..."
ENV_YAML="env.yaml"
echo "env_vars:" > $ENV_YAML
grep -v '^#' backend/.env | grep '=' | sed 's/^/  /' >> $ENV_YAML

# 3. Deploy to Cloud Run (Source-based build)
# This uses Cloud Build internally to build the Dockerfile at root
echo "🚀 Building and deploying..."
gcloud run deploy $SERVICE_NAME \
  --source . \
  --env-vars-file $ENV_YAML \
  --region $REGION \
  --memory $MEMORY \
  --cpu $CPU \
  --allow-unauthenticated \
  --quiet

# 4. Cleanup
rm $ENV_YAML

echo "---------------------------------------------------"
echo "✅ Deployment Complete!"
echo "🌐 Service URL: $(gcloud run services describe $SERVICE_NAME --platform managed --region $REGION --format 'value(status.url)')"
echo "---------------------------------------------------"
