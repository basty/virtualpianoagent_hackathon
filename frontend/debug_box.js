const { DetectionMethod2 } = require('./src/detectionMethod2.js');

const m2 = new DetectionMethod2();
const keys = [{note: 'C4', type: 'white', xMin: 0.34, xMax: 0.4, yMin: 0.58, yMax: 0.98, yLogMax: 0.98}];
const r = { x: 0.34, y: 0.58, width: 0.32, height: 0.4 };

// simulate hand moving
let lm = { x: 1-0.37, y: 0.5, z: 0 }; // hovering far above the key (outside yMin - 0.05)
let hands = [[{x:0.5,y:0.5,z:0}, null, null, null, lm]]; // tip 4 is thumb

let res1 = m2.detect(hands, keys, r, true);
console.log("Hover 0.5:", res1);

// Move into the key but very high up (y=0.6)
lm.y = 0.6;
let res2 = m2.detect(hands, keys, r, true);
console.log("Hover 0.6:", res2);

// Move down to y=0.7
lm.y = 0.7;
let res3 = m2.detect(hands, keys, r, true);
console.log("Hover 0.7:", res3);

