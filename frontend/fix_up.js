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
    // inside means above the threshold line (smaller Y)
    t = t.replace(/const inside = lm\.y >= threshold;/, 'const inside = lm.y <= threshold;');
    // movingDown means Y is decreasing (dy < 0)
    t = t.replace(/const movingDown = dy > Y_VELOCITY_THRESHOLD;/, 'const movingDown = dy < -Y_VELOCITY_THRESHOLD;');
    return t;
}

function m2(t) {
    // inside the key zone means above the line
    t = t.replace(/const inKeyZone = lm\.y >= surfaceYThreshold;/, 'const inKeyZone = lm.y <= surfaceYThreshold;');
    // under desk means way above
    t = t.replace(/const isUnderDesk = lm\.y > key\.yMax \+ 0\.1;/, 'const isUnderDesk = lm.y < key.yMin - 0.1;');
    // floor is at min Y, so atFloor is <= floor
    t = t.replace(/const isAtFloor = lm\.y >= floorY - 0\.015;/, 'const isAtFloor = lm.y <= floorY + 0.015;');
    
    // floor decay: move floor DOWN (larger Y)
    t = t.replace(/this\._fingerFloors\[id\] -= 0\.002;/, 'this._fingerFloors[id] += 0.002;');
                  
    // if new Y is smaller than floor, it's the new floor
    t = t.replace(/if \(lm\.y > this\._fingerFloors\[tipKey\]\)/g, 'if (lm.y < this._fingerFloors[tipKey])');
    return t;
}

function m3(t) {
    // dy < 0 means moving down on screen (towards Y=0)
    t = t.replace(/const hasStoppedMovingDown = dy <= 0\.005;/, 'const hasStoppedMovingDown = dy >= -0.005;');
    t = t.replace(/const isMovingUpwards = dy < -0\.015;/, 'const isMovingUpwards = dy > 0.015;');
    t = t.replace(/const inKeyZone = lm\.y >= surfaceYThreshold;/, 'const inKeyZone = lm.y <= surfaceYThreshold;');
    t = t.replace(/const isUnderDesk = lm\.y > key\.yMax \+ 0\.1;/, 'const isUnderDesk = lm.y < key.yMin - 0.1;');
    return t;
}

function m4(t) {
    t = t.replace(/const inKeyZone = lm\.y >= surfaceYThreshold;/, 'const inKeyZone = lm.y <= surfaceYThreshold;');
    t = t.replace(/const isUnderDesk = lm\.y > key\.yMax \+ 0\.1;/, 'const isUnderDesk = lm.y < key.yMin - 0.1;');
    return t;
}

function m5(t) {
    // dy > 0 means moving down (decreasing Y)
    t = t.replace(/const dy = lm\.y - hist\.lastY; \/\/ positive = moving down into keys/, 'const dy = hist.lastY - lm.y; // positive = moving down towards Y=0');
    
    // crossedPlane means going above the line (smaller Y)
    t = t.replace(/const crossedPlane = lm\.y >= this\._tableY;/, 'const crossedPlane = lm.y <= this._tableY;');
    
    // lowest Y is numerically SMALLEST Y
    t = t.replace(/if \(lm\.y > hist\.lowestY\)/, 'if (lm.y < hist.lowestY)');
    t = t.replace(/if \(hist\.lowestY === undefined \|\| hist\.lowestY === null\) \{/, 'if (hist.lowestY === undefined || hist.lowestY === null) {\n                hist.lowestY = lm.y;');
    
    t = t.replace(/const liftedHighEnough = lm\.y <= hist\.lowestY - 0\.03;/, 'const liftedHighEnough = lm.y >= hist.lowestY + 0.03;');
    return t;
}

console.log("Forced all to PRESS UP (smaller Y).");
