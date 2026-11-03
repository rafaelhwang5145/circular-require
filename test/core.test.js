import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, findCycles, formatCycle, extractSpecifiers, normalisePath } from '../src/core.js';

test('extractSpecifiers finds static imports and re-exports', () => {
  const source = [
    "import a from './a.js';",
    "import { b, c } from './b.js';",
    "import * as d from './d.js';",
    "import './side-effect.js';",
    "export { e } from './e.js';",
    "export * from './f.js';",
  ].join('\n');
  assert.deepEqual(extractSpecifiers(source).sort(), [
    './a.js',
    './b.js',
    './d.js',
    './e.js',
    './f.js',
    './side-effect.js',
  ]);
});

test('extractSpecifiers ignores bare package specifiers', () => {
  const source = "import react from 'react';\nimport x from './x.js';";
  assert.deepEqual(extractSpecifiers(source), ['./x.js']);
});

test('extractSpecifiers is stable across repeated calls', () => {
  const source = "import a from './a.js';";
  assert.deepEqual(extractSpecifiers(source), ['./a.js']);
  assert.deepEqual(extractSpecifiers(source), ['./a.js']);
});

test('extractSpecifiers rejects non-string input', () => {
  assert.throws(() => extractSpecifiers(null), TypeError);
});

test('normalisePath strips leading ./ and trailing /', () => {
  assert.equal(normalisePath('./src/index.js'), 'src/index.js');
  assert.equal(normalisePath('src/lib/'), 'src/lib');
  assert.equal(normalisePath('src//lib.js'), 'src/lib.js');
  assert.equal(normalisePath('src\\lib.js'), 'src/lib.js');
});

test('buildGraph maps each file to its normalised dependencies', () => {
  const graph = buildGraph([
    { path: './a.js', source: "import './b.js';" },
    { path: './b.js', source: "import './a.js';" },
  ]);
  assert.deepEqual([...graph.keys()].sort(), ['a.js', 'b.js']);
  assert.deepEqual(graph.get('a.js'), ['b.js']);
  assert.deepEqual(graph.get('b.js'), ['a.js']);
});

test('buildGraph rejects malformed entries', () => {
  assert.throws(() => buildGraph([{ path: 'a.js' }]), TypeError);
  assert.throws(() => buildGraph('nope'), TypeError);
});

test('findCycles reports a two-node cycle once', () => {
  const graph = buildGraph([
    { path: './a.js', source: "import './b.js';" },
    { path: './b.js', source: "import './a.js';" },
  ]);
  const cycles = findCycles(graph);
  assert.equal(cycles.length, 1);
  assert.deepEqual(cycles[0], ['a.js', 'b.js', 'a.js']);
});

test('findCycles reports a three-node cycle with the smallest node first', () => {
  const graph = buildGraph([
    { path: './c.js', source: "import './a.js';" },
    { path: './a.js', source: "import './b.js';" },
    { path: './b.js', source: "import './c.js';" },
  ]);
  const cycles = findCycles(graph);
  assert.equal(cycles.length, 1);
  assert.deepEqual(cycles[0], ['a.js', 'b.js', 'c.js', 'a.js']);
});

test('findCycles returns an empty array for an acyclic graph', () => {
  const graph = buildGraph([
    { path: './a.js', source: "import './b.js';" },
    { path: './b.js', source: "import './c.js';" },
    { path: './c.js', source: '' },
  ]);
  assert.deepEqual(findCycles(graph), []);
});

test('findCycles ignores dependencies outside the provided file set', () => {
  const graph = buildGraph([
    { path: './a.js', source: "import './missing.js';" },
  ]);
  assert.deepEqual(findCycles(graph), []);
});

test('findCycles de-duplicates the same cycle reached from different starts', () => {
  const graph = buildGraph([
    { path: './a.js', source: "import './b.js';" },
    { path: './b.js', source: "import './c.js';" },
    { path: './c.js', source: "import './a.js';" },
  ]);
  const cycles = findCycles(graph);
  assert.equal(cycles.length, 1);
  assert.deepEqual(cycles[0], ['a.js', 'b.js', 'c.js', 'a.js']);
});

test('findCycles reports two independent cycles', () => {
  const graph = buildGraph([
    { path: './a.js', source: "import './b.js';" },
    { path: './b.js', source: "import './a.js';" },
    { path: './x.js', source: "import './y.js';" },
    { path: './y.js', source: "import './x.js';" },
  ]);
  const cycles = findCycles(graph);
  assert.equal(cycles.length, 2);
  assert.deepEqual(cycles[0], ['a.js', 'b.js', 'a.js']);
  assert.deepEqual(cycles[1], ['x.js', 'y.js', 'x.js']);
});

test('findCycles rejects a non-Map argument', () => {
  assert.throws(() => findCycles({}), TypeError);
});

test('formatCycle renders an arrow chain', () => {
  assert.equal(formatCycle(['a.js', 'b.js', 'a.js']), 'a.js -> b.js -> a.js');
});

test('formatCycle rejects an empty chain', () => {
  assert.throws(() => formatCycle([]), TypeError);
});
