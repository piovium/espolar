# espolar

ESTree-compatible AST printer designed for JavaScript/TypeScript language tooling.

## Features

- **Source preservation** — untouched nodes (configurable) are printed verbatim from the original source, preserving whitespace, comments, formatting, and ASI safety.
- **Volar.js mappings** — generates `Mapping<Data>[]` mapping source ranges to generated ranges, with automatic merging of adjacent mappings.
- **Full TypeScript support** — handles all `@typescript-eslint/types` AST node types (TSESTree), compatible with acorn-typescript parsed ASTs.
- **Extensible** — every aspect is customizable: untouched detection, mapping data, comments injection, printer overrides per node type.
- **Zero runtime dependencies** — keeps the library minimal, only 10 kB gzipped.

## Install

```bash
pnpm add espolar
```

Requires Node.js >= 26.

## Usage

```ts
import { print } from "espolar";
import type { PrintOptions } from "espolar";

const ast = /* parse to AST.Program with loc/range */;

const result = print(ast, {
  source: originalCode,
});

console.log(result.code);      // generated source string
console.log(result.mappings);  // Volar.js Mapping<{}>[]
```

### Custom printer

```ts
import { print } from "espolar";

const result = print(ast, {
  source,
  printers: {
    Literal(node, ctx) {
      ctx.write(`"overridden"`);
    },
  },
});
```

### Custom mapping data

```ts
import { print } from "espolar";

const result = print(ast, {
  source,
  getMappingData: (node) => (node ? [node.type] : []),
  combineMappingData: (left, right) => {
    return [...left, ...right];
  },
});
```

## API

### `print(node, options)`

Main entry point. Returns `PrintResult<Data>`.

#### `PrintOptions<Data>`

| Option                | Type                               | Description                                                                                |
| --------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------ |
| `source`              | `string`                           | The original source code (required)                                                        |
| `isUntouched`         | `(node) => boolean \| SourceRange` | Determine if a node should be preserved from source. Default: checks `range`/`start`/`end` |
| `getMappingData`      | `(node?) => Data`                  | Extract data for each mapping entry. Default: `() => ({})`                                 |
| `combineMappingData`  | `(left, right) => Data`            | Merge data when adjacent mappings are combined. Default: returns `right`                   |
| `printers`            | `Printers<Data>`                   | Override printers for specific `AST_NODE_TYPES`                                            |
| `getLeadingComments`  | `(node) => Comment[] \| undefined` | Return comments to print before a touched node                                             |
| `getTrailingComments` | `(node) => Comment[] \| undefined` | Return comments to print after a touched node                                              |

#### `PrintResult<Data>`

| Field      | Type              | Description                               |
| ---------- | ----------------- | ----------------------------------------- |
| `code`     | `string`          | The generated source code                 |
| `mappings` | `Mapping<Data>[]` | Volar.js source mappings (range-to-range) |

### `PrinterContext<Data>`

The context object passed to each printer function.

| Method/Property                                         | Description                                     |
| ------------------------------------------------------- | ----------------------------------------------- |
| `readonly source: string`                               | The original source string                      |
| `readonly generatedOffset: number`                      | Current output position                         |
| `write(text: string)`                                   | Emit text to the output                         |
| `writeNode(node)`                                       | Dispatch to a printer (preserving if untouched) |
| `writeNodeList(nodes, separator)`                       | Print a list with explicit separator            |
| `writeNodeListWithSourceGaps(nodes, fallbackSeparator)` | Print a list, copying source gaps between nodes |
| `writePreservedNode(node)`                              | Force-preserve a node from source               |
| `writeSource(start, end, data)`                         | Copy source range and add mapping               |
| `getLeadingComments(node)`                              | Query leading comments                          |
| `getTrailingComments(node)`                             | Query trailing comments                         |

### Exported helpers

| Export                      | Description                          |
| --------------------------- | ------------------------------------ |
| `defaultIsUntouched`        | Default untouched detection function |
| `defaultGetMappingData`     | Default mapping data extractor       |
| `defaultCombineMappingData` | Default mapping data combiner        |

## Architecture

The printer works in a single pass:

1. If a node is **untouched** (has source range and `isUntouched` returns truthy), its original source text is copied verbatim with a 1:1 mapping.
2. Otherwise, the node is dispatched to its registered **printer function**, which recursively calls `writeNode` on children.
3. Adjacent untouched siblings have their mappings **merged** into a single combined range.

This design preserves original formatting for unmodified code while only reconstructing the parts that changed.

## Development

```bash
pnpm install        # Install dependencies
pnpm test           # Run tests (vitest)
pnpm coverage       # Run tests with V8 coverage
pnpm typecheck      # TypeScript type checking
pnpm build          # Build via tsdown
```

Tests use `acorn` + `@sveltejs/acorn-typescript` to parse TypeScript source into AST inputs.

## License

MIT
