# circular-require

Scans a project's source files for static import cycles and reports the chain of dependencies involved.

```js
import { buildGraph, findCycles, formatCycle } from 'circular-require';

const files = [
  { path: './a.js', source: "import './b.js';" },
  { path: './b.js', source: "import './a.js';" },
];

const graph = buildGraph(files);
for (const cycle of findCycles(graph)) {
  console.log(formatCycle(cycle));
  // a.js -> b.js -> a.js
}
```

## Why this exists

A cycle in a module graph is easy to introduce and annoying to find by hand once a project has a few hundred files. Most tooling that reports cycles drags in a full JavaScript parser as a dependency. This library takes the opposite trade-off: it recognises only the static `import` and `export ... from` forms using a small set of regular expressions, and nothing else. That keeps it at zero dependencies and fast enough to run on every save, at the cost of missing dynamic `import()` and `require()` calls. If your project relies on those to create cycles, this tool will not see them.

The other deliberate simplification is path resolution. Dependencies are resolved against the project root you pass in, not against the importing file's directory. Input file paths are normalised by stripping a leading `./`, collapsing repeated slashes, and dropping a trailing slash. `..` segments are left as-is, so if your file list uses them you should normalise it yourself before calling `buildGraph`.

## API

- `buildGraph(files)` — takes an array of `{ path, source }` records and returns a `Map` from normalised path to normalised dependency list.
- `findCycles(graph)` — takes that `Map` and returns an array of cycles. Each cycle is a closed chain: the first node is repeated at the end, for example `['a.js', 'b.js', 'a.js']`. Cycles are canonicalised so the lexicographically smallest node comes first, and duplicates are removed, so each distinct cycle appears once.
- `formatCycle(cycle)` — renders a cycle as `a.js -> b.js -> a.js`.
- `extractSpecifiers(source)` — the regex extractor, exported for callers who want to reuse it.
- `normalisePath(path)` — the path normaliser, exported for the same reason.

## The awkward edge

Dependencies that point outside the file list you supplied are silently ignored. That is the right default for a flat input list, but it means a cycle that leaves the project and comes back through a path you did not include will not be reported. Supply every file that participates in the graph.

## Design notes

The window stores values eagerly rather than keeping running aggregates. Running
sums drift with floating point over long streams, and recomputing from a small
buffer is cheap enough that the drift is not worth the speed.

