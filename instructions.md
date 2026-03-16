# 🎹 AI Piano Coach — Gemini Live Hackathon

## Goal

Build a **real-time AR piano learning app** that:

- Uses the **device camera**
- Detects the user's **desk flat space, hands, and fingertips**
- Overlays a **virtual piano keyboard** on the desk surface (facing user — 1 octave with all white and black keys)
- Detects **finger presses** on virtual keys
- **Plays piano sounds** when keys are touched
- Uses **Gemini** as a real-time AI music coach that:
  - Responds to voice commands
  - Explains exercises
  - Guides the user while playing
  - **Focuses on teaching the C Major scale and its relative A Minor.**

---

## Core Features

### 1. Camera Feed

Capture real-time camera video.

**Requirements:**
- 30–60 FPS
- Access to raw frames for vision processing

**Libraries:**
- WebRTC / `getUserMedia`

---

### 2. Hand Tracking

Detect hands and fingertip positions using **MediaPipe Hands**.

**Capabilities:**
- Detect 21 hand landmarks
- Track multiple fingers
- Run at ~30–60 FPS

**Important landmarks:**

| Finger     | Landmark ID |
|------------|-------------|
| Thumb tip  | 4           |
| Index tip  | 8           |
| Middle tip | 12          |
| Ring tip   | 16          |
| Pinky tip  | 20          |

**Output required:**
```json
{
  "hand_landmarks": [
    { "x": 0.0, "y": 0.0, "z": 0.0 }
  ]
}
```

---

### 3. Virtual Piano Overlay

Render a keyboard over the camera feed.

**Suggested stack:** Three.js / WebGL

**Responsibilities:**
- Draw piano keys
- Map screen coordinates
- Highlight pressed keys

**Keyboard layout:**
```
C  D  E  F  G  A  B
```

**Minimum version:** 12 keys (1 octave, including black keys)

Each key defined by:
```json
{
  "note": "C4",
  "x_min": 0,
  "x_max": 0,
  "y_min": 0,
  "y_max": 0
}
```

---

### 4. Finger → Key Detection (Spatial Logic Engine V3)

Detect when a finger touches a key using an advanced **8-point press detector**:

1.  **State Machine**: Each key tracks states: `IDLE` → `HOVER` → `PRESSED` → `COOLDOWN`. This prevents sliding re-triggers.
2.  **Palm Normalization**: Fingertip depth (Z) is calculated relative to the palm landmark (0), stabilizing detection during camera movement.
3.  **Kinetic Signature (Strict AND)**: Trigger requires a simultaneous downward Y spike AND a palm-relative Z spike.
4.  **Posture Analysis (Bend)**: Finger angle must be `< 160°` (curled) to distinguish a strike from a flat-finger hover.
5.  **Spatial Filter**: Fingertip must be within the key's 2D bounding box and cross the calibrated surface threshold.
6.  **Debounce**: Stricty `120ms` re-trigger lockout.
7.  **Visual Key Travel**: Pressed keys shift visually downward by 4px for tactile-less feedback.
8.  **Tap Velocity**: Map strike speed (Z-velocity) to volume (40–127) for expressive playback.

**Pseudo-logic:**
```js
if (insideKey && storableState == HOVER && downwardMotion && inwardZMotion && isCurled && debounced) {
  triggerNote(velocity);
  state = PRESSED;
}
```

> This state-driven, multi-factor approach provides a professional "mechanical" feel that distinguishes deliberate play from accidental movement.

---

### 5. Piano Sound Engine

Play piano sounds when keys are pressed using the **Web Audio API**.

**Options:**

| Option | Description |
|--------|-------------|
| A (simple) | Pre-recorded piano samples |
| B (better) | MIDI playback |

