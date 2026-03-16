const fs = require('fs');

const files = [
  'src/detectionMethod1.js',
  'src/detectionMethod2.js',
  'src/detectionMethod3.js',
  'src/detectionMethod4.js',
  'src/detectionMethod5.js',
];

files.forEach(file => {
  try {
    let t = fs.readFileSync(file, 'utf8');

    // ── 1. Upgrade keyStates to store pressedBy and releaseFrames ──
    // Replace any existing keyState initialisation that doesn't have pressedBy
    t = t.replace(
      /if \(!this\._keyStates\[note\]\) \{[\s\S]*?this\._keyStates\[note\] = \{[^}]*\};\s*\}/g,
      m => {
        // Only inject if pressedBy is not already there
        if (m.includes('pressedBy')) return m;
        return m
          .replace(/\};(\s*\})/, `, pressedBy: null, releaseFrames: 0 };$1`);
      }
    );

    // ── 2. Skip the key for other fingers when already pressed by a different finger ──
    // Add a guard right after the note is resolved (before keyStates init)
    t = t.replace(
      /(if \(!this\._keyStates\[note\]\))/g,
      `// If key is owned by a different finger, skip it
          if (this._keyStates[note] && this._keyStates[note].pressedBy && this._keyStates[note].pressedBy !== tipKey) {
            // Still count as framePressing so it doesn't get released globally
            if (this._keyStates[note].state === STATE.PRESSED) framePressing.add(note);
            break;
          }
          $1`
    );

    // ── 3. Track ownership on press ──
    t = t.replace(/hits\.push\(\{ note, velocity[^}]+\}\);/g, m => `${m}\n              ks.pressedBy = tipKey;`);

    // ── 4. Release hysteresis: don't release on first frame outside, wait 3 frames ──
    // Method 1 style: !inside || !curled
    t = t.replace(
      /if \(!inside \|\| !curled\) \{\s*ks\.state = STATE\.IDLE;\s*releases\.push\(note\);\s*\}/,
      `if (!inside || !curled) {
              ks.releaseFrames = (ks.releaseFrames || 0) + 1;
              if (ks.releaseFrames >= 3) {
                ks.state = STATE.IDLE;
                ks.pressedBy = null;
                ks.releaseFrames = 0;
                releases.push(note);
              }
            } else {
              ks.releaseFrames = 0;
            }`
    );

    // Method 2,3,4 style: !inKeyZone || !isAtFloor || isUnderDesk
    t = t.replace(
      /if \(!inKeyZone \|\| !isAtFloor \|\| isUnderDesk\) \{\s*ks\.state = STATE\.IDLE;\s*releases\.push\(note\);\s*\}/,
      `if (!inKeyZone || !isAtFloor || isUnderDesk) {
              ks.releaseFrames = (ks.releaseFrames || 0) + 1;
              if (ks.releaseFrames >= 3) {
                ks.state = STATE.IDLE;
                ks.pressedBy = null;
                ks.releaseFrames = 0;
                releases.push(note);
              }
            } else {
              ks.releaseFrames = 0;
            }`
    );

    // Method 3 style: !inKeyZone || isMovingUpwards || isUnderDesk || !isIntentionallyExtended
    t = t.replace(
      /if \(!inKeyZone \|\| isMovingUpwards \|\| isUnderDesk \|\| !isIntentionallyExtended\) \{\s*ks\.state = STATE\.IDLE;\s*releases\.push\(note\);\s*\}/,
      `if (!inKeyZone || isMovingUpwards || isUnderDesk || !isIntentionallyExtended) {
              ks.releaseFrames = (ks.releaseFrames || 0) + 1;
              if (ks.releaseFrames >= 3) {
                ks.state = STATE.IDLE;
                ks.pressedBy = null;
                ks.releaseFrames = 0;
                releases.push(note);
              }
            } else {
              ks.releaseFrames = 0;
            }`
    );

    // Method 4 style: !inKeyZone || relZ >= -0.02 || isUnderDesk || !isIntentionallyExtended
    t = t.replace(
      /if \(!inKeyZone \|\| relZ >= -0\.02 \|\| isUnderDesk \|\| !isIntentionallyExtended\) \{\s*ks\.state = STATE\.IDLE;\s*releases\.push\(note\);\s*\}/,
      `if (!inKeyZone || relZ >= -0.02 || isUnderDesk || !isIntentionallyExtended) {
              ks.releaseFrames = (ks.releaseFrames || 0) + 1;
              if (ks.releaseFrames >= 3) {
                ks.state = STATE.IDLE;
                ks.pressedBy = null;
                ks.releaseFrames = 0;
                releases.push(note);
              }
            } else {
              ks.releaseFrames = 0;
            }`
    );

    // Method 5 style: !crossedPlane || liftedHighEnough
    t = t.replace(
      /if \(!crossedPlane \|\| liftedHighEnough\) \{\s*ks\.state = STATE\.IDLE;\s*releases\.push\(note\);\s*hist\.lowestY = null;\s*\}/,
      `if (!crossedPlane || liftedHighEnough) {
              ks.releaseFrames = (ks.releaseFrames || 0) + 1;
              if (ks.releaseFrames >= 3) {
                ks.state = STATE.IDLE;
                ks.pressedBy = null;
                ks.releaseFrames = 0;
                releases.push(note);
                hist.lowestY = null;
              }
            } else {
              ks.releaseFrames = 0;
            }`
    );

    // ── 5. Also clear pressedBy on global release ──
    t = t.replace(
      /if \(this\._keyStates\[note\]\.state === STATE\.PRESSED\) \{\s*releases\.push\(note\);\s*\}\s*this\._keyStates\[note\]\.state = STATE\.IDLE;/g,
      `if (this._keyStates[note].state === STATE.PRESSED) {
          releases.push(note);
        }
        this._keyStates[note].state = STATE.IDLE;
        this._keyStates[note].pressedBy = null;
        this._keyStates[note].releaseFrames = 0;`
    );

    fs.writeFileSync(file, t, 'utf8');
    console.log('Updated ' + file);
  } catch(e) {
    console.error('FAILED ' + file + ': ' + e.message);
  }
});
