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
    export interface TSConstructorType extends BabelTSFunctionSignatureBase {}
    export interface TSCallSignatureDeclaration extends BabelTSFunctionSignatureBase {}
    export interface TSConstructSignatureDeclaration extends BabelTSFunctionSignatureBase {}
    export interface TSIndexSignature extends BabelTSFunctionSignatureBase {}
    export interface TSMethodSignatureComputedName extends BabelTSFunctionSignatureBase {}
    export interface TSMethodSignatureNonComputedName extends BabelTSFunctionSignatureBase {}

    interface BabelTSAbstractBase {
      abstract?: boolean;
      accessor?: boolean;
    }
    export interface MethodDefinitionComputedName extends BabelTSAbstractBase {}
    export interface MethodDefinitionNonComputedName extends BabelTSAbstractBase {}
    export interface PropertyDefinitionComputedName extends BabelTSAbstractBase {}
    export interface PropertyDefinitionNonComputedName extends BabelTSAbstractBase {}

    interface BabelClassBase {
      superTypeParameters?: TSTypeParameterInstantiation;
    }
    export interface ClassDeclarationWithName extends BabelClassBase {}
    export interface ClassDeclarationWithOptionalName extends BabelClassBase {}
    export interface ClassExpression extends BabelClassBase {}
  }
}

import { TSESTree as AST } from "@typescript-eslint/types";

export interface NodeLike {
  type: string;
  loc?: AST.SourceLocation | null;
  start?: number;
  end?: number;
  range?: [number, number];
}

export interface Comment {
  type: "Line" | "Block";
  value: string;
  loc?: AST.SourceLocation | null;
  start?: number;
  end?: number;
  range?: [number, number];
}

export type { AST };
export type { AST_NODE_TYPES } from "@typescript-eslint/types";
