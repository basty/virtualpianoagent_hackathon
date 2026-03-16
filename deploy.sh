#!/bin/bash

# 1. Configuration
PROJECT_ID=$(gcloud config get-value project)
SERVICE_NAME="virtual-piano-agent"
REGION="us-central1"

echo "Deploying $SERVICE_NAME to GCP Project: $PROJECT_ID in Region: $REGION..."

# 1. Build the image using Cloud Build
gcloud builds submit --tag gcr.io/$PROJECT_ID/$SERVICE_NAME

# 2. Deploy to Cloud Run
# Note: We give it more memory because of the ML model
gcloud run deploy $SERVICE_NAME \
  --image gcr.io/$PROJECT_ID/$SERVICE_NAME \
  --platform managed \
  --region $REGION \
  --allow-unauthenticated \
  --memory 2Gi \
  --cpu 1 \
  --port 8080 \
  --set-env-vars GEMINI_API_KEY=""

# 3. Get the URL
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --platform managed --region $REGION --format='value(status.url)')

echo "------------------------------------------------"
echo "Deployment Complete!"
echo "Service URL: $SERVICE_URL"
echo ""
echo "IMPORTANT: Don't forget to set your GEMINI_API_KEY in the GCP Console"
echo "or via gcloud if you haven't already!"
echo "------------------------------------------------"
