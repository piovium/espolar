import { Parser } from "acorn";
import { tsPlugin } from "@sveltejs/acorn-typescript";
import { describe, expect, it } from "vitest";
import { defaultCombineMappingData, print } from "../src/index.ts";
import type { AST, Comment } from "../src/types.ts";

const TsParser = Parser.extend(tsPlugin());

function parse(source: string): AST.Program {
  return TsParser.parse(source, {
    ecmaVersion: "latest",
    sourceType: "module",
    locations: true,
    ranges: true,
  }) as AST.Program;
}

describe("print", () => {
  describe("untouched preservation", () => {
    it("preserves an untouched program byte-for-byte", () => {
      const source = "const answer = 42;\n";
      const ast = parse(source);

      const result = print(ast, { source });

      expect(result.code).toBe(source);
      expect(result.mappings).toHaveLength(1);
      expect(result.mappings[0].sourceOffsets).toEqual([0]);
      expect(result.mappings[0].generatedOffsets).toEqual([0]);
      expect(result.mappings[0].lengths).toEqual([source.length]);
    });

    it("prints a touched parent while preserving untouched descendants and source gaps", () => {
      const source = "const one = 1;\n\nconst two = 2;";
      const ast = parse(source);

      const result = print(ast, {
        source,
        isUntouched: (node) => node.type !== "Program",
      });

      expect(result.code).toBe(source);
      expect(result.mappings).toHaveLength(1);
      expect(result.mappings[0].sourceOffsets).toEqual([0]);
      expect(result.mappings[0].generatedOffsets).toEqual([0]);
      expect(result.mappings[0].lengths).toEqual([source.length]);
    });

    it("supports custom untouched detection", () => {
      const source = "const untouched = 1;\nconst regenerated = 2;";
      const ast = parse(source);
      const regenerated = ast.body[1];

      const result = print(ast, {
        source,
        isUntouched: (node) =>
          node !== ast &&
          node !== regenerated &&
          node.type !== "VariableDeclarator",
      });

      expect(result.code).toBe(source);
      expect(result.mappings.map((mapping) => mapping.lengths[0])).toEqual([
        "const untouched = 1;\n".length,
        "regenerated".length,
        "2".length,
      ]);
    });

    it("preserves nodes that only expose start and end offsets", () => {
      const result = print(
        {
          type: "Identifier",
          start: 0,
          end: 6,
          name: "changed",
        } as AST.Identifier,
        {
          source: "actual",
        },
      );

      expect(result.code).toBe("actual");
      expect(result.mappings[0].sourceOffsets).toEqual([0]);
      expect(result.mappings[0].lengths).toEqual([6]);
    });

    it("prints declaration with source gap preservation", () => {
      const source = "const a = 1;\n\t  \n\nconst b = 2;\nconst c = 3;";
      const ast = parse(source);
      const result = print(ast, {
        source,
        isUntouched: (node) => node.type !== "Program",
      });
      expect(result.code).toBe(source);
    });

    it("merges adjacent mappings with non-zero source offsets", () => {
      const source = "0123456789";
      const node = {
        type: "Identifier",
        start: 2,
        end: 8,
        name: "chunk",
      } as AST.Identifier;

      const result = print(node, {
        source,
        isUntouched: () => false,
        printers: {
          Identifier: (_node, context) => {
            context.writeSource(2, 5);
            context.writeSource(5, 8);
          },
        },
      });

      expect(result.code).toBe("234567");
      expect(result.mappings).toHaveLength(1);
      expect(result.mappings[0].sourceOffsets).toEqual([2]);
      expect(result.mappings[0].generatedOffsets).toEqual([0]);
      expect(result.mappings[0].lengths).toEqual([6]);
    });

    it("supports getMappingData without combineMappingData", () => {
      const source = "const a = 1;\nconst b = 2;";
      const ast = parse(source);
      const firstDecl = ast.body[0];
      const result = print<string>(firstDecl, {
        source,
        isUntouched: (node) => node !== firstDecl,
        getMappingData: (node) => node?.type ?? "unknown",
      });
      expect(result.code).toBe("const a = 1;");
      expect(result.mappings).toHaveLength(1);
      expect(result.mappings[0].data).toBe("VariableDeclarator");
    });

    it("supports explicit combineMappingData", () => {
      const source = "const a = 1;\nconst b = 2;";
      const ast = parse(source);

      const result = print<string | null>(ast, {
        source,
        isUntouched: (node) => node.type !== "Program",
        getMappingData: (node) => node?.type || null,
        combineMappingData: (left, right) =>
          right === null ? left : `${left}+${right}`,
      });

      expect(result.mappings).toHaveLength(1);
      expect(result.mappings[0].data).toBe(
        "VariableDeclaration+VariableDeclaration",
      );
    });

    it("throws when isUntouched returns true but node has no source range", () => {
      expect(() =>
        print({ type: "Identifier", name: "x" } as AST.Identifier, {
          source: "",
          isUntouched: () => true,
        }),
      ).toThrow(
        "Node of type Identifier is marked as untouched but does not have valid source offsets",
      );
    });
  });

  describe("printer context API", () => {
    it("supports write, writeNode, writeNodeListWithSourceGaps, writeSource", () => {
      const literal = {
        type: "Literal",
        value: 1,
      } as AST.Node;
      const program = {
        type: "Program",
        body: [
          literal,
          null,
          {
            type: "Literal",
            value: 2,
          },
        ],
      } as AST.Program;

      const result = print(program, {
        source: "",
        isUntouched: () => false,
        printers: {
          Program: (_node, context) => {
            context.write("");
            context.writeNode(null);
            context.writeNodeListWithSourceGaps(program.body, "\n");
            context.writeSource(0, 0);
            context.write("|");
            context.writeNodeList([literal, null, literal], ",");
          },
        },
      });

      expect(result.code).toBe("1\n2|1,,1");
    });

    it("supports writePreservedNode", () => {
      const source = "preserve me";
      const node = {
        type: "Identifier",
        start: 0,
        end: 11,
        name: "preserve me",
      };
      const result = print(node, {
        source,
        isUntouched: () => false,
        printers: {
          Identifier: (_node, context) => {
            context.writePreservedNode(_node);
          },
        },
      });
      expect(result.code).toBe("preserve me");
    });

    it("supports writeMapped to write text with attached source mapping", () => {
      const source = "hello world";
      const node = {
        type: "Identifier",
        range: [0, 11],
        name: "hello world",
      } as AST.Identifier;

      const result = print(node, {
        source,
        isUntouched: () => false,
        printers: {
          Identifier: (_node, context) => {
            context.writeMapped("hello", 0, 5);
            context.write(" ");
            context.appendMapping(
              { start: 6, end: 11 },
              context.generatedOffset,
              context.generatedOffset + 5,
            );
            context.write("world");
          },
        },
      });

      expect(result.code).toBe("hello world");
      expect(result.mappings).toHaveLength(2);
      expect(result.mappings[0].sourceOffsets).toEqual([0]);
      expect(result.mappings[0].lengths).toEqual([5]);
      expect(result.mappings[0].generatedOffsets).toEqual([0]);
      expect(result.mappings[1].sourceOffsets).toEqual([6]);
      expect(result.mappings[1].lengths).toEqual([5]);
      expect(result.mappings[1].generatedOffsets).toEqual([6]);
    });

    it("throws when writePreservedNode has no source range", () => {
      const node = { type: "Identifier", name: "nope" } as AST.Identifier;
      const result = print(node, {
        source: "",
        isUntouched: () => false,
        printers: {
          Identifier: (_node, context) => {
            expect(() => context.writePreservedNode(_node)).toThrow(
              "Cannot preserve node Identifier without source offsets",
            );
          },
        },
      });
      expect(result.code).toBe("");
    });
  });

  describe("custom printers", () => {
    it("supports custom printers with mapping data", () => {
      const source = "const value = 1;";
      const ast = parse(source);
      const declaration = ast.body[0];

      const result = print<string | null>(declaration, {
        source,
        getMappingData: (node) => node?.type || null,
        isUntouched: (node) =>
          node !== declaration && node.type !== "VariableDeclarator",
        printers: {
          VariableDeclaration: (node, context) => {
            context.write("let ");
            context.writeNode(node.declarations[0]);
            context.write(";");
          },
        },
      });

      expect(result.code).toBe("let value = 1;");
      expect(result.mappings.map((mapping) => mapping.data)).toEqual([
        "Identifier",
        "Literal",
      ]);
    });

    it("maps left paren of CallExpression and NewExpression via experimentalGetLeftParenSourceRange", () => {
      const source = "a = foo(bar); new Baz(qux);";
      const ast = parse(source);

      const result = print<{ label: string }>(ast, {
        source,
        isUntouched: () => false,
        getMappingData: (node) => ({ label: node?.type ?? "gap" }),
        combineMappingData: (left, right) => right,
        experimentalGetLeftParenSourceRange: (node) => {
          if (node.type === "CallExpression") {
            // "a = foo(bar)" — "(" at position 7
            return { start: 7, end: 8 };
          }
          if (node.type === "NewExpression") {
            // "a = foo(bar); new Baz(qux);" — "(" at position 21
            return { start: 21, end: 22 };
          }
          return undefined;
        },
      });

      expect(result.code).toBe("a = foo(bar); new Baz(qux);");

      const callParen = result.mappings.find(
        (m) =>
          m.sourceOffsets[0] <= 7 && m.sourceOffsets[0] + m.lengths[0] >= 8,
      );
      // foo(bar
      expect(callParen).toBeDefined();
      expect(callParen!.sourceOffsets[0]).toBe(4);
      expect(callParen!.lengths[0]).toBe(7);
      expect(callParen!.data).toEqual({ label: "Identifier" });

      // Baz(qux
      const newParen = result.mappings.find(
        (m) =>
          m.sourceOffsets[0] <= 21 && m.sourceOffsets[0] + m.lengths[0] >= 22,
      );
      expect(newParen).toBeDefined();
      expect(newParen!.sourceOffsets[0]).toBe(18);
      expect(newParen!.lengths[0]).toBe(7);
      expect(newParen!.data).toEqual({ label: "Identifier" });
    });

    it("supports getMappingData for leaf node mappings", () => {
      const source = "const total = add(1, 2);";
      const ast = parse(source);

      const result = print<string | undefined>(ast, {
        source,
        isUntouched: () => false,
        getMappingData: (node) => node?.type,
        combineMappingData: (left, right) => right || left,
      });

      expect(result.code).toBe("const total = add(1, 2);");
      expect(result.mappings).toHaveLength(4);
      expect(result.mappings.map((mapping) => mapping.data)).toEqual([
        "Identifier",
        "Identifier",
        "Literal",
        "Literal",
      ]);
    });
  });

  it("throws for unsupported touched node types", () => {
    expect(() =>
      print(
        {
          type: "NotImplemented",
        },
        {
          source: "",
          isUntouched: () => false,
        },
      ),
    ).toThrow("No printer registered for node type NotImplemented");
  });

  describe("comment printing", () => {
    function makeComment(type: "Block" | "Line", value: string): Comment {
      return { type, value };
    }

    it("prints leading line comment before a touched node", () => {
      const source = "const x = 1;";
      const ast = parse(source);
      const result = print(ast, {
        source,
        isUntouched: () => false,
        getLeadingComments: (node) =>
          node.type === "Literal"
            ? [makeComment("Line", " a comment")]
            : undefined,
      });
      expect(result.code).toBe("const x = // a comment\n1;");
    });

    it("prints trailing block comment after a touched node", () => {
      const source = "const x = 1;";
      const ast = parse(source);
      const result = print(ast, {
        source,
        isUntouched: () => false,
        getTrailingComments: (node) =>
          node.type === "Literal"
            ? [makeComment("Block", " note ")]
            : undefined,
      });
      expect(result.code).toBe("const x = 1/* note */;");
    });

    it("adds newline after block comment when value contains newline", () => {
      const source = "const x = 1;";
      const ast = parse(source);
      const result = print(ast, {
        source,
        isUntouched: () => false,
        getLeadingComments: (node) =>
          node.type === "VariableDeclaration"
            ? [makeComment("Block", "*\n * multi\n * line\n ")]
            : undefined,
      });
      expect(result.code).toBe(`/**
 * multi
 * line
 */
const x = 1;`);
    });

    it("wraps return argument in parens when leading comment needs newline", () => {
      const source = "function f() { return x; }";
      const ast = parse(source);
      const result = print(ast, {
        source,
        isUntouched: () => false,
        getLeadingComments: (node) =>
          node.type === "Identifier" && node.name === "x"
            ? [makeComment("Line", " ASI-safe")]
            : undefined,
      });
      expect(result.code).toBe("function f() {\nreturn (// ASI-safe\nx);\n}");
    });

    it("wraps throw argument in parens when leading comment needs newline", () => {
      const source = "throw e;";
      const ast = parse(source);
      const result = print(ast, {
        source,
        isUntouched: () => false,
        getLeadingComments: (node) =>
          node.type === "Identifier"
            ? [makeComment("Block", "\n  multi\n")]
            : undefined,
      });
      expect(result.code).toBe("throw (/*\n  multi\n*/\ne);");
    });

    it("wraps yield argument in parens when leading comment needs newline", () => {
      const source = "function* g() { yield val; }";
      const ast = parse(source);
      const result = print(ast, {
        source,
        isUntouched: () => false,
        getLeadingComments: (node) =>
          node.type === "Identifier" && node.name === "val"
            ? [makeComment("Line", " line")]
            : undefined,
      });
      expect(result.code).toBe("function* g() {\nyield (// line\nval);\n}");
    });

    it("wraps suffix ++ operand in parens when trailing comment needs newline", () => {
      const source = "x++;";
      const ast = parse(source);
      const result = print(ast, {
        source,
        isUntouched: () => false,
        getTrailingComments: (node) =>
          node.type === "Identifier"
            ? [makeComment("Line", " trail")]
            : undefined,
      });
      expect(result.code).toBe("(x// trail\n)++;");
    });

    it("does not wrap when leading comment is single-line block comment", () => {
      const source = "function f() { return x; }";
      const ast = parse(source);
      const result = print(ast, {
        source,
        isUntouched: () => false,
        getLeadingComments: (node) =>
          node.type === "Identifier" && node.name === "x"
            ? [makeComment("Block", " ok ")]
            : undefined,
      });
      expect(result.code).toBe("function f() {\nreturn /* ok */x;\n}");
    });

    it("does not wrap suffix ++ when trailing comment is single-line block comment", () => {
      const source = "x++;";
      const ast = parse(source);
      const result = print(ast, {
        source,
        isUntouched: () => false,
        getTrailingComments: (node) =>
          node.type === "Identifier"
            ? [makeComment("Block", " ok ")]
            : undefined,
      });
      expect(result.code).toBe("x/* ok */++;");
    });

    it("prints multiple leading and trailing comments", () => {
      const source = "function f() { return x; }";
      const ast = parse(source);
      const result = print(ast, {
        source,
        isUntouched: () => false,
        getLeadingComments: (node) =>
          node.type === "Identifier" && node.name === "x"
            ? [makeComment("Line", " first"), makeComment("Block", " second ")]
            : undefined,
        getTrailingComments: (node) =>
          node.type === "Identifier" && node.name === "x"
            ? [makeComment("Line", " after")]
            : undefined,
      });
      expect(result.code).toBe(
        "function f() {\nreturn (// first\n/* second */x// after\n);\n}",
      );
    });
  });

  it("structurally prints all JavaScript syntax preserving semantics", () => {
    const source = [
      // declarations
      "var aVar;",
      "let bVar = 1;",
      "const cVar = 2;",
      "",
      // expression / empty / label
      "expr;",
      "({ foo: 1 });",
      ";",
      "outer: expr++;",
      "",
      // functions
      "function fReturn() {",
      "return;",
      "}",
      "function gReturn() {",
      "return 42;",
      "}",
      "function hThrow() {",
      "throw new Error();",
      "}",
      "function iDebug() {",
      "debugger;",
      "}",
      "",
      // meta property in function
      "function metaProp() {",
      "new.target;",
      "}",
      "",
      // loops inside a function (break/continue need loop context)
      "function loops() {",
      "outerLoop: while (true) break outerLoop;",
      "do {} while (cond);",
      "for (let i = 0; i < 10; i++) break;",
      "for (j; ; ) {}",
      "for (; ; ) continue;",
      "}",
      "",
      // control flow in a function
      "function controlFlow() {",
      "if (x) return y; else if (z) throw e; else {}",
      "}",
      "",
      // for-in / for-of at top level (var declarations work)
      "var vVar; for (vVar in obj) {}",
      "for (const kVar in obj) {}",
      "for (const item of arr) continue;",
      "",
      // switch
      "switch (val) {",
      "case 1:",
      "stmt1;",
      "break;",
      "default:",
      "stmt2;",
      "}",
      "",
      // try/catch/finally
      "try {",
      "stmt3;",
      "} catch (e) {",
      "stmt4;",
      "} finally {",
      "stmt5;",
      "}",
      "",
      // catch without param
      "try {",
      "stmt6;",
      "} catch {",
      "stmt7;",
      "}",
      "",
      // generator / async
      "function* aGen() {",
      "yield 1;",
      "yield* iterable;",
      "}",
      "",
      "async function aAsync() {",
      "await promise;",
      "for await (const item of asyncIter) {}",
      "}",
      "",
      // function expressions
      "const anonFunc = function() {};",
      "const namedFunc = function namedOne() {};",
      "",
      // arrow functions
      "const arrowSimple = () => 1;",
      "const arrowObj = () => ({ x: 1 });",
      "",
      // classes
      "class BaseClass {}",
      "class ChildClass extends BaseClass {",
      "static st = 1;",
      "#secret = 1;",
      "constructor() {",
      "super();",
      "}",
      "aMethod() {",
      "return this;",
      "}",
      "get aProp() {",
      "return 0;",
      "}",
      "set aProp(vv) {}",
      "async *genMethod() {}",
      "[computedKey]() {}",
      "static {}",
      "}",
      "",
      // class expressions
      "const clsAnon = class {};",
      "const clsNamed = class NamedExpr {};",
      "",
      // object, array, spread
      "const objLit = {",
      "val,",
      "[key]: get?.(),",
      "nested: { a: 1 },",
      "list: [first, ...rest],",
      "get gProp() {},",
      "set sProp(x) {},",
      "};",
      "const { xx, ...restX } = objLit;",
      "const [yy, ...restY] = listVar;",
      "",
      // assignment pattern
      "function withDefault(param = 1) {}",
      "",
      // template literals
      "const tmplStr = `hello ${name}`;",
      "const taggedStr = tag`hello ${name}`;",
      "",
      // binary / logical precedence
      "const pMul = 1 + 2 * 3;",
      "const pNullish = (aa ?? bb) && cc;",
      "const pExp = (aa ** bb) ** cc;",
      "const pCond = aa > bb ? cc : (dd, ee);",
      "const pAssign = (aa = bb) ? cc : dd;",
      "",
      // unary / update / typeof
      "typeof yy;",
      "!flag;",
      "zz++;",
      "--zz;",
      "",
      // new / call / optional chain
      "const newExpr = new Foo(1);",
      "new (getFoo())(1);",
      "newExpr.bar?.();",
      "chainA?.b;",
      "chainA?.[0];",
      "chainA?.();",
      "f({ x: 1 });",
      "f({} = xVar);",
      "",
      // imports (all forms, must be at top level)
      "import { impX } from 'modA';",
      "import impY from 'modB';",
      "import * as ns from 'modC';",
      "import impZ, { a as b } from 'modD';",
      "import 'modE';",
      "const dynImp = import('modF');",
      "",
      // exports
      "const localA = 1;",
      "export { localA as exportedB };",
      "export { expY } from 'modG';",
      "export default 42;",
      "export * from 'modH';",
      "export * as ns2 from 'modI';",
    ].join("\n");

    const ast = parse(source);
    const result = print(ast, {
      source,
      isUntouched: () => false,
    });

    expect(result.code).toMatchSnapshot();
  });

  it("structurally prints all TypeScript syntax preserving semantics", () => {
    const source = [
      // TS import/export variants
      "import { type impX } from 'a';",
      "import type { TT } from 'e';",
      "import type * as nsT from 'f';",
      "import X = require('g');",
      "import X2 = Y.Z;",
      "const dynImp = import('h');",
      "",
      "export type { T2 } from 'j';",
      "export type * from 'k';",
      "export * as ns2 from 'l';",
      "export default 42;",
      "export = expr;",
      "export as namespace NS;",
      "export type * as tns from 'm';",
      "",
      // type aliases
      "type Box<T> = { value: T; foo: (string | null) };",
      'type Mixed<T extends string = "x"> = string | number & boolean;',
      "type Qualified = Namespace.Name;",
      "type Tup = [string, number, ...boolean[]];",
      "type NamedTup = [label: string, value: number];",
      "type Idx = TK[K];",
      "type Cond = T extends U ? V : W;",
      "type Mapped = { [K in keyof T]: T[K] };",
      "type InferCond = T extends infer R ? R : never;",
      "type StandaloneInfer = infer R;",
      "type TypeofX = typeof xVal;",
      "type KeyofType = keyof T;",
      "type UniqueType = unique symbol;",
      "type LitType = 'hello';",
      "type TplLit = `prefix-${string}-suffix`;",
      "type ImpTpQ = import('o').X;",
      "type ImpTpP = import('p');",
      "type FT = (x: number) => string;",
      "type CT = new (x: number) => T;",
      "type FTGen = <T>(x: T) => string;",
      "type CTGen = new <T>(x: T) => string;",
      "type OptTup = [string?];",
      "type RestTup = [...number[]];",
      "type RefNoArgs = Foo;",
      "",
      // interfaces
      "interface INamed { readonly name?: string; }",
      "interface IChild extends Parent<string> { [key]?: number; }",
      "interface ISig {",
      "[index: string]: number;",
      "(x: number): string;",
      "new (x: number): ISig;",
      "}",
      "interface IMeth {",
      "m<T>(x: T): T;",
      "[method]?(): void;",
      "}",
      "interface InOutIntf<in out T> {}",
      "",
      // declare variants
      "declare interface IDI {};",
      "declare const dv: number;",
      "declare let dl: number;",
      "declare var dvar: number;",
      "declare function df(): void;",
      "declare function dg<T>(x: T): T;",
      "declare class DC {}",
      "declare enum DE2 { X }",
      "declare module 'md';",
      "declare global {",
      "var gx: number;",
      "}",
      "declare type DT = string;",
      "",
      // abstract class
      "abstract class AC {",
      "abstract method(): void;",
      "public x: number;",
      "protected readonly y: string;",
      "abstract accessor z: number;",
      "}",
      "",
      // enums
      "enum Color { Red, Green = 3 }",
      "const enum CE { A, B }",
      "",
      // namespace
      "namespace NNS {",
      "export const b = 1;",
      "}",
      "",
      // parameter property
      "class PC { constructor(public readonly x: number) {} }",
      "",
      // decorators
      "@dec class Decorated {}",
      "@dec1 @dec2 class MultiDecorated {}",
      "@dec export class ExportedDecorated {}",
      "@dec export default class DefaultExportedDecorated {}",
      "",
      // decorators on members
      "class ClassWithDec {",
      "@dec accessor x: number = 0;",
      "@dec2 y: boolean = true;",
      "}",
      "",
      // accessor property
      "class AccClass {",
      "accessor a: number = 0;",
      "accessor b: number;",
      "accessor c = 0;",
      "}",
      "",
      // type assertions / satisfies / non-null
      "const assertVal = aVal as T;",
      "const satVal = item satisfies Box<number>;",
      "const nonNull = bVal!;",
      "const combinedAs = aVal = bVal as T;",
      "",
      // typed variable with satisfies
      "const typedVal: Box<number> = val satisfies Box<number>;",
      "",
      // await / unary precedence
      "const unaryAs = !aVal as T;",
      "",
      // this / readonly param
      "function thisFunc(this: void) {}",
      "class ROClass { constructor(readonly x: number) {} }",
      "class PPClass { constructor(private readonly x: string) {} }",
      "",
      // type predicate
      "function assert(x: unknown): asserts x {}",
      "function assert2(cond: unknown): cond is string {}",
      "",
      // class implements / super type params
      "class ImplClass implements IInt {}",
      "class STClass extends BaseClass<T> {}",
      "",
      "class CWithOverride extends BaseMeth {",
      "public override [methodK]() {}",
      "protected override readonly pw = 1;",
      "}",
    ].join("\n");

    const ast = parse(source);
    const result = print(ast, {
      source,
      isUntouched: () => false,
    });

    expect(result.code).toMatchSnapshot();
  });
});

