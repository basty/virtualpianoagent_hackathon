#!/bin/bash

# 🚀 AI Piano Coach — Automated GCP Deployment
# This script automates the build and deployment to Google Cloud Run.

set -e # Exit on error

# 1. Configuration
PROJECT_ID=$(gcloud config get-value project)
SERVICE_NAME="piano-coach"
REGION="us-central1"
MEMORY="2Gi"

echo "---------------------------------------------------"
echo "🎹 Deploying $SERVICE_NAME to GCP Project: $PROJECT_ID"
echo "---------------------------------------------------"

# 2. Deploy to Cloud Run (Source-based build)
# This uses Cloud Build internally to build the Dockerfile at root
gcloud run deploy $SERVICE_NAME \
  --source . \
  --env-vars-file backend/.env \
  --region $REGION \
  --memory $MEMORY \
  --allow-unauthenticated \
  --quiet

echo "---------------------------------------------------"
echo "✅ Deployment Complete!"
echo "🌐 Service URL: $(gcloud run services describe $SERVICE_NAME --platform managed --region $REGION --format 'value(status.url)')"
echo "---------------------------------------------------"
