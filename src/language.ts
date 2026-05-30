import type { InternalContext } from "./context.ts";
import type { AST } from "./types.ts";

export function printNode(
  node: AST.Node,
  context: InternalContext<any>,
): string {
  // TODO 
  throw new Error(`Unsupported node type: ${node.type}`);
}
