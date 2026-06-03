# AGENTS.md

## Commands

```bash
pnpm test          # vitest run
pnpm coverage      # vitest run --coverage (coverage thresholds enforced)
pnpm typecheck     # tsc --noEmit
pnpm build         # tsdown (outputs dist/)
```

Run `typecheck` before `build` — the composite TS project uses declaration emit.

## Architecture

Single-package library. Six source files:

| File | Role |
|---|---|
| `src/index.ts` | Public API re-exports |
| `src/types.ts` | TSESTree augmentations + shared types |
| `src/api.ts` | Public interface types |
| `src/printer.ts` | Core `print()` + context creation |
| `src/mappings.ts` | Volar.js-compatible source mappings |
| `src/printers.ts` | Default printers for all AST node types (~2270 lines) |

**Entrypoint**: `src/index.ts`, built via tsdown to `dist/`. ESM-only output.

## TypeScript quirks

- **Import extensions**: `verbatimModuleSyntax` + `allowImportingTsExtensions` means imports MUST use `.ts` extensions (not `.js`).
- **Composite project**: `tsconfig.json` for `src`/`test`, `tsconfig.node.json` for build config files.
- **Module**: `NodeNext` resolution, `ES2024` target.
- **Style**: Prefer `interface` over `type`. No explicit `as any` or `as unknown as T` should be introduced unless necessary.
- **TSESTree types**: Uses `@typescript-eslint/types` TSESTree namespace, augmented in `src/types.ts` for acorn-typescript compatibility (e.g., nodes may have `params` instead of `parameters`, `name` may be a `string` instead of an `Identifier`).

## Testing

- **Parser**: Tests use `acorn` + `@sveltejs/acorn-typescript` (NOT `@typescript-eslint/parser`). Parse options must include `locations: true, ranges: true`.
- **Snapshots**: Two large snapshot tests cover all JS and TS syntax. Run `pnpm test -- -u` to update.
- **Coverage thresholds**: branches 75%, functions 80%, lines 80%, statements 80%.

## Adding printers

When adding a new AST node type printer:
1. Add the printer function in `src/printers.ts`
2. Register it in the `defaultPrinters` object (keyed by `AST_NODE_TYPES` value)
3. The `defaultPrinters` object uses `satisfies Printers<unknown>` — missing types become compile errors

## Mappings (Volar.js)

The `canMerge` function in `src/mappings.ts` uses a strict adjacency check: adjacent source intervals are merged only when both source and generated offsets are EXACTLY contiguous (`left.sourceEnd === right.sourceStart` AND `left.generatedEnd === right.generatedStart`). Mapping data is combined via the `combineMappingData` callback.

## pnpm workspace

`pnpm-workspace.yaml` has `allowBuilds: esbuild: true` — required for dependency native builds.
