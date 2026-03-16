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
    if (!t.includes('const threshold =')) {
        t = t.replace('const inside = flipped', "const threshold = key.type === 'black' ? surfaceYThresholdBlack : surfaceYThresholdWhite;\n          const inside = flipped");
    }
    t = t.replace(/const inside = flipped \? [^;]+;/, 'const inside = flipped ? lm.y <= threshold : lm.y >= threshold;');
    t = t.replace(/const movingDown = flipped \? [^;]+;/, 'const movingDown = flipped ? dy < -Y_VELOCITY_THRESHOLD : dy > Y_VELOCITY_THRESHOLD;');
    return t;
}

function m2(t) {
    t = t.replace(/const inKeyZone = flipped \? [^;]+;/, 'const inKeyZone = flipped ? lm.y <= surfaceYThreshold : lm.y >= surfaceYThreshold;');
    t = t.replace(/const isUnderDesk = [^;]+;/, 'const isUnderDesk = flipped ? lm.y < key.yMin - 0.1 : lm.y > key.yMax + 0.1;');
    t = t.replace(/const isAtFloor = flipped \? [^;]+;/, 'const isAtFloor = flipped ? lm.y <= floorY + 0.015 : lm.y >= floorY - 0.015;');
    
    // Reverse floor decay signs if they are backwards
    t = t.replace(/if \(flipped\) \{\n\s*this\._fingerFloors\[id\] -= 0\.002;\n\s*\} else \{\n\s*this\._fingerFloors\[id\] \+= 0\.002;/g,
                  'if (flipped) {\n        this._fingerFloors[id] += 0.002;\n      } else {\n        this._fingerFloors[id] -= 0.002;');
    
    t = t.replace(/if \(flipped && lm\.y > this\._fingerFloors\[tipKey\]\)/g, 'if (flipped && lm.y < this._fingerFloors[tipKey])');
    t = t.replace(/\} else if \(\!flipped && lm\.y < this\._fingerFloors\[tipKey\]\)/g, '} else if (!flipped && lm.y > this._fingerFloors[tipKey])');
    return t;
}

function m3(t) {
    t = t.replace(/const hasStoppedMovingDown = flipped \? [^;]+;/, 'const hasStoppedMovingDown = flipped ? dy >= -0.005 : dy <= 0.005;');
    t = t.replace(/const isMovingUpwards = flipped \? [^;]+;/, 'const isMovingUpwards = flipped ? dy > 0.015 : dy < -0.015;');
    t = t.replace(/const inKeyZone = flipped \? [^;]+;/, 'const inKeyZone = flipped ? lm.y <= surfaceYThreshold : lm.y >= surfaceYThreshold;');
    t = t.replace(/const isUnderDesk = flipped \? [^;]+;/, 'const isUnderDesk = flipped ? lm.y < key.yMin - 0.1 : lm.y > key.yMax + 0.1;');
    return t;
}

function m4(t) {
    t = t.replace(/const inKeyZone = flipped \? [^;]+;/, 'const inKeyZone = flipped ? lm.y <= surfaceYThreshold : lm.y >= surfaceYThreshold;');
    t = t.replace(/const isUnderDesk = flipped \? [^;]+;/, 'const isUnderDesk = flipped ? lm.y < key.yMin - 0.1 : lm.y > key.yMax + 0.1;');
    return t;
}

function m5(t) {
    // Reverse dy
    t = t.replace(/const dy = flipped \? \(lm\.y - hist\.lastY\) : \(hist\.lastY - lm\.y\);/, 
                  'const dy = flipped ? (hist.lastY - lm.y) : (lm.y - hist.lastY);');
    
    t = t.replace(/const crossedPlane = flipped \? [^;]+;/, 'const crossedPlane = flipped ? (lm.y <= this._tableY) : (lm.y >= this._tableY);');
    
    t = t.replace(/if \(flipped && lm\.y > hist\.lowestY\)/, 'if (flipped && lm.y < hist.lowestY)');
    t = t.replace(/else if \(!flipped && lm\.y < hist\.lowestY\)/, 'else if (!flipped && lm.y > hist.lowestY)');
    
    t = t.replace(/const liftedHighEnough = flipped \? [^;]+;/, 'const liftedHighEnough = flipped ? (lm.y >= hist.lowestY + 0.03) : (lm.y <= hist.lowestY - 0.03);');
    return t;
}

console.log("Reversed all flip logic.");
