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
    t = t.replace(/const inside = flipped \? [^;]+;/, 'const inside = flipped ? lm.y >= threshold : lm.y <= threshold;');
    t = t.replace(/const movingDown = flipped \? [^;]+;/, 'const movingDown = flipped ? dy > Y_VELOCITY_THRESHOLD : dy < -Y_VELOCITY_THRESHOLD;');
    return t;
}

function m2(t) {
    t = t.replace(/const inKeyZone = flipped \? [^;]+;/, 'const inKeyZone = flipped ? lm.y >= surfaceYThreshold : lm.y <= surfaceYThreshold;');
    t = t.replace(/const isUnderDesk = [^;]+;/, 'const isUnderDesk = flipped ? lm.y > key.yMax + 0.1 : lm.y < key.yMin - 0.1;');
    t = t.replace(/const isAtFloor = flipped \? [^;]+;/, 'const isAtFloor = flipped ? lm.y >= floorY - 0.015 : lm.y <= floorY + 0.015;');
    
    // We already fixed the floors loop so let's verify
    if (t.includes('this._fingerFloors[id] += 0.002;')) {
         // wait, if flipped=true, lm.y increases as we go down. So the floor is the maximum Y reached.
         // to decay the floor, we must make it smaller (decrease Y) so the user has to press deeper again.
         // if flipped=false, lm.y decreases as we go down. Floor is minimum Y reached.
         // to decay the floor, we must make it larger (increase Y).
        t = t.replace(/if \(flipped\) \{\n\s*this\._fingerFloors\[id\].*?;/g, 'if (flipped) {\n        this._fingerFloors[id] -= 0.002;');
        t = t.replace(/\} else \{\n\s*this\._fingerFloors\[id\].*?;/g, '} else {\n        this._fingerFloors[id] += 0.002;');
    }
    t = t.replace(/if \(flipped && lm\.y < this\._fingerFloors\[tipKey\]\)/g, 'if (flipped && lm.y > this._fingerFloors[tipKey])');
    t = t.replace(/\} else if \(\!flipped && lm\.y > this\._fingerFloors\[tipKey\]\)/g, '} else if (!flipped && lm.y < this._fingerFloors[tipKey])');
    return t;
}

function m3(t) {
    t = t.replace(/const hasStoppedMovingDown = [^;]+;/, 'const hasStoppedMovingDown = flipped ? dy <= 0.005 : dy >= -0.005;');
    t = t.replace(/const isMovingUpwards = [^;]+;/, 'const isMovingUpwards = flipped ? dy < -0.015 : dy > 0.015;');
    t = t.replace(/const inKeyZone = [^;]+;/, 'const inKeyZone = flipped ? lm.y >= surfaceYThreshold : lm.y <= surfaceYThreshold;');
    t = t.replace(/const isUnderDesk = [^;]+;/, 'const isUnderDesk = flipped ? lm.y > key.yMax + 0.1 : lm.y < key.yMin - 0.1;');
    return t;
}

function m4(t) {
    t = t.replace(/const inKeyZone = [^;]+;/, 'const inKeyZone = flipped ? lm.y >= surfaceYThreshold : lm.y <= surfaceYThreshold;');
    t = t.replace(/const isUnderDesk = [^;]+;/, 'const isUnderDesk = flipped ? lm.y > key.yMax + 0.1 : lm.y < key.yMin - 0.1;');
    return t;
}

function m5(t) {
    t = t.replace(/const dy = [^;]+;\s*\/\/\s*positive = moving into keys/, 
                  'const dy = flipped ? (lm.y - hist.lastY) : (hist.lastY - lm.y); // positive = moving into keys');
    t = t.replace(/const crossedPlane = [^;]+;/, 'const crossedPlane = flipped ? (lm.y >= this._tableY) : (lm.y <= this._tableY);');
    
    // lowestY tracking fix: 
    // If flipped, lm.y increases going down, so "lowest" means highest numerical Y (deepest press)
    // If unflipped, lm.y decreases going down, so "lowest" means lowest numerical Y.
    // the code expects lowestY to be the deep physical point. 
    // And "liftedHighEnough" means moving BACK OUT by withdrawing.
        
    t = t.replace(/if \(flipped && lm\.y < hist\.lowestY\)/, 'if (flipped && lm.y > hist.lowestY)');
    t = t.replace(/else if \(!flipped && lm\.y > hist\.lowestY\)/, 'else if (!flipped && lm.y < hist.lowestY)');
    
    t = t.replace(/const liftedHighEnough = [^;]+;/, 'const liftedHighEnough = flipped ? (lm.y <= hist.lowestY - 0.03) : (lm.y >= hist.lowestY + 0.03);');
    return t;
}

console.log("Unified Logic Done.");
