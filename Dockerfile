FROM python:3.12-slim

# Install system dependencies for OpenCV and other libs
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy and install Python dependencies
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Create checkpoints directory and download model
RUN mkdir -p backend/checkpoints && \
    wget -O backend/checkpoints/depth_anything_v2_vits.pth https://huggingface.co/depth-anything/Depth-Anything-V2-Small/resolve/main/depth_anything_v2_vits.pth

# Copy frontend static files
COPY frontend /app/frontend

# Copy backend source
COPY backend /app/backend

# Set working directory to backend for uvicorn to find main:app correctly
WORKDIR /app/backend

# Cloud Run uses the PORT environment variable
EXPOSE 8080

# Run uvicorn. Note: we use --proxy-headers for Cloud Run
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080} --proxy-headers"]
