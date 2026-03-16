try {
  const lm = { y: 0.5 };
  const flipped = true;
  const inside = flipped ? lm.y >= threshold : lm.y <= threshold;
  console.log("SURVIVED", inside);
} catch (e) {
  console.log("ERROR:", e.message);
}
