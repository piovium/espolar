import type { Mapping } from "@volar/source-map";
import type { AST } from "./types.ts";
import { createPrintContext, type PrintOptions } from "./context.ts";

export interface PrintResult<T = unknown> {
  code: string;
  mappings: Mapping<T>[];
}

export function print<T = unknown>(
  node: AST.Node,
  options: PrintOptions<T>,
): PrintResult<T> {
  const context = createPrintContext(options);
  const code = context.print(node);
  return { code, mappings: context.mappings };
}
