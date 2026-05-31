# Prompts for REQUIREMENTS

Write a ESTree-compatible AST printer with support for:
1. TypeScript AST (compatible with `@typescript-eslint/parser` (or `@sveltejs/acorn-typescript`)), no need for JSX
2. The design of preserving source: If a node that has `loc`/`range` property (i.e. comes from source), we assume it was *untouched* and just print the original source. In fact, we should always preserve source (including whitespace, delimiters) and only traverse AST that was *touched*.
 - The definition of *untouched* node can be customized by user.
3. Generation of **Volar.js Mappings** (**not** Mozilla's SourceMap). Volar.js maps source to generated code **range to range**: we should take each AST Node that has `loc`/`range` property into a mappings to the printed code.
  - The mapping of *untouched* node should be 1:1; otherwise, traverse children of touched node recursively and generate mappings from each's `loc`/`range`.
  - The mapping of sibling (both source and generated) *untouched* nodes should be combined into a single range
  - Import type `Mapping` from `@volar/source-map`, no need for Volar.js' `SourceMap` class 
4. The printer should be easily customizable (user can override/extend print behavior, including how mappings are generated)
  - No need to take care of formatting (e.g. newline, indentation...) but keep eyes on ASI when copying preserved code

You should have a look on the implementation of similar projects like `esrap`, `recast` and so-on, for references.

The codebase should:
- Use `pnpm` for package management
- Use erasable-syntax-only TypeScript (Node.js 26 support directly running)
  - AST types could be referenced from `@typescript-eslint/types`
- Use `tsdown` for prepublish transpiling
- Use `vitest` for unit testing 
  - The testing input AST can be created from `acorn` and `@sveltejs/acorn-typescript`

