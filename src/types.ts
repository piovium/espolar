declare module "@typescript-eslint/types" {
  export namespace TSESTree {
    export interface NodeOrTokenData {
      start?: number;
      end?: number;
    }

    // https://github.com/sveltejs/acorn-typescript/issues/7
    // @sveltejs/acorn-typescript have slightly different AST structure
    // for TSFunctionType and TSMethodSignature. Augment them.
    interface BabelTSFunctionSignatureBase {
      typeAnnotation?: TSTypeAnnotation;
      parameters?: Parameter[];
    }
    export interface TSFunctionType extends BabelTSFunctionSignatureBase {}
    export interface TSMethodSignatureComputedName extends BabelTSFunctionSignatureBase {}
    export interface TSMethodSignatureNonComputedName extends BabelTSFunctionSignatureBase {}
  }
}

export { TSESTree as AST } from "@typescript-eslint/types";
export type { AST_NODE_TYPES } from "@typescript-eslint/types";
