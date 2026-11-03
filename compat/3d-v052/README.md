# Offline 3D compatibility archive

These files are exact copies of v0.5.2 public source files. They reproduce renderer hashes and geometry of saved v1/v2/v3 avatar receipts and run historical regression tests. They are outside the served public directory. The server refuses retired renderer and Three.js vendor URLs.

The current map, wardrobe and items use public/pixel-*.js. Do not wire archived modules into a browser entry, restore the old import map, or rewrite an old recipe just to match the current renderer. A new appearance requires explicit save and a new history record.
