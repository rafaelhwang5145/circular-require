/**
 * Public entry point for circular-require.
 *
 * The re-export surface is intentionally tiny: everything a caller needs is
 * `findCycles`, `formatCycle`, and `buildGraph`. Keeping the surface small
 * means the README can describe the whole API in one screen.
 */
export { buildGraph, findCycles, formatCycle } from './core.js';
