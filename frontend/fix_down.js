const fs = require('fs');

Object.entries({
    'src/detectionMethod1.js': m1,
    'src/detectionMethod2.js': m2,
    'src/detectionMethod3.js': m3,
    'src/detectionMethod4.js': m4,
    'src/detectionMethod5.js': m5,
}).forEach(([file, fn]) => {
    let text = fs.readFileSync(file, 'utf8');
    text = fn(text);
    fs.writeFileSync(file, text, 'utf8');
});

function m1(t) {
    // inside means below the threshold line (larger Y)
    t = t.replace(/const inside = flipped \? [^;]+;/, 'const inside = lm.y >= threshold;');
    // movingDown means Y is increasing (dy > 0)
    t = t.replace(/const movingDown = flipped \? [^;]+;/, 'const movingDown = dy > Y_VELOCITY_THRESHOLD;');
    return t;
}

function m2(t) {
    // inside the key zone means below the line
    t = t.replace(/const inKeyZone = flipped \? [^;]+;/, 'const inKeyZone = lm.y >= surfaceYThreshold;');
    // under desk means way below
    t = t.replace(/const isUnderDesk = flipped \? [^;]+;/, 'const isUnderDesk = lm.y > key.yMax + 0.1;');
    // floor is at max Y, so atFloor is >= floor
    t = t.replace(/const isAtFloor = flipped \? [^;]+;/, 'const isAtFloor = lm.y >= floorY - 0.015;');
    
    // floor means max Y reached. To decay, floor must move UP (smaller Y), so we can press deeper.
    t = t.replace(/if \(flipped\) \{\n\s*this\._fingerFloors\[id\] \+= 0\.002;\n\s*\} else \{\n\s*this\._fingerFloors\[id\] -= 0\.002;/g,
                  'this._fingerFloors[id] -= 0.002;'); // Decay moves the floor back up
    t = t.replace(/if \(flipped\) \{\n\s*this\._fingerFloors\[id\] -= 0\.002;\n\s*\} else \{\n\s*this\._fingerFloors\[id\] \+= 0\.002;/g,
                  'this._fingerFloors[id] -= 0.002;'); // Decay moves the floor back up
                  
    // if new Y is bigger than floor, it's the new floor
    t = t.replace(/if \(flipped && lm\.y < this\._fingerFloors\[tipKey\]\)/g, 'if (lm.y > this._fingerFloors[tipKey])');
    t = t.replace(/\} else if \(\!flipped && lm\.y > this\._fingerFloors\[tipKey\]\)/g, '');
    return t;
}

function m3(t) {
    // dy > 0 means moving down on screen
    t = t.replace(/const hasStoppedMovingDown = flipped \? [^;]+;/, 'const hasStoppedMovingDown = dy <= 0.005;');
    t = t.replace(/const isMovingUpwards = flipped \? [^;]+;/, 'const isMovingUpwards = dy < -0.015;');
    t = t.replace(/const inKeyZone = flipped \? [^;]+;/, 'const inKeyZone = lm.y >= surfaceYThreshold;');
    t = t.replace(/const isUnderDesk = flipped \? [^;]+;/, 'const isUnderDesk = lm.y > key.yMax + 0.1;');
    return t;
}

function m4(t) {
    t = t.replace(/const inKeyZone = flipped \? [^;]+;/, 'const inKeyZone = lm.y >= surfaceYThreshold;');
    t = t.replace(/const isUnderDesk = flipped \? [^;]+;/, 'const isUnderDesk = lm.y > key.yMax + 0.1;');
    return t;
}

function m5(t) {
    // dy > 0 means moving down
    t = t.replace(/const dy = flipped \? [^;]+;/, 'const dy = lm.y - hist.lastY; // positive = moving down into keys');
    
    // crossedPlane means going below the line
    t = t.replace(/const crossedPlane = flipped \? [^;]+;/, 'const crossedPlane = lm.y >= this._tableY;');
    
    // lowest Y is numerically HIGHEST Y
    t = t.replace(/if \(flipped && lm\.y < hist\.lowestY\)/, 'if (lm.y > hist.lowestY)');
    t = t.replace(/else if \(\!flipped && lm\.y > hist\.lowestY\)/, '');
    
    t = t.replace(/const liftedHighEnough = flipped \? [^;]+;/, 'const liftedHighEnough = lm.y <= hist.lowestY - 0.03;');
    return t;
}

console.log("Forced all to PRESS DOWN (larger Y).");
