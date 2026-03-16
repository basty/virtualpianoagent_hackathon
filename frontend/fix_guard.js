const fs = require('fs');

// Fix for all methods: only enter hover/active state when finger is INSIDE the surface zone
// This prevents keys from lighting up (active/hover) when finger is above the dash line.

const fixes = {
  'src/detectionMethod1.js': t => {
    // Move frameActive.add inside the 'inside' check
    t = t.replace(
      `if (ks.state === STATE.IDLE || ks.state === STATE.COOLDOWN) {
            ks.state = STATE.HOVER;
          }

          if (ks.state === STATE.HOVER) {
            frameActive.add(note);
            
            if (inside && movingDown && zSpike && curled && debounced) {`,
      `if (inside) {
            if (ks.state === STATE.IDLE || ks.state === STATE.COOLDOWN) {
              ks.state = STATE.HOVER;
            }
          }

          if (ks.state === STATE.HOVER) {
            if (inside) frameActive.add(note);
            
            if (inside && movingDown && zSpike && curled && debounced) {`
    );
    return t;
  },
  'src/detectionMethod2.js': t => {
    // Only add to frameActive if inKeyZone
    t = t.replace(
      `frameActive.add(note);

          if (ks.state === STATE.IDLE) {
            if (inKeyZone && isAtFloor`,
      `if (inKeyZone) frameActive.add(note);

          if (ks.state === STATE.IDLE) {
            if (inKeyZone && isAtFloor`
    );
    return t;
  },
  'src/detectionMethod3.js': t => {
    // Only add to frameActive if inKeyZone
    t = t.replace(
      `frameActive.add(note);

          if (ks.state === STATE.IDLE) {
            if (inKeyZone && hasStoppedMovingDown`,
      `if (inKeyZone) frameActive.add(note);

          if (ks.state === STATE.IDLE) {
            if (inKeyZone && hasStoppedMovingDown`
    );
    return t;
  },
  'src/detectionMethod4.js': t => {
    // Only add to frameActive if inKeyZone
    t = t.replace(
      `frameActive.add(note);

          if (ks.state === STATE.IDLE) {
            if (inKeyZone && isPressedDepth`,
      `if (inKeyZone) frameActive.add(note);

          if (ks.state === STATE.IDLE) {
            if (inKeyZone && isPressedDepth`
    );
    return t;
  },
  'src/detectionMethod5.js': t => {
    // Only add to frameActive if crossedPlane
    t = t.replace(
      `frameActive.add(note);

          if (ks.state === STATE.IDLE) {
            if (crossedPlane && fastDown`,
      `if (crossedPlane) frameActive.add(note);

          if (ks.state === STATE.IDLE) {
            if (crossedPlane && fastDown`
    );
    return t;
  },
};

Object.entries(fixes).forEach(([file, fn]) => {
  try {
    let text = fs.readFileSync(file, 'utf8');
    const before = text;
    text = fn(text);
    if (text === before) {
      console.warn('WARNING: No changes made to ' + file + ' (pattern not found)');
    } else {
      fs.writeFileSync(file, text, 'utf8');
      console.log('Updated ' + file);
    }
  } catch (e) {
    console.error('Failed ' + file + ': ' + e.message);
  }
});
