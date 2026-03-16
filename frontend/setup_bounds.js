const fs = require('fs');
const files = [
    'src/detectionMethod1.js',
    'src/detectionMethod2.js',
    'src/detectionMethod3.js',
    'src/detectionMethod4.js',
    'src/detectionMethod5.js'
];

files.forEach(file => {
    let text = fs.readFileSync(file, 'utf8');
    
    // Remove any leftover old bounds
    text = text.replace(/if \(flipped\) \{\s*if \(lm\.y > key\.yMax(?:\s*\+\s*0\.1)?\) continue; \s*\} else \{\s*if \(lm\.y < key\.yMin(?: - 0\.1)?\) continue;\s*\}/g, '');
    text = text.replace(/if \(lm\.y < key\.yMin - 0\.1 \|\| lm\.y > key\.yLogMax \+ 0\.1\) continue;/g, '');
    text = text.replace(/if \(lm\.y < key\.yMin \|\| lm\.y > key\.yLogMax\) continue;/g, '');

    // Add exactly one new bounded check right after the x bounds check
    text = text.replace(/if \(mx < key\.xMin \|\| mx > key\.xMax\) continue;/g, 
                        'if (mx < key.xMin || mx > key.xMax) continue;\n          if (lm.y < key.yMin - 0.05 || lm.y > key.yMax + 0.05) continue;');
    
    // Also, clean up method 2's double replace oops if any
    
    fs.writeFileSync(file, text, 'utf8');
});

console.log("Bounds setup complete.");
