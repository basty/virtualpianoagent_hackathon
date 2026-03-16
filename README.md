# AI Piano Coach — Gemini Live Hackathon 🎹

> A real-time AR piano learning experience powered by **Gemini 2.0 Flash**, **MediaPipe Hands**, and **Depth Anything V2**. 

This project transforms any flat surface into an interactive virtual piano. It uses advanced hand-tracking and depth-estimation to detect key presses without physical hardware.

---

## 🚀 Quick Links
- **Live Demo**: [https://piano-coach-894751491089.us-central1.run.app](https://piano-coach-894751491089.us-central1.run.app)
- **Architecture Diagram**: [View in artifacts](architecture_diagram.md)

---

## 🛠 Project Structure
```bash
virtualpianoagent/
├── frontend/               # Vanilla JS + CSS PWA
│   ├── src/                
│   │   ├── geminiCoach.js  # Voice Agent Logic
│   │   └── detectionMethod4.js # Differential Z-Depth Logic
│   └── styles/             # Modern Glassmorphism UI
├── backend/                # FastAPI Proxy + ML Engine
│   ├── main.py             # Server endpoints & Static serving
│   └── depth_engine.py     # Depth Anything V2 integration
├── Dockerfile              # Root-level unified container
├── manage.sh               # Local service manager
└── deploy_gcp.sh           # Automated GCP deployment script (Bonus)
```

---

## ⚙️ Configuration

To use the AI Coach, you must provide a **Gemini API Key**. 

### For the Live Demo
If you are testing the **[Live Demo](https://piano-coach-894751491089.us-central1.run.app)**:
1. Open the app.
2. Click the **⚙️ Settings** icon in the top right.
3. Paste your Gemini API Key into the input field and click **Save**. This allows you to test the live version using your own quota.

### For Local/Private Deployment
1. Generate a key at [Google AI Studio](https://aistudio.google.com).
2. Use the provided template to create your environment file:
   ```bash
   cp backend/.env.example backend/.env
   ```
3. Open `backend/.env` and enter your key:
   ```env
   GEMINI_API_KEY=your_actual_key_here
   ```

---

## 💻 Spin-up Instructions (For Judges)

### Option 1: Local Development
Ensure you have Python 3.10+ installed.

1. **Clone & Setup**:
   ```bash
   pip install -r backend/requirements.txt
   ```
2. **Configure API Key**:
   Follow the [Configuration](#️-configuration) steps above.
3. **Launch Services**:
   ```bash
   chmod +x manage.sh
   ./manage.sh start
   ```
4. **Access**:
   - Frontend: `http://localhost:3456`
   - Backend: `http://localhost:8080`

### Option 2: Reproduce GCP Deployment
Uses Google Cloud Build & Cloud Run.

```bash
# 1. Authenticate
gcloud config set project [YOUR_PROJECT_ID]

# 2. Deploy (Automated)
chmod +x deploy_gcp.sh
./deploy_gcp.sh
```

---

## 🧠 Technologies & Learnings

### Core Stack
- **AI Agent**: Gemini 2.0 Flash using the Google GenAI API.
- **Vision**: MediaPipe Hands (Client-side) + Depth Anything V2 (Server-side).
- **Audio**: Tone.js with multi-sample layering.
- **Cloud**: Google Cloud Run, Artifact Registry, Cloud Build.

### Findings & Learnings
1. **Differential Z-Depth**: We found that pure Y-coordinate tracking is unreliable due to camera tilt. By using a "Differential Z-Anchor" (measuring fingertip Z-depth relative to the wrist), we achieved 95%+ accuracy across different lighting conditions.
2. **Hybrid Inference**: Running hand tracking on the client (MediaPipe) and heavy depth-estimation on the server (PyTorch/Cloud Run) provides the best balance of low latency and high accuracy.
3. **Voice-First Pedagogy**: Using Gemini for "just-in-time" coaching significantly lowers the barrier for beginners who struggle to read sheet music and watch their fingers simultaneously.

---

## 🎥 Proof of Google Cloud Deployment
A link to the deployment configuration and core cloud logic can be found in the [Dockerfile](Dockerfile) and [backend/main.py](backend/main.py). These files demonstrate the containerization and integration with Google Cloud services.
The script deploy_gcp.sh shows how to deploy the application to Google Cloud Run.