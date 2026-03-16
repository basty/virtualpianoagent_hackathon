const fs = require('fs');

// FIX Methods 1-5: inside = lm.y >= threshold (BELOW the dash line, larger Y)
// The dash line is at top of the "touch zone" (yMin + TOUCH_ZONE_FRAC for flipped)
// Pressing INTO the key means going BELOW that line = larger Y values.

// FIX Method 6: release when finger moves back up (lm.y becomes larger than it was when pressed)

const fixes = {
  'src/detectionMethod1.js': t => {
    // inside: above the threshold or at/below? We want BELOW = larger Y
    t = t.replace(/const inside = lm\.y <= threshold;/, 'const inside = lm.y >= threshold; // below the surface line');
    // movingDown: larger Y = moving down
    t = t.replace(/const movingDown = dy < -Y_VELOCITY_THRESHOLD;/, 'const movingDown = dy > Y_VELOCITY_THRESHOLD; // positive dy = moving down');
    return t;
  },
  'src/detectionMethod2.js': t => {
    // inKeyZone: below the surface line = larger Y
    t = t.replace(/const inKeyZone = lm\.y <= surfaceYThreshold;/, 'const inKeyZone = lm.y >= surfaceYThreshold;');
    return t;
  },
  'src/detectionMethod3.js': t => {
    // hasStoppedMovingDown: positive dy = moving down, stopped = dy close to 0 or negative
    t = t.replace(/const hasStoppedMovingDown = dy >= -0\.005;/, 'const hasStoppedMovingDown = dy <= 0.005;');
    // isMovingUpwards: negative dy = going up (smaller Y)
    t = t.replace(/const isMovingUpwards = dy > 0\.015;/, 'const isMovingUpwards = dy < -0.015;');
    // inKeyZone: below surface line
    t = t.replace(/const inKeyZone = lm\.y <= surfaceYThreshold;/, 'const inKeyZone = lm.y >= surfaceYThreshold;');
    return t;
  },
  'src/detectionMethod4.js': t => {
    // inKeyZone: below surface line
    t = t.replace(/const inKeyZone = lm\.y <= surfaceYThreshold;/, 'const inKeyZone = lm.y >= surfaceYThreshold;');
    return t;
  },
  'src/detectionMethod5.js': t => {
    // dy = positive means moving down (larger Y)
    t = t.replace(/const dy = hist\.lastY - lm\.y;[^\n]*/, 'const dy = lm.y - hist.lastY; // positive = moving down (larger Y)');
    // crossedPlane: pressing into keys = Y >= tableY
    t = t.replace(/const crossedPlane = lm\.y <= this\._tableY;/, 'const crossedPlane = lm.y >= this._tableY;');
    // lowestY = deepest press = largest Y
    t = t.replace(/if \(lm\.y < hist\.lowestY\)/, 'if (lm.y > hist.lowestY)');
    // liftedHighEnough: went back up (smaller Y) significantly
    t = t.replace(/const liftedHighEnough = lm\.y >= hist\.lowestY \+ 0\.03;/, 'const liftedHighEnough = lm.y <= hist.lowestY - 0.03;');
    return t;
  },
  'src/detectionMethod6.js': t => {
    // Fix release: track the Y when pressed, release if finger rises significantly above that Y
    // Replace the static "touching" release with a Y-rise check
    t = t.replace(
      `if (!this._history[tipKey]) this._history[tipKey] = { lastZ: worldLm.z, cooldown: 0, wasTouching: false };`,
      `if (!this._history[tipKey]) this._history[tipKey] = { lastZ: worldLm.z, cooldown: 0, wasTouching: false, pressedY: null };`
    );
    // Track pressedY on press
    t = t.replace(
      `hist.cooldown = 10;\n            }`,
      `hist.cooldown = 10;\n              hist.pressedY = lm.y;\n            }`
    );
    // Release when finger rises enough above pressedY (smaller Y = finger lifted up)
    t = t.replace(
      `if (this.planeNormal && !touching) {
              ks.state = STATE.IDLE;
              releases.push(note);
            } else if (!this.planeNormal) {
               ks.state = STATE.IDLE;
               releases.push(note);
            } else {
              framePressing.add(note);
            }`,
      `const raisedHighEnough = hist.pressedY !== null && lm.y < hist.pressedY - 0.03;
            if (!touching || raisedHighEnough) {
              ks.state = STATE.IDLE;
              releases.push(note);
              hist.pressedY = null;
            } else if (!this.planeNormal) {
               ks.state = STATE.IDLE;
               releases.push(note);
            } else {
              framePressing.add(note);
            }`
    );
    return t;
  },
};

Object.entries(fixes).forEach(([file, fn]) => {
  try {
    let text = fs.readFileSync(file, 'utf8');
    text = fn(text);
    fs.writeFileSync(file, text, 'utf8');
    console.log('Updated ' + file);
  } catch (e) {
    console.error('Failed ' + file + ': ' + e.message);
  }
});
