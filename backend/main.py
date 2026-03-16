"""
main.py — FastAPI backend for AI Piano Coach

Responsibilities:
  • Proxy Gemini API calls (keeps API key server-side)
  • Store session state
  • Serve as Google Cloud Run target

Run locally:
  uvicorn backend.main:app --reload --port 8000
"""

import os
import json
import time
import asyncio
from pathlib import Path
from typing import Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import httpx

import depth_engine

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize the small Depth Anything model to keep VRAM usage low and inference fast
    try:
        depth_engine.init_model("vits")
    except Exception as e:
        print(f"Failed to initialize depth engine: {e}")
    yield
    # Cleanup if needed


# ── Config ────────────────────────────────────────────────
_RAW_KEY = os.getenv("GEMINI_API_KEY", "")
# Strip quotes (common in .env files handled by some shells) and whitespace
GEMINI_API_KEY = _RAW_KEY.strip(' "').strip()

# When true, the backend will NOT use the server-side GEMINI_API_KEY
# and will instead strictly require an api_key in the request.
REQUIRE_CLIENT_KEY = os.getenv("REQUIRE_CLIENT_KEY", "false").lower() == "true"

GEMINI_MODEL    = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
GEMINI_ENDPOINT = (
    f"https://generativelanguage.googleapis.com/v1beta/models/"
    f"{GEMINI_MODEL}:generateContent"
)

PROMPT_FILE = Path(__file__).parent / "prompts.txt"

def load_system_instruction() -> str:
    """Load the system instruction from prompts.txt."""
    try:
        if PROMPT_FILE.exists():
            return PROMPT_FILE.read_text(encoding="utf-8")
        else:
            print(f"Warning: {PROMPT_FILE} not found. Using minimal fallback.")
            return "You are an AI piano coach."
    except Exception as e:
        print(f"Error loading prompt file: {e}")
        return "You are an AI piano coach."

SYSTEM_INSTRUCTION = load_system_instruction()

# ── In-memory session store ──
sessions: dict[str, dict] = {}
session_locks: dict[str, asyncio.Lock] = {}

def get_session_lock(sid: str) -> asyncio.Lock:
    if sid not in session_locks:
        session_locks[sid] = asyncio.Lock()
    return session_locks[sid]