**Recommended library:** [Tone.js](https://tonejs.github.io/)

**Example:**
```js
playNote("C4");
```

---

### 6. Gemini AI Music Coach

Use Gemini for:
- Voice interaction
- Teaching piano exercises
- Responding to user commands

**Example:**
> User: *"Teach me a C major scale"*
> AI: *"Place your fingers on C, D, E..."*

**API:** Gemini Live API

**Capabilities:**
- Real-time voice input
- Text responses
- Streaming interaction

---

### 7. Voice Interaction

**Speech input pipeline:**
```
Microphone
    ↓
Speech-to-Text (Web Speech API)
    ↓
Gemini
    ↓
AI Response
    ↓
Text-to-Speech (SpeechSynthesis API)
```

---

### 8. Google Cloud Requirement

> The hackathon requires using **Google Cloud**.

**Suggested backend:** Google Cloud Run

**Purpose:**
- Host API server
- Manage Gemini API calls
- Store session state
- No authentication (for now)

---

## Architecture Overview

```
Browser App
│
├── Camera Feed (WebRTC)
│
├── Hand Tracking (MediaPipe)
│
├── Piano Overlay (Three.js)
│
├── Sound Engine (Tone.js)
│
└── Voice Interaction
       │
       └── Gemini Live API

Backend (Cloud Run)
       │
       └── Gemini Live Agent
```

---

## Minimum Viable Prototype

Features required for hackathon demo:

- [x] Camera feed
- [x] Hand tracking
- [x] 1 octave piano
- [x] Finger → key detection
- [x] Sound playback
- [x] Voice command
- [x] Gemini giving instructions

### Demo Scenario

1. User opens camera
2. Virtual piano appears on desk
3. User says: *"Teach me a scale."*
4. AI highlights keys
5. User plays notes
6. AI gives feedback

---

## Performance Requirements

| Metric | Target |
|--------|--------|
| Tracking frame rate | 30 FPS |
| Key press latency | < 100ms |
| AI response latency | < 500ms |

---

## Gemini AI Features (Detailed)

### 1. AI Music Teacher

The user speaks to the app and Gemini responds.

**Example:**
> User: *"Teach me a blues scale."*
> Gemini generates the lesson, tells the user which keys to press, and explains fingering.

**Example API call:**
```js
const response = await gemini.generateContent({
  model: "gemini-2.0-flash",
  contents: "Explain how to play a C major scale for beginners."
});
```

---

### 2. Real-Time Playing Feedback ⭐

When the user plays notes, the sequence is sent to Gemini for analysis.

**Example input:**
```json
{
  "exercise": "C major scale",
  "notes_played": ["C4", "D4", "E4", "E4", "G4"],
  "tempo": 82
}
```

**Example response:**
> *"You repeated E instead of playing F. Try again and keep a steady tempo."*

---

### 3. Dynamic Exercise Generation ⭐

User says: *"Give me a beginner jazz exercise."*

**Gemini returns:**
```json
{
  "exercise": "Jazz warmup",
  "notes": ["C4", "E4", "G4", "Bb4"]
}
```

The UI **lights up those keys** automatically.

---

### 4. Structured Feedback Output

Prompt Gemini to return structured JSON:

**Prompt:**
```
You are a piano teacher.

Exercise: C major scale
Expected notes: C4 D4 E4 F4 G4

Student played:
C4 D4 E4 E4 G4

Give short feedback and advice.
Return JSON:
{
  "mistakes": [],
  "feedback": "",
  "next_exercise": ""
}
```

**Example response:**
```json
{
  "mistakes": ["Missing F4"],
  "feedback": "You repeated E instead of F.",
  "next_exercise": "Play C D E F slowly."
}
```

---

## Final System Architecture

```
Frontend
├── MediaPipe     → hand tracking
├── Three.js      → piano overlay
└── Tone.js       → piano sounds

AI Layer
└── Gemini 2.5    → music intelligence + coaching

Backend
└── Google Cloud Run → API proxy + session state
```

---

## The Demo That Could Win 🏆

```
1. Camera sees desk
2. Piano appears on surface
3. User says "Teach me a scale."
4. AI explains the exercise
5. User plays the notes
6. Gemini says "Great! Try again faster."
```

> Judges instantly understand the product.

---

## Possible Future Features

- Chord recognition
- Sheet music generation
- Finger posture analysis
- Multiplayer piano lessons