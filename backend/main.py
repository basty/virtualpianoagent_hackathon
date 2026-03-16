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
from google import genai
from google.genai import types

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

GEMINI_MODEL    = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")

# ── Prompts ────────────────────────────────────────────────
PROMPTS_DIR = Path(__file__).parent / "prompts"

def load_prompt(name: str, fallback: str = "") -> str:
    path = PROMPTS_DIR / f"{name}.txt"
    try:
        if path.exists():
            return path.read_text(encoding="utf-8").strip()
        return fallback
    except Exception as e:
        print(f"Error loading prompt {name}: {e}")
        return fallback

SYSTEM_INSTRUCTION = load_prompt("system", "You are an AI piano coach.")

def expand_event(text: str) -> str:
    """Detect EVENT: macros and expand them using local templates."""
    # Simple macro expansion. For more complex cases, use regex.
    if text.startswith("EVENT: POSTURE_CHECK"):
        tpl = load_prompt("event_posture")
        return tpl if tpl else text # Fallback to original if template missing
    
    if "USER_PLAYED_CORRECT_NOTES" in text:
        notes = text.split("[")[-1].split("]")[0] if "[" in text else ""
        tpl = load_prompt("event_correct")
        return tpl.replace("{notes}", notes) if tpl else text
        
    if "USER_PLAYED_WRONG_NOTES" in text:
        notes = text.split("[")[-1].split("]")[0] if "[" in text else ""
        tpl = load_prompt("event_wrong")
        return tpl.replace("{notes}", notes) if tpl else text

    if "USER_PLAYED_NOTES" in text:
        notes = text.split("[")[-1].split("]")[0] if "[" in text else ""
        tpl = load_prompt("event_notes")
        return tpl.replace("{notes}", notes) if tpl else f"I just played these notes: {notes}. Any comments?"

    if "USER_JUST_ENABLED_CONVERSATIONAL_MODE" in text:
        tpl = load_prompt("event_intro")
        return tpl if tpl else text

    if text.startswith("FEEDBACK_REQUEST:"):
        tpl = load_prompt("feedback_request")
        if not tpl: return text
        # Mock parsing of the string produced by frontend legacy mode
        # "Exercise: {ex} Expected: {exp} Student played: {p} {tempo}"
        return tpl # The frontend usually sends a well-formatted string already, but we can wrap it

    return text

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
    image: Optional[str] = None  # Base64 string
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

        # Add user message with event expansion
        expanded_msg = expand_event(req.user_message)
        print(f"[Chat] User msg: {expanded_msg[:100]}...") # Log first 100 chars
        parts = [{"text": expanded_msg}]
        if req.image:
            parts.append({
                "inline_data": {
                    "mime_type": "image/jpeg",
                    "data": req.image
                }
            })

        # Add user message
        history.append({"role": "user", "parts": parts})

        # 2. Maintenance: Aggressively strip images from history
        # We only want Gemini to see the image in the turn it was sent.
        # This prevents the AI from "remembering" a flat hand for 5 turns and looping feedback.
        for msg in history[:-1]: # Strip from everything EXCEPT the message we just added
            new_parts = []
            for p in msg.get("parts", []):
                if "inline_data" not in p:
                    new_parts.append(p)
            msg["parts"] = new_parts

        # 3. Limit message count to keep latency low
        if len(history) > 40:
            prefix = history[:-20]
            suffix = history[-20:]
            clean_prefix = [m for m in prefix if "EVENT:" not in m["parts"][0].get("text", "")]
            sessions[req.session_id]["history"] = clean_prefix + suffix
            history = sessions[req.session_id]["history"]

        print(f"[Chat] Session {req.session_id} history size: {len(history)} messages. Image included: {bool(req.image)}")

        reply = await _call_gemini_sdk(history, req.api_key)
        
        # If the AI says SILENT, we don't return anything to the user
        if reply.strip().upper() == "SILENT":
            return {"reply": ""}

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
        
        feedback_text = await _call_gemini_sdk(history, req.api_key)
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


async def _call_gemini_sdk(history: list[dict], api_key: Optional[str] = None) -> str:
    # Clean the provided key if any
    clean_request_key = api_key.strip(' "').strip() if api_key else None
    
    # Use provided key or fall back to server env
    key = clean_request_key or GEMINI_API_KEY
    if not key:
        raise HTTPException(status_code=400, detail="Gemini API Key missing. Please provide one in settings or server environment.")

    client = genai.Client(api_key=key, http_options={'api_version': 'v1beta'})
    
    # Map raw history to SDK Content objects
    contents = []
    for turn in history:
        turn_parts = []
        for p in turn["parts"]:
            if "text" in p:
                turn_parts.append(types.Part(text=p["text"]))
            elif "inline_data" in p:
                turn_parts.append(types.Part(
                    inline_data=types.Blob(
                        data=p["inline_data"]["data"],
                        mime_type=p["inline_data"]["mime_type"]
                    )
                ))
        contents.append(types.Content(role=turn["role"], parts=turn_parts))

    try:
        response = await client.aio.models.generate_content(
            model=GEMINI_MODEL,
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_INSTRUCTION,
                temperature=0.4,
                max_output_tokens=300,
            )
        )
        return response.text
    except Exception as e:
        print(f"Gemini SDK Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Static Files ──────────────────────────────────────────
# Mount the frontend directory. This MUST be the last route.
frontend_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend")
if os.path.exists(frontend_path):
    app.mount("/", StaticFiles(directory=frontend_path, html=True), name="frontend")
else:
    print(f"Warning: Frontend path not found at {frontend_path}")
