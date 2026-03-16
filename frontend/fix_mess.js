const fs = require('fs');
const files = [
    'src/detectionMethod2.js',
    'src/detectionMethod3.js',
    'src/detectionMethod4.js',
    'src/detectionMethod5.js'
];

files.forEach(file => {
    let text = fs.readFileSync(file, 'utf8');
    if (text.startsWith('if (flipped)')) {
        let idx = text.indexOf('import { FINGERTIP_IDS }');
        text = text.substring(idx);
    }
    fs.writeFileSync(file, text, 'utf8');
});
