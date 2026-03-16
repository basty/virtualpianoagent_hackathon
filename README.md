# 🎹 AI Piano Coach — Gemini Live Hackathon

> **Real-time AR Piano Learning** powered by Gemini 2.0 Flash, MediaPipe Hands, and Depth Anything V2.

[![Live Demo](https://img.shields.io/badge/Demo-Live-brightgreen)](https://piano-coach-894751491089.us-central1.run.app)
[![Architecture Diagram](https://img.shields.io/badge/Architecture-Diagram-blue)](./architecture_diagram.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## 📺 Demonstration
**Watch the 4-minute demo here:**
> [!IMPORTANT]
> [[Link to Demonstration Video (YouTube/Devpost)](https://www.youtube.com/watch?v=j1fTLGUxA38)]

**Watch proof of GCP Deployment (behind-the-scenes):**
> [!IMPORTANT]
> [![Link to GCP Proof Video (YouTube/Devpost)](https://github.com/basty/virtualpianoagent_hackathon/blob/main/ag.png)]

---

## 🚀 Hackathon Compliance Checklist

| Criterion | Implementation Status |
|-----------|-----------------------|
| **Leverage Gemini Model** | Used **Gemini 2.0 Flash** for real-time music coaching. |
| **Google GenAI SDK/ADK** | Built using the official **Google GenAI SDK** (Python). |
| **At least one GCP service** | Deployed on **Google Cloud Run** with **Artifact Registry** & **Cloud Build**. |
| **Reproducible Code** | Full spin-up instructions included below. |
| **GCP Proof** | Proof video linked and code verifiable in `Dockerfile` & `deploy_gcp.sh`. |
| **Architecture Diagram** | Clear visual representation provided below. |
| **Bonus: Automated Deployment** | **Proof of automation** included via `deploy_gcp.sh`. |

---

## 🧠 System Architecture

```mermaid
graph TD
    subgraph Client ["Client Browser (PWA)"]
        UI["Modern UI (Vanilla JS/CSS)"]
        MP["MediaPipe (Hand Tracking)"]
        Tone["Tone.js (Spatial Audio)"]
        WS["Web Speech API (STT/TTS)"]
        State["Reactive State Logic"]
    end

    subgraph GCP ["Google Cloud Platform"]
        subgraph CloudRun ["Google Cloud Run"]
            FastAPI["FastAPI App"]
            Depth["Depth Anything V2 (ML Engine)"]
        end
        AR["Artifact Registry"]
        CB["Cloud Build"]
    end

    subgraph AI ["Intelligence Layer"]
        Gemini["Gemini 2.0 Flash API"]
    end

    %% Interactions
    UI --> MP
    MP --> State
    State --> UI
    UI --> Tone
    UI --> WS

    %% Backend Communication
    UI -- "WebSocket / REST" <--> FastAPI
    FastAPI -- "GenAI SDK" <--> Gemini
    FastAPI -- "PyTorch" --> Depth
    
    %% Deployment flow
    CB -- "Build & Push" --> AR
    AR -- "Deploy" --> CloudRun
    
    %% Formatting
    style Client fill:#f9f,stroke:#333,stroke-width:2px
    style GCP fill:#4285F4,stroke:#fff,stroke-width:2px,color:#fff
    style AI fill:#ecc,stroke:#333,stroke-width:2px
```

---

## 🛠 Features & Functionality

1.  **AI Music Teacher**: Gemini identifies when you make a mistake (e.g., "You played D# instead of E") and provides verbal, encouraging feedback.
2.  **Differential Z-Depth Perception**: We solved the "flat-table AR" problem. By measuring fingertip Z-depth relative to the wrist (Spatial Anchor), the app detects key presses with high accuracy regardless of camera tilt.
3.  **Hybrid AI Inference**: Runs lightweight hand-tracking on the client (MediaPipe) and heavy depth-estimation on the server (Depth Anything V2 / Cloud Run) for peak performance.
4.  **Voice-First Interface**: Use conversational commands like *"Teach me the C Major scale"* or *"Give me a jazz warmup"*.

---

## ⚙️ Spin-up Instructions

### Option 1: Local Development (Quick Start)
1. **Clone & Setup**:
   ```bash
   pip install -r backend/requirements.txt
   ```
2. **Configure API Key**:
   Create a `backend/.env` file:
   ```env
   GEMINI_API_KEY=your_key_here
   ```
3. **Launch**:
   ```bash
   ./manage.sh start
   ```
4. **Access**: `http://localhost:3456`

### Option 2: Automated GCP Deployment
Ensure you have the `gcloud` CLI installed and authenticated.
```bash
# Set your project
gcloud config set project [YOUR_PROJECT_ID]

# Run the automated deployment script
chmod +x deploy_gcp.sh
./deploy_gcp.sh
```

---

## 📝 Findings & Learnings: The Path to Detection

Detecting a "piano press" on a flat table with a standard 2D webcam is a profound spatial challenge. We implemented and benchmarked **12 distinct algorithms** before identifying our proprietary "Differential Z-Anchor" as the winner.

### Technical Exploration History

| Method | Description | Outcome |
| :--- | :--- | :--- |
| **Differential Z-Anchor (Winner)** | **Z-depth relative to wrist + extension posture (>155°).** | **95%+ Accuracy; stable across different camera angles.** |
| **Hybrid Kinetic** | Y-velocity + Z-spike + Finger curl angle fusion. | Good for hovers, but prone to false triggers during surface contact. |
| **Dynamic Floor** | Local minima tracking (Lowest recorded Y-point). | Failed to distinguish between white and black key heights. |
| **Motion Stop** | Halt detection (dy dropping to zero inside a key). | Prone to noise from sympathetic finger movements. |
| **Calibrated Y** | Velocity reversal after crossing a fixed Y-threshold. | Highly sensitive to lighting and table surface reflections. |
| **AI v1 (3D Plane)** | Least-squares fitting of a 3D plane to 7 landmarks. | Very light-dependent and lacked the required precision. |
| **AI v2 (Smoothed)** | Exponential smoothing (α=0.3) on Y-coordinates. | Reduced "vibration" but introduced unacceptable latency. |
| **PressureVision** | Hysteresis score based on Z-compression. | Required specific sensor hardware not available to consumers. |
| **MLP Classifier** | TensorFlow.js MLP trained on-device. | High divergence; struggled with different hand sizes. |
| **TypeNet LSTM** | Sequence analysis of fingertip movement patterns. | Requires massive datasets of diverse players to generalize. |
| **3D SVD Plane** | Robust surface fitting via SVD decomposition. | Mathematically sound but computationally expensive for 60FPS. |
| **Depth Anything** | Backend GPU Proxy for high-fidelity depth maps. | High fidelity but introduced lag that broke the musical rhythm. |

### Key Learnings
- **The Latency Trap**: Real-time music requires <100ms response times. Moving hand tracking to the client and using sparse server-side depth queries was the only way to achieve "musical" performance.
- **Contextual Vision**: Feeding Gemini raw logs of "played vs expected" notes combined with voice intent allows it to act as a truly personal tutor, unlike static piano apps.
- **Billing Protection**: Implemented `REQUIRE_CLIENT_KEY` mode, allowing public demos while strictly protecting server-side API quotas.

---

## 🎥 Proof of Google Cloud services
Verification of GCP usage can be found in:
- [Dockerfile](Dockerfile): Optimized for Cloud Run containerization.
- [backend/main.py](backend/main.py): Integrated with Gemini via the Google GenAI SDK.
- [deploy_gcp.sh](deploy_gcp.sh): Automated infrastructure-as-code script.