describe("createExtraMapping", () => {
  it("includes extra mappings in result without merging", () => {
    const source = "0123456789";

    const result = print(
      {
        type: "Identifier",
        start: 0,
        end: 10,
        name: "hello",
      } as AST.Identifier,
      {
        source,
        isUntouched: () => false,
        printers: {
          Identifier: (_node, context) => {
            context.writeMapped("hello", 0, 5);
            context.createExtraMapping(
              { start: 5, end: 10 },
              context.generatedOffset,
              context.generatedOffset + 5,
            );
            context.write("world");
          },
        },
      },
    );

    expect(result.code).toBe("helloworld");
    expect(result.mappings).toHaveLength(2);
    expect(result.mappings[0].sourceOffsets).toEqual([0]);
    expect(result.mappings[0].lengths).toEqual([5]);
    expect(result.mappings[1].sourceOffsets).toEqual([5]);
    expect(result.mappings[1].lengths).toEqual([5]);
  });

  it("extra mappings are not merged with regular ones even when adjacent", () => {
    const source = "0123456789";

    const result = print(
      {
        type: "Identifier",
        start: 0,
        end: 10,
        name: "hello",
      } as AST.Identifier,
      {
        source,
        isUntouched: () => false,
        printers: {
          Identifier: (_node, context) => {
            context.writeSource(0, 5);
            context.createExtraMapping(
              { start: 5, end: 10 },
              context.generatedOffset,
              context.generatedOffset + 5,
            );
            context.writeSource(5, 10);
          },
        },
      },
    );

    expect(result.mappings).toHaveLength(2);
    expect(result.mappings.map((m) => m.sourceOffsets[0])).toEqual([0, 5]);
  });

  it("extra mappings carry custom data", () => {
    const source = "hello";

    const result = print<{ label: string }>(
      {
        type: "Identifier",
        start: 0,
        end: 5,
        name: "hello",
      } as AST.Identifier,
      {
        source,
        isUntouched: () => false,
        getMappingData: () => ({ label: "" }),
        printers: {
          Identifier: (_node, context) => {
            context.write("hi");
            context.createExtraMapping(
              { start: 0, end: 5 },
              0,
              2,
              { label: "extra" },
            );
          },
        },
      },
    );

    expect(result.code).toBe("hi");
    const extra = result.mappings.find((m) => m.data?.label === "extra");
    expect(extra).toBeDefined();
    expect(extra!.sourceOffsets).toEqual([0]);
    expect(extra!.lengths).toEqual([5]);
    expect(extra!.generatedOffsets).toEqual([0]);
    expect(extra!.generatedLengths).toEqual([2]);
  });
});