# ── App ──────────────────────────────────────────────────
app = FastAPI(
    title="AI Piano Coach API",
    description="Backend proxy for Gemini AI coaching",
    version="0.1.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # Tighten for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Schemas ───────────────────────────────────────────────
class ChatRequest(BaseModel):
    session_id: str
    user_message: str
    api_key: Optional[str] = None

class FeedbackRequest(BaseModel):
    session_id: str
    exercise: str
    expected_notes: list[str]
    played_notes:   list[str]
    tempo: Optional[int] = None
    api_key: Optional[str] = None

class SessionState(BaseModel):
    session_id: str
    notes_played: list[str] = []
    exercises_done: int = 0

# ── Routes ────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok", "ts": int(time.time())}


@app.post("/chat")
async def chat(req: ChatRequest):
    """Send a user message and get an AI coaching response."""
    async with get_session_lock(req.session_id):
        _ensure_session(req.session_id)
        history = sessions[req.session_id]["history"]

        # Add user message
        history.append({"role": "user", "parts": [{"text": req.user_message}]})

        # Maintenance: Keep history clean by removing very old EVENT messages
        # but keep actual user dialog.
        if len(history) > 30:
            # Keep the last 20 messages, but filter out events from the older portion
            prefix = history[:-20]
            suffix = history[-20:]
            # Only keep non-EVENT messages in the prefix
            clean_prefix = [m for m in prefix if "EVENT:" not in m["parts"][0]["text"]]
            sessions[req.session_id]["history"] = clean_prefix + suffix
            history = sessions[req.session_id]["history"]

        print(f"[Chat] Session {req.session_id} history size: {len(history)}")

        reply = await _call_gemini(history, req.api_key)
        history.append({"role": "model", "parts": [{"text": reply}]})

        return {"reply": reply}


@app.post("/feedback")
async def feedback(req: FeedbackRequest):
    """Analyse a completed exercise attempt and return AI feedback."""
    async with get_session_lock(req.session_id):
        _ensure_session(req.session_id)

        prompt = (
            f"Exercise: {req.exercise}\n"
            f"Expected: {' '.join(req.expected_notes)}\n"
            f"Student played: {' '.join(req.played_notes)}\n"
            + (f"Tempo: {req.tempo} BPM\n" if req.tempo else "")
            + "Give 1-2 sentences of specific, encouraging feedback."
        )

        history = sessions[req.session_id]["history"]
        history.append({"role": "user", "parts": [{"text": f"FEEDBACK_REQUEST: {prompt}"}]})
        
        feedback_text = await _call_gemini(history, req.api_key)
        history.append({"role": "model", "parts": [{"text": feedback_text}]})

        return {"feedback": feedback_text}


@app.post("/session")
def create_session(state: SessionState):
    """Upsert a session."""
    if state.session_id not in sessions:
        sessions[state.session_id] = {
            "history": [],
            "stats":   {},
        }
    sessions[state.session_id]["stats"] = state.model_dump()
    return {"ok": True}


@app.get("/session/{session_id}")
def get_session(session_id: str):
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    return sessions[session_id]["stats"]


@app.websocket("/depth_stream")
async def depth_stream(websocket: WebSocket):
    """
    WebSocket endpoint for real-time depth map generation.
    Receives an image as raw bytes, runs it through Depth Anything V2,
    and returns a base64 encoded JPEG of the depth map.
    """
    await websocket.accept()
    try:
        while True:
            try:
                # Receive image bytes from the client
                image_bytes = await websocket.receive_bytes()
                
                # Run inference
                depth_b64 = depth_engine.predict_depth_base64(image_bytes)
                # Send back the base64 string
                await websocket.send_text(depth_b64)
            except Exception as eval_err:
                print(f"Depth inference error: {eval_err}")
                await websocket.send_text("ERROR")
                
    except WebSocketDisconnect:
        print("Client disconnected from depth stream.")
    except Exception as e:
        print(f"WebSocket error: {e}")


# ── Helpers ───────────────────────────────────────────────
def _ensure_session(sid: str):
    if sid not in sessions:
        sessions[sid] = {"history": [], "stats": {}}


async def _call_gemini(history: list[dict], api_key: Optional[str] = None) -> str:
    # Clean the provided key if any
    clean_request_key = api_key.strip(' "').strip() if api_key else None
    
    # Selection logic:
    # 1. Use key from request if provided
    # 2. If REQUIRE_CLIENT_KEY is False, use GEMINI_API_KEY from server env
    # 3. Otherwise, key is missing
    key = clean_request_key
    if not key and not REQUIRE_CLIENT_KEY:
        key = GEMINI_API_KEY

    if not key:
        msg = (
            "Gemini API Key missing. "
            "Please open Settings (⚙️) and enter your Gemini API Key to continue."
            if REQUIRE_CLIENT_KEY else
            "Gemini API Key missing. Please provide one in settings or server environment."
        )
        raise HTTPException(status_code=400, detail=msg)

    body = {
        "system_instruction": {"parts": [{"text": SYSTEM_INSTRUCTION}]},
        "contents": history,
        "generationConfig": {
            "temperature":     0.4,
            "maxOutputTokens": 300,
        },
    }

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            f"{GEMINI_ENDPOINT}?key={key}",
            json=body,
        )

    if resp.status_code != 200:
        detail = resp.json().get("error", {}).get("message", resp.text)
        raise HTTPException(status_code=resp.status_code, detail=detail)

    data = resp.json()
    return data["candidates"][0]["content"]["parts"][0]["text"]


# ── Static Files ──────────────────────────────────────────
# Mount the frontend directory. This MUST be the last route.
frontend_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend")
if os.path.exists(frontend_path):
    app.mount("/", StaticFiles(directory=frontend_path, html=True), name="frontend")
else:
    print(f"Warning: Frontend path not found at {frontend_path}")
