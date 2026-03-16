const fs = require('fs');
const files = [
    'src/detectionMethod1.js',
    'src/detectionMethod2.js',
    'src/detectionMethod3.js',
    'src/detectionMethod4.js',
    'src/detectionMethod5.js'
];

files.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');

    // Method 1 Revert + Fix
    if (file.includes('1.js')) {
        content = content.replace(/const inside = flipped \? lm\.y >= threshold : lm\.y <= threshold;/, 
                                  '// flipped=true: desk at top (small y). flipped=false: desk at bottom (large y)\n          const inside = flipped ? lm.y <= threshold : lm.y >= threshold;');
        content = content.replace(/const movingDown = flipped \? dy > Y_VELOCITY_THRESHOLD : dy < -Y_VELOCITY_THRESHOLD;/,
                                  'const movingDown = flipped ? dy < -Y_VELOCITY_THRESHOLD : dy > Y_VELOCITY_THRESHOLD;');
        // Fix zSpike (make it require dz > 0 to press into desk, or dz < threshold if camera is special)
        // Original: const zSpike     = dz < Z_VELOCITY_THRESHOLD; (-0.012)
        // This triggers on raise! Let's make it Math.abs(dz) > 0.005 so it triggers on any spike.
        content = content.replace(/const zSpike\s*=\s*dz < Z_VELOCITY_THRESHOLD;/,
                                  'const zSpike     = Math.abs(dz) > 0.008;');
    }
    
    // Method 2 Revert
    if (file.includes('2.js')) {
        content = content.replace(/if \(flipped\) {\n\s*this\._fingerFloors\[id\] -= 0\.002;\n\s*} else {\n\s*this\._fingerFloors\[id\] \+= 0\.002;\n\s*}/,
                                  'if (flipped) {\n        this._fingerFloors[id] += 0.002;\n      } else {\n        this._fingerFloors[id] -= 0.002;\n      }');
        
        content = content.replace(/if \(flipped && lm\.y > this\._fingerFloors\[tipKey\]\) {/,
                                  'if (flipped && lm.y < this._fingerFloors[tipKey]) {');
        content = content.replace(/} else if \(!flipped && lm\.y < this\._fingerFloors\[tipKey\]\) {/,
                                  '} else if (!flipped && lm.y > this._fingerFloors[tipKey]) {');
        
        content = content.replace(/const isAtFloor = flipped \? lm\.y >= floorY - 0\.015 : lm\.y <= floorY \+ 0\.015;/,
                                  'const isAtFloor = flipped ? lm.y <= floorY + 0.015 : lm.y >= floorY - 0.015;');
        
        content = content.replace(/const inKeyZone = flipped \? lm\.y >= surfaceYThreshold : lm\.y <= surfaceYThreshold;/,
                                  'const inKeyZone = flipped ? lm.y <= surfaceYThreshold : lm.y >= surfaceYThreshold;');
        content = content.replace(/const isUnderDesk = flipped \? lm\.y > key\.yMax \+ 0\.1 : lm\.y < key\.yMin - 0\.1;/,
                                  'const isUnderDesk = flipped ? lm.y < key.yMin - 0.1 : lm.y > key.yMax + 0.1;');
        
        content = content.replace(/if \(lm\.y < key\.yMin || lm\.y > key\.yLogMax\) continue;/,
                                  `if (flipped) {\n            if (lm.y > key.yMax) continue; \n          } else {\n            if (lm.y < key.yMin) continue;\n          }`);
    }

    // Method 3 Revert
    if (file.includes('3.js')) {
        content = content.replace(/const hasStoppedMovingDown = flipped \? dy <= 0\.001 : dy >= -0\.001;/,
                                  'const hasStoppedMovingDown = flipped ? dy >= -0.001 : dy <= 0.001;');
        content = content.replace(/const isMovingUpwards = flipped \? dy < -0\.005 : dy > 0\.005;/,
                                  'const isMovingUpwards = flipped ? dy > 0.005 : dy < -0.005;');
        content = content.replace(/const inKeyZone = flipped \? lm\.y >= surfaceYThreshold : lm\.y <= surfaceYThreshold;/,
                                  'const inKeyZone = flipped ? lm.y <= surfaceYThreshold : lm.y >= surfaceYThreshold;');
        content = content.replace(/const isUnderDesk = flipped \? lm\.y > key\.yMax \+ 0\.1 : lm\.y < key\.yMin - 0\.1;/,
                                  'const isUnderDesk = flipped ? lm.y < key.yMin - 0.1 : lm.y > key.yMax + 0.1;');
        
        content = content.replace(/if \(lm\.y < key\.yMin || lm\.y > key\.yLogMax\) continue;/,
                                  `if (flipped) {\n            if (lm.y > key.yMax) continue; \n          } else {\n            if (lm.y < key.yMin) continue;\n          }`);
    }

    // Method 4 Revert
    if (file.includes('4.js')) {
        content = content.replace(/const inKeyZone = flipped \? lm\.y >= surfaceYThreshold : lm\.y <= surfaceYThreshold;/,
                                  'const inKeyZone = flipped ? lm.y <= surfaceYThreshold : lm.y >= surfaceYThreshold;');
        content = content.replace(/const isUnderDesk = flipped \? lm\.y > key\.yMax \+ 0\.1 : lm\.y < key\.yMin - 0\.1;/,
                                  'const isUnderDesk = flipped ? lm.y < key.yMin - 0.1 : lm.y > key.yMax + 0.1;');
        
        content = content.replace(/if \(lm\.y < key\.yMin || lm\.y > key\.yLogMax\) continue;/,
                                  `if (flipped) {\n            if (lm.y > key.yMax) continue; \n          } else {\n            if (lm.y < key.yMin) continue;\n          }`);
        
        // Z-Depth fix if Z actually triggers on raise
        // Original: isPressedDepth = relZ < -0.04
        content = content.replace(/const isPressedDepth = relZ < -0\.04;/, 
                                  'const isPressedDepth = Math.abs(relZ) > 0.04;');
    }

    // Method 5 Revert
    if (file.includes('5.js')) {
        content = content.replace(/const dy = \(flipped \? \(lm\.y - hist\.lastY\) : \(hist\.lastY - lm\.y\)\);/,
                                  'const dy = (flipped ? (hist.lastY - lm.y) : (lm.y - hist.lastY));');
        content = content.replace(/const crossedPlane = flipped \? \(lm\.y >= this\._tableY\) : \(lm\.y <= this\._tableY\);/,
                                  'const crossedPlane = flipped ? (lm.y <= this._tableY) : (lm.y >= this._tableY);');
        
        content = content.replace(/if \(lm\.y < key\.yMin || lm\.y > key\.yLogMax\) continue;/,
                                  `if (flipped) {\n            if (lm.y > key.yMax + 0.1) continue; \n          } else {\n            if (lm.y < key.yMin - 0.1) continue;\n          }`);
    }

    fs.writeFileSync(file, content, 'utf8');
});

console.log("Fixed files.");
