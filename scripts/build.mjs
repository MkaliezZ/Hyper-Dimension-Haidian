// Legacy build entry now uses this school's complete geometry/art pipeline.
await import('./prepare-haidian-data.mjs');
await import('./export-haidian-scene.mjs');
await import('./verify-haidian.mjs');
