/**
 * Circular dependency detection for JavaScript/TypeScript source files.
 *
 * Design notes that are not obvious from the signatures:
 *
 * 1. We do not use a real parser. A regex-based extractor is enough for the
 *    problem we solve (spotting import cycles early) and keeps the library at
 *    zero dependencies. The cost is that we only recognise the static import
 *    and re-export forms listed in `IMPORT_PATTERNS`; dynamic `import()` and
 *    `require()` calls are deliberately ignored because they are not part of
 *    the static module graph the bundler builds.
 *
 * 2. Paths are resolved against the *project root*, not the importing file's
 *    directory, because callers pass a root and a flat list of files. Callers
 *    that need nested resolution can pre-normalise their `files` list.
 *
 * 3. Cycles are reported as the full chain starting and ending at the same
 *    node, e.g. `['a.js', 'b.js', 'a.js']`. Returning the closed chain makes
 *    the report directly readable without the caller having to append the
 *    first element again.
 */

/**
 * Matches the import forms we support. Group 1 is the specifier.
 *
 * - `import x from './y.js'`
 * - `import './y.js'`
 * - `import * as ns from './y.js'`
 * - `import { a, b } from './y.js'`
 * - `export { x } from './y.js'`
 * - `export * from './y.js'`
 *
 * The specifier must start with `.` or `/`; bare package specifiers are
 * skipped because they do not participate in the local file graph.
 */
const IMPORT_PATTERNS = [
  /(?:^|[\s;])import\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g,
  /(?:^|[\s;])export\s+(?:[^'";]*?\s+from\s+)['"]([^'"]+)['"]/g,
];

/**
 * Extract the module specifiers referenced by a source string.
 *
 * Returns only relative or absolute specifiers; bare specifiers such as
 * `react` are dropped because they cannot form a cycle inside the project.
 *
 * @param {string} source
 * @returns {string[]}
 */
export function extractSpecifiers(source) {
  if (typeof source !== 'string') {
    throw new TypeError('source must be a string');
  }
  const found = new Set();
  for (const pattern of IMPORT_PATTERNS) {
    // Each pattern carries the `g` flag, so lastIndex persists between calls
    // on the same RegExp object. Reset it explicitly to keep repeated calls
    // deterministic.
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const spec = match[1];
      if (spec.startsWith('.') || spec.startsWith('/')) {
        found.add(spec);
      }
    }
  }
  return [...found];
}

/**
 * Normalise a path into a stable key.
 *
 * We keep this deliberately simple: strip a leading `./`, collapse repeated
 * slashes, and drop a trailing slash. We do not resolve `..` because doing so
 * correctly requires knowing the file's real location, which the flat input
 * list does not give us.
 *
 * @param {string} path
 * @returns {string}
 */
export function normalisePath(path) {
  if (typeof path !== 'string') {
    throw new TypeError('path must be a string');
  }
  let out = path.replace(/\\/g, '/');
  out = out.replace(/\/{2,}/g, '/');
  out = out.replace(/^\.\//, '');
  out = out.replace(/\/$/, '');
  return out;
}

/**
 * Build a dependency graph from a list of files.
 *
 * @param {{ path: string, source: string }[]} files
 * @returns {Map<string, string[]>} map of normalised path to normalised deps
 */
export function buildGraph(files) {
  if (!Array.isArray(files)) {
    throw new TypeError('files must be an array');
  }
  const graph = new Map();
  for (const file of files) {
    if (!file || typeof file.path !== 'string' || typeof file.source !== 'string') {
      throw new TypeError('each file needs a string path and string source');
    }
    const key = normalisePath(file.path);
    const deps = extractSpecifiers(file.source).map(normalisePath);
    graph.set(key, deps);
  }
  return graph;
}

/**
 * Find every elementary cycle in the graph.
 *
 * We use an iterative depth-first search with an explicit stack rather than
 * recursion so that deeply nested projects do not blow the call stack. Each
 * cycle is canonicalised (rotated so the lexicographically smallest node
 * comes first) and de-duplicated, because a cycle reachable from several
 * starting points would otherwise be reported many times.
 *
 * @param {Map<string, string[]>} graph
 * @returns {string[][]} cycles, each as a closed chain
 */
export function findCycles(graph) {
  if (!(graph instanceof Map)) {
    throw new TypeError('graph must be a Map');
  }
  const cycles = [];
  const seen = new Set();
  const nodes = [...graph.keys()].sort();

  for (const start of nodes) {
    const stack = [{ node: start, path: [start] }];
    while (stack.length > 0) {
      const { node, path } = stack.pop();
      const deps = graph.get(node) || [];
      for (const dep of deps) {
        if (!graph.has(dep)) {
          // The dependency points outside the provided file set. It cannot
          // close a cycle inside this graph, so skip it.
          continue;
        }
        if (dep === start) {
          const cycle = canonicalise([...path, start]);
          const key = cycle.join('\u0000');
          if (!seen.has(key)) {
            seen.add(key);
            cycles.push(cycle);
          }
        } else if (!path.includes(dep)) {
          stack.push({ node: dep, path: [...path, dep] });
        }
      }
    }
  }

  cycles.sort((a, b) => a.join('\u0000').localeCompare(b.join('\u0000')));
  return cycles;
}

/**
 * Rotate a closed chain so the smallest node is first, then re-close it.
 *
 * Two chains that describe the same cycle but start at different nodes must
 * compare equal after this step; that is what makes de-duplication work.
 *
 * @param {string[]} chain
 * @returns {string[]}
 */
function canonicalise(chain) {
  const body = chain.slice(0, -1);
  let best = 0;
  for (let i = 1; i < body.length; i += 1) {
    if (body[i] < body[best]) {
      best = i;
    }
  }
  const rotated = [...body.slice(best), ...body.slice(0, best)];
  rotated.push(rotated[0]);
  return rotated;
}

/**
 * Render a cycle as a readable arrow chain.
 *
 * @param {string[]} cycle
 * @returns {string}
 */
export function formatCycle(cycle) {
  if (!Array.isArray(cycle) || cycle.length === 0) {
    throw new TypeError('cycle must be a non-empty array');
  }
  return cycle.join(' -> ');
}
