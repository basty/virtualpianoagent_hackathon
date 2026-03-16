const fs = require('fs');

Object.entries({
    'src/detectionMethod1.js': m1,
    'src/detectionMethod2.js': m2,
    'src/detectionMethod3.js': m3,
    'src/detectionMethod4.js': m4,
    'src/detectionMethod5.js': m5,
    'src/detectionMethod6.js': m6,
}).forEach(([file, fn]) => {
    try {
        let text = fs.readFileSync(file, 'utf8');
        text = fn(text);
        fs.writeFileSync(file, text, 'utf8');
        console.log("Updated " + file);
    } catch (e) {
        console.error("Failed to update " + file + ": " + e.message);
    }
});

function m1(t) {
    if (!t.includes('const threshold =')) {
        t = t.replace('const inside =', "const threshold = key.type === 'black' ? surfaceYThresholdBlack : surfaceYThresholdWhite;\n          const inside =");
    }
    t = t.replace(/const inside = [^;]+;/, 'const inside = lm.y <= threshold;');
    t = t.replace(/const movingDown = [^;]+;/, 'const movingDown = dy < -Y_VELOCITY_THRESHOLD;');
    return t;
}

function m2(t) {
    t = t.replace(/this\._fingerFloors\[id\] [-+]= 0\.002;/, 'this._fingerFloors[id] += 0.002;');
    t = t.replace(/if \(!this\._fingerFloors\[tipKey\]\) \{[\s\S]*?else \{[\s\S]*?if \(lm\.y > this\._fingerFloors\[tipKey\]\) \{[\s\S]*?\}[\s\S]*?\}/, 
        `if (!this._fingerFloors[tipKey]) {
          this._fingerFloors[tipKey] = lm.y;
        } else {
          if (lm.y < this._fingerFloors[tipKey]) {
            this._fingerFloors[tipKey] = lm.y;
          }
        }`);
    t = t.replace(/const isAtFloor = lm\.y >= floorY - 0\.015;/, 'const isAtFloor = lm.y <= floorY + 0.015;');
    t = t.replace(/const inKeyZone = lm\.y >= surfaceYThreshold;/, 'const inKeyZone = lm.y <= surfaceYThreshold;');
    t = t.replace(/const isUnderDesk = lm\.y > key\.yMax \+ 0\.1;/, 'const isUnderDesk = lm.y < key.yMin - 0.1;');
    return t;
}

function m3(t) {
    t = t.replace(/const hasStoppedMovingDown = [^;]+;/, 'const hasStoppedMovingDown = dy >= -0.005;');
    t = t.replace(/const isMovingUpwards = [^;]+;/, 'const isMovingUpwards = dy > 0.015;');
    t = t.replace(/const inKeyZone = [^;]+;/, 'const inKeyZone = lm.y <= surfaceYThreshold;');
    t = t.replace(/const isUnderDesk = [^;]+;/, 'const isUnderDesk = lm.y < key.yMin - 0.1;');
    return t;
}

function m4(t) {
    t = t.replace(/const inKeyZone = [^;]+;/, 'const inKeyZone = lm.y <= surfaceYThreshold;');
    t = t.replace(/const isUnderDesk = [^;]+;/, 'const isUnderDesk = lm.y < key.yMin - 0.1;');
    return t;
}

function m5(t) {
    t = t.replace(/const dy = [^;]+; \/\/ positive = moving down towards Y=0/, 'const dy = hist.lastY - lm.y; // positive = moving down towards Y=0');
    t = t.replace(/const dy = [^;]+; \/\/ positive = moving down into keys/, 'const dy = hist.lastY - lm.y; // positive = moving down towards Y=0');
    t = t.replace(/const crossedPlane = [^;]+;/, 'const crossedPlane = lm.y <= this._tableY;');
    t = t.replace(/if \(lm\.y > hist\.lowestY\)/, 'if (lm.y < hist.lowestY)');
    t = t.replace(/const liftedHighEnough = [^;]+;/, 'const liftedHighEnough = lm.y >= hist.lowestY + 0.03;');
    return t;
}

function m6(t) {
    // If user approaches from top (small Y), worldLM.z being POSITIVE might be away from camera (table).
    // Let's ensure z tracking is consistent. 
    // In our implementation: worldLm.z > hist.lastZ + 0.002 was 'velocityDown'.
    // If it's inverted, z should decrease.
    t = t.replace(/if \(worldLm\.z > hist\.lastZ \+ 0\.002\)/, 'if (worldLm.z < hist.lastZ - 0.002)');
    return t;
}
