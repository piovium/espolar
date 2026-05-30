import type { Mapping } from "@volar/source-map";
import type { AST } from "./types.ts";

export type SourceRange = [start: number, end: number];

export type MappingFactory<T = unknown> = (input: {
  node: AST.Node;
  source: string;
  sourceRange: SourceRange;
  generatedRange: SourceRange;
}) => Mapping<T>;

export interface PrinterHooks<T = unknown> {
  isUntouched?: (node: AST.Node, context: PrintContext<T>) => boolean;
  printNode?: (
    node: AST.Node,
    context: PrintContext<T>,
    next: () => string,
  ) => string;
  createMapping?: MappingFactory<T>;
  shouldMergeMappings?: (previous: Mapping<T>, next: Mapping<T>) => boolean;
};

export interface PrintOptions<T = unknown> extends PrinterHooks<T> {
  source: string;
  sourceName?: string;
  mappingData?: T;
};

export interface PrintResult<T = unknown> {
  code: string;
  mappings: Mapping<T>[];
};

export interface PrintContext<T = unknown> {
  readonly options: PrintOptions<T>;
  readonly source: string;
  readonly mappings: Mapping<T>[];
  print: (node: AST.Node | null | undefined) => string;
  printList: (nodes: readonly AST.Node[], separator?: string) => string;
  raw: (node: AST.Node) => string;
  appendMapping: (
    node: AST.Node,
    generatedStart: number,
    generatedEnd: number,
  ) => void;
};

export interface Printer<T = unknown> {
  print: (node: AST.Node) => PrintResult<T>;
};

interface InternalContext<T> extends PrintContext<T> {
  generatedOffset: number;
  enter: (node: AST.Node) => string;
  pendingMappings: PendingMapping[];
};

interface PendingMapping {
  node: AST.Node;
  sourceRange: SourceRange;
  generatedRange?: SourceRange;
};

const expressionStatementNeedsSemicolon = new Set([
  "CallExpression",
  "ChainExpression",
  "AssignmentExpression",
  "UpdateExpression",
  "AwaitExpression",
  "YieldExpression",
]);

export function createPrinter<T = unknown>(
  options: PrintOptions<T>,
): Printer<T> {
  return {
    print(node) {
      return print(node, options);
    },
  };
}

export function print<T = unknown>(
  node: AST.Node,
  options: PrintOptions<T>,
): PrintResult<T> {
  const mappings: Mapping<T>[] = [];
  const context: InternalContext<T> = {
    options,
    source: options.source,
    mappings,
    generatedOffset: 0,
    pendingMappings: [],
    print(child) {
      if (!child) {
        return "";
      }
      return context.enter(child);
    },
    printList(nodes, separator = ", ") {
      return nodes.map((child) => context.print(child)).join(separator);
    },
    raw(child) {
      return sliceSource(options.source, getRange(child));
    },
    appendMapping(child, generatedStart, generatedEnd) {
      const sourceRange = getRange(child);
      if (!sourceRange) {
        return;
      }
      context.pendingMappings.push({
        node: child,
        sourceRange,
        generatedRange: [generatedStart, generatedEnd],
      });
    },
    enter(child) {
      const start = context.generatedOffset;
      if (isUntouched(child, context)) {
        const code = context.raw(child);
        context.pendingMappings.push({
          node: child,
          sourceRange: mustGetRange(child),
        });
        return code;
      }
      const next = () => printChangedNode(child, context);
      return options.printNode?.(child, context, next) ?? next();
    },
  };

  const code = context.print(node);
  resolvePendingMappings(context, code, mappings);
  return { code, mappings };
}

function isUntouched<T>(node: AST.Node, context: PrintContext<T>): boolean {
  if (!getRange(node)) {
    return false;
  }
  return context.options.isUntouched?.(node, context) ?? true;
}

function appendMapping<T>(
  context: InternalContext<T>,
  node: AST.Node,
  sourceRange: SourceRange,
  generatedRange: SourceRange,
): void {
  const next =
    context.options.createMapping?.({
      node,
      source: context.options.sourceName ?? "",
      sourceRange,
      generatedRange,
    }) ??
    ({
      sourceOffsets: [sourceRange[0]],
      generatedOffsets: [generatedRange[0]],
      lengths: [sourceRange[1] - sourceRange[0]],
      generatedLengths:
        generatedRange[1] - generatedRange[0] ===
        sourceRange[1] - sourceRange[0]
          ? undefined
          : [generatedRange[1] - generatedRange[0]],
      data: context.options.mappingData as T,
    } satisfies Mapping<T>);

  const previous = context.mappings.at(-1);
  if (previous && shouldMergeMappings(context, previous, next)) {
    mergeMappings(previous, next);
    return;
  }
  context.mappings.push(next);
}

function resolvePendingMappings<T>(
  context: InternalContext<T>,
  code: string,
  mappings: Mapping<T>[],
): void {
  let generatedSearchStart = 0;
  for (const pending of context.pendingMappings) {
    const raw = sliceSource(context.source, pending.sourceRange);
    const generatedStart = pending.generatedRange
      ? pending.generatedRange[0]
      : code.indexOf(raw, generatedSearchStart);
    if (generatedStart < 0) {
      continue;
    }
    const generatedEnd = pending.generatedRange
      ? pending.generatedRange[1]
      : generatedStart + raw.length;
    generatedSearchStart = generatedEnd;
    appendMapping(context, pending.node, pending.sourceRange, [
      generatedStart,
      generatedEnd,
    ]);
  }
  mappings.splice(0, mappings.length, ...context.mappings);
}

function shouldMergeMappings<T>(
  context: InternalContext<T>,
  previous: Mapping<T>,
  next: Mapping<T>,
): boolean {
  if (context.options.shouldMergeMappings) {
    return context.options.shouldMergeMappings(previous, next);
  }
  if (
    previous.data !== next.data ||
    previous.sourceOffsets.length !== 1 ||
    next.sourceOffsets.length !== 1 ||
    previous.generatedOffsets.length !== 1 ||
    next.generatedOffsets.length !== 1 ||
    previous.lengths.length !== 1 ||
    next.lengths.length !== 1
  ) {
    return false;
  }
  const sourceGap =
    next.sourceOffsets[0] - (previous.sourceOffsets[0] + previous.lengths[0]);
  const previousGeneratedLength =
    previous.generatedLengths?.[0] ?? previous.lengths[0];
  const generatedGap =
    next.generatedOffsets[0] -
    (previous.generatedOffsets[0] + previousGeneratedLength);
  return sourceGap >= 0 && sourceGap === generatedGap;
}

function mergeMappings<T>(previous: Mapping<T>, next: Mapping<T>): void {
  previous.lengths[0] =
    next.sourceOffsets[0] + next.lengths[0] - previous.sourceOffsets[0];
  const nextGeneratedLength = next.generatedLengths?.[0] ?? next.lengths[0];
  const generatedLength =
    next.generatedOffsets[0] +
    nextGeneratedLength -
    previous.generatedOffsets[0];
  if (generatedLength === previous.lengths[0]) {
    delete previous.generatedLengths;
  } else {
    previous.generatedLengths = [generatedLength];
  }
}

function printChangedNode<T>(
  node: AST.Node,
  context: InternalContext<T>,
): string {
  switch (node.type) {
    case "Program":
      return printProgram(node, context);
    case "BlockStatement":
    case "StaticBlock":
      return printBlock(node, context);
    case "EmptyStatement":
      return ";";
    case "ExpressionStatement":
      return `${context.print(node.expression)}${needsSemicolon(node.expression) ? ";" : ""}`;
    case "DebuggerStatement":
      return "debugger;";
    case "ReturnStatement":
      return printKeywordArgument("return", node.argument, context, ";");
    case "ThrowStatement":
      return printKeywordArgument("throw", node.argument, context, ";");
    case "BreakStatement":
      return printLabelledJump("break", node);
    case "ContinueStatement":
      return printLabelledJump("continue", node);
    case "LabeledStatement":
      return `${context.print(node.label)}: ${context.print(node.body)}`;
    case "IfStatement":
      return printIf(node, context);
    case "SwitchStatement":
      return printSwitch(node, context);
    case "WhileStatement":
      return `while (${context.print(node.test)}) ${printStatementBody(node.body, context)}`;
    case "DoWhileStatement":
      return `do ${printStatementBody(node.body, context)} while (${context.print(node.test)});`;
    case "ForStatement":
      return printFor(node, context);
    case "ForInStatement":
      return printForInOf("for", "in", node, context);
    case "ForOfStatement":
      return printForInOf(
        node.await ? "for await" : "for",
        "of",
        node,
        context,
      );
    case "WithStatement":
      return `with (${context.print(node.object)}) ${printStatementBody(node.body, context)}`;
    case "TryStatement":
      return printTry(node, context);
    case "VariableDeclaration":
      return printVariableDeclaration(node, context, true);
    case "VariableDeclarator":
      return printVariableDeclarator(node, context);
    case "FunctionDeclaration":
    case "FunctionExpression":
      return printFunction(node, context, node.type === "FunctionDeclaration");
    case "ArrowFunctionExpression":
      return printArrowFunction(node, context);
    case "ClassDeclaration":
    case "ClassExpression":
      return printClass(node, context, node.type === "ClassDeclaration");
    case "MethodDefinition":
    case "PropertyDefinition":
    case "AccessorProperty":
      return printClassElement(node, context);
    case "ImportDeclaration":
      return printImportDeclaration(node, context);
    case "ImportSpecifier":
    case "ImportDefaultSpecifier":
    case "ImportNamespaceSpecifier":
      return printImportSpecifier(node, context);
    case "ExportNamedDeclaration":
      return printExportNamedDeclaration(node, context);
    case "ExportDefaultDeclaration":
      return `export default ${context.print(node.declaration)}${isStatementLike(node.declaration) ? "" : ";"}`;
    case "ExportAllDeclaration":
      return `export *${node.exported ? ` as ${context.print(node.exported)}` : ""} from ${context.print(node.source)};`;
    case "ExportSpecifier":
      return printAliasedName(node.local, node.exported, context);
    case "Identifier":
    case "PrivateIdentifier":
      return String(node.name);
    case "Literal":
      return printLiteral(node);
    case "TemplateElement":
      return String(
        node.value && typeof node.value === "object" && "raw" in node.value
          ? node.value.raw
          : "",
      );
    case "ThisExpression":
      return "this";
    case "Super":
      return "super";
    case "MetaProperty":
      return `${context.print(node.meta)}.${context.print(node.property)}`;
    case "ArrayExpression":
    case "ArrayPattern":
      return `[${node.elements.map((element) => (element ? context.print(element) : "")).join(", ")}]`;
    case "ObjectExpression":
    case "ObjectPattern":
      return `{ ${context.printList(node.properties)} }`;
    case "Property":
      return printProperty(node, context);
    case "RestElement":
      return `...${context.print(node.argument)}`;
    case "AssignmentPattern":
      return `${context.print(node.left)} = ${context.print(node.right)}`;
    case "MemberExpression":
      return printMemberExpression(node, context);
    case "ChainExpression":
      return context.print(node.expression);
    case "CallExpression":
    case "NewExpression":
      return printCallExpression(node, context);
    case "TaggedTemplateExpression":
      return `${context.print(node.tag)}${context.print(node.quasi)}`;
    case "TemplateLiteral":
      return printTemplateLiteral(node, context);
    case "SpreadElement":
      return `...${context.print(node.argument)}`;
    case "UnaryExpression":
      return `${wordOperator(node.operator) ? `${node.operator} ` : node.operator}${context.print(node.argument)}`;
    case "UpdateExpression":
      return node.prefix
        ? `${node.operator}${context.print(node.argument)}`
        : `${context.print(node.argument)}${node.operator}`;
    case "AwaitExpression":
      return `await ${context.print(node.argument)}`;
    case "YieldExpression":
      return `yield${node.delegate ? "*" : ""}${node.argument ? ` ${context.print(node.argument)}` : ""}`;
    case "BinaryExpression":
    case "LogicalExpression":
    case "AssignmentExpression":
      return `${context.print(node.left)} ${node.operator} ${context.print(node.right)}`;
    case "ConditionalExpression":
      return `${context.print(node.test)} ? ${context.print(node.consequent)} : ${context.print(node.alternate)}`;
    case "SequenceExpression":
      return context.printList(node.expressions);
    case "TSAsExpression":
    case "TSTypeAssertion":
      return printTypeAssertion(node, context);
    case "TSSatisfiesExpression":
      return `${context.print(node.expression)} satisfies ${context.print(node.typeAnnotation)}`;
    case "TSNonNullExpression":
      return `${context.print(node.expression)}!`;
    case "TSInstantiationExpression":
      return `${context.print(node.expression)}${printTypeParameters(node.typeArguments, context)}`;
    default:
      if (node.type.startsWith("TS")) {
        return printTypeScriptNode(
          node as Extract<AST.Node, { type: `TS${string}` }>,
          context,
        );
      }
      throw new Error(`Unsupported AST node: ${node.type}`);
  }
}

function printProgram<T>(
  node: AST.Program,
  context: InternalContext<T>,
): string {
  return node.body.map((statement) => context.print(statement)).join("\n");
}

function printBlock<T>(
  node: AST.BlockStatement | AST.StaticBlock,
  context: InternalContext<T>,
): string {
  const body = node.body;
  if (body.length === 0) {
    return "{}";
  }
  return `{\n${body.map((statement) => indent(context.print(statement))).join("\n")}\n}`;
}

function printIf<T>(
  node: AST.IfStatement,
  context: InternalContext<T>,
): string {
  let code = `if (${context.print(node.test)}) ${printStatementBody(node.consequent, context)}`;
  if (node.alternate) {
    code += ` else ${
      node.alternate && node.alternate.type === "IfStatement"
        ? context.print(node.alternate)
        : printStatementBody(node.alternate, context)
    }`;
  }
  return code;
}

function printSwitch<T>(
  node: AST.SwitchStatement,
  context: InternalContext<T>,
): string {
  const cases = node.cases;
  if (cases.length === 0) {
    return `switch (${context.print(node.discriminant)}) {}`;
  }
  const body = cases
    .map((switchCase) => {
      const label = switchCase.test
        ? `case ${context.print(switchCase.test)}:`
        : "default:";
      const consequent = switchCase.consequent
        .map((statement) => indent(context.print(statement)))
        .join("\n");
      return consequent ? `${label}\n${consequent}` : label;
    })
    .map(indent)
    .join("\n");
  return `switch (${context.print(node.discriminant)}) {\n${body}\n}`;
}

function printFor<T>(
  node: AST.ForStatement,
  context: InternalContext<T>,
): string {
  const init = node.init
    ? node.init.type === "VariableDeclaration"
      ? printVariableDeclaration(node.init, context, false)
      : context.print(node.init)
    : "";
  const test = node.test ? context.print(node.test) : "";
  const update = node.update ? context.print(node.update) : "";
  return `for (${init}; ${test}; ${update}) ${printStatementBody(node.body, context)}`;
}

function printForInOf<T>(
  prefix: string,
  operator: string,
  node: AST.ForInStatement | AST.ForOfStatement,
  context: InternalContext<T>,
): string {
  const left =
    node.left.type === "VariableDeclaration"
      ? printVariableDeclaration(node.left, context, false)
      : context.print(node.left);
  return `${prefix} (${left} ${operator} ${context.print(node.right)}) ${printStatementBody(node.body, context)}`;
}

function printTry<T>(
  node: AST.TryStatement,
  context: InternalContext<T>,
): string {
  let code = `try ${context.print(node.block)}`;
  if (node.handler) {
    const handler = node.handler;
    code += ` catch${handler.param ? ` (${context.print(handler.param)})` : ""} ${context.print(handler.body)}`;
  }
  if (node.finalizer) {
    code += ` finally ${context.print(node.finalizer)}`;
  }
  return code;
}

function printVariableDeclaration<T>(
  node: AST.VariableDeclaration,
  context: InternalContext<T>,
  statement: boolean,
): string {
  return `${node.kind ?? "let"} ${context.printList(node.declarations)}${statement ? ";" : ""}`;
}

function printVariableDeclarator<T>(
  node: AST.VariableDeclarator,
  context: InternalContext<T>,
): string {
  const id = context.print(node.id);
  const type = printOptionalTypeAnnotation(node.id, context);
  const init = node.init ? ` = ${context.print(node.init)}` : "";
  return `${id}${type}${init}`;
}

function printFunction<T>(
  node: AST.FunctionDeclaration | AST.FunctionExpression,
  context: InternalContext<T>,
  declaration: boolean,
): string {
  const prefix = node.async ? "async " : "";
  const star = node.generator ? "*" : "";
  const id = node.id ? context.print(node.id) : "";
  const params = context.printList(node.params);
  const returnType = printOptionalReturnType(node, context);
  const body = node.body ? ` ${context.print(node.body)}` : ";";
  return `${prefix}function${star}${declaration || id ? " " : ""}${id}${printTypeParameters(node.typeParameters, context)}(${params})${returnType}${body}`;
}

function printArrowFunction<T>(
  node: AST.ArrowFunctionExpression,
  context: InternalContext<T>,
): string {
  const prefix = node.async ? "async " : "";
  const params =
    node.params && node.params.length === 1
      ? context.print(node.params[0])
      : `(${context.printList(node.params)})`;
  return `${prefix}${printTypeParameters(node.typeParameters, context)}${params}${printOptionalReturnType(node, context)} => ${context.print(node.body)}`;
}

function printClass<T>(
  node: AST.ClassDeclaration | AST.ClassExpression,
  context: InternalContext<T>,
  declaration: boolean,
): string {
  const id = node.id ? context.print(node.id) : "";
  const typeParameters = printTypeParameters(node.typeParameters, context);
  const superClass = node.superClass
    ? ` extends ${context.print(node.superClass)}${printTypeParameters(node.superTypeArguments, context)}`
    : "";
  const body = node.body;
  return `class${declaration || id ? " " : ""}${id}${typeParameters}${superClass} ${context.print(body)}`;
}

function printClassElement<T>(
  node: AST.AccessorProperty | AST.MethodDefinition | AST.PropertyDefinition,
  context: InternalContext<T>,
): string {
  const prefix = [
    node.static ? "static" : "",
    "readonly" in node && node.readonly ? "readonly" : "",
    node.accessibility,
  ]
    .filter(Boolean)
    .join(" ");
  const key = node.computed
    ? `[${context.print(node.key)}]`
    : context.print(node.key);
  const value = node.value;
  const kind = "kind" in node ? node.kind : undefined;
  const head = `${prefix ? `${prefix} ` : ""}${kind === "get" || kind === "set" ? `${kind} ` : ""}${key}`;
  if (value?.type === "FunctionExpression") {
    return `${head}(${context.printList(value.params)})${printOptionalReturnType(value, context)} ${context.print(value.body)}`;
  }
  const type =
    "typeAnnotation" in node ? printOptionalTypeAnnotation(node, context) : "";
  return `${head}${type}${value ? ` = ${context.print(value)}` : ""};`;
}

function printProperty<T>(
  node: AST.Property,
  context: InternalContext<T>,
): string {
  if (node.kind === "get" || node.kind === "set") {
    return isFunctionLikeValue(node.value)
      ? `${node.kind} ${context.print(node.key)}() ${context.print(node.value.body)}`
      : `${node.kind} ${context.print(node.key)}()`;
  }
  const key = node.computed
    ? `[${context.print(node.key)}]`
    : context.print(node.key);
  const value = context.print(node.value);
  if (node.method) {
    const fn = node.value;
    return isFunctionLikeValue(fn)
      ? `${key}(${context.printList(fn.params)}) ${context.print(fn.body)}`
      : `${key}()`;
  }
  if (node.shorthand && key === value) {
    return key;
  }
  return `${key}: ${value}`;
}

function printMemberExpression<T>(
  node: AST.MemberExpression,
  context: InternalContext<T>,
): string {
  const object = context.print(node.object);
  const property = context.print(node.property);
  if (node.computed) {
    return `${object}${node.optional ? "?." : ""}[${property}]`;
  }
  return `${object}${node.optional ? "?." : "."}${property}`;
}

function printCallExpression<T>(
  node: AST.CallExpression | AST.NewExpression,
  context: InternalContext<T>,
): string {
  const callee = context.print(node.callee);
  const args = context.printList(node.arguments);
  const typeParameters = printTypeParameters(node.typeArguments, context);
  const optional = node.type === "CallExpression" && node.optional ? "?." : "";
  return `${node.type === "NewExpression" ? "new " : ""}${callee}${typeParameters}${optional}(${args})`;
}

function printTemplateLiteral<T>(
  node: AST.TemplateLiteral,
  context: InternalContext<T>,
): string {
  const quasis = node.quasis;
  const expressions = node.expressions;
  let code = "`";
  quasis.forEach((quasi, index) => {
    code += context.print(quasi);
    if (index < expressions.length) {
      code += "${" + context.print(expressions[index]) + "}";
    }
  });
  return `${code}\``;
}

function printImportDeclaration<T>(
  node: AST.ImportDeclaration,
  context: InternalContext<T>,
): string {
  const specifiers = node.specifiers;
  if (specifiers.length === 0) {
    return `import ${context.print(node.source)};`;
  }
  return `import ${context.printList(specifiers)} from ${context.print(node.source)};`;
}

function printImportSpecifier<T>(
  node:
    | AST.ImportDefaultSpecifier
    | AST.ImportNamespaceSpecifier
    | AST.ImportSpecifier,
  context: InternalContext<T>,
): string {
  if (node.type === "ImportDefaultSpecifier") {
    return context.print(node.local);
  }
  if (node.type === "ImportNamespaceSpecifier") {
    return `* as ${context.print(node.local)}`;
  }
  const imported = node.imported;
  return printAliasedName(imported, node.local, context);
}

function printExportNamedDeclaration<T>(
  node: AST.ExportNamedDeclaration,
  context: InternalContext<T>,
): string {
  if (node.declaration) {
    return `export ${context.print(node.declaration)}`;
  }
  const specifiers = context.printList(node.specifiers);
  const source = node.source ? ` from ${context.print(node.source)}` : "";
  return `export { ${specifiers} }${source};`;
}

function printAliasedName<T>(
  left: AST.Identifier | AST.StringLiteral,
  right: AST.Identifier | AST.StringLiteral,
  context: InternalContext<T>,
): string {
  const leftCode = context.print(left);
  const rightCode = context.print(right);
  return leftCode === rightCode ? leftCode : `${leftCode} as ${rightCode}`;
}

function printTypeAssertion<T>(
  node: AST.TSAsExpression | AST.TSTypeAssertion,
  context: InternalContext<T>,
): string {
  if (node.type === "TSTypeAssertion") {
    return `<${context.print(node.typeAnnotation)}>${context.print(node.expression)}`;
  }
  return `${context.print(node.expression)} as ${context.print(node.typeAnnotation)}`;
}

function printTypeScriptNode<T>(
  node: Extract<AST.Node, { type: `TS${string}` }>,
  context: InternalContext<T>,
): string {
  switch (node.type) {
    case "TSTypeAnnotation":
      return `: ${context.print(node.typeAnnotation)}`;
    case "TSTypeParameterDeclaration":
    case "TSTypeParameterInstantiation":
      return `<${context.printList(node.params)}>`;
    case "TSTypeParameter": {
      const constraint = node.constraint
        ? ` extends ${context.print(node.constraint)}`
        : "";
      const defaultType = node.default
        ? ` = ${context.print(node.default)}`
        : "";
      return `${context.print(node.name)}${constraint}${defaultType}`;
    }
    case "TSNumberKeyword":
      return "number";
    case "TSStringKeyword":
      return "string";
    case "TSBooleanKeyword":
      return "boolean";
    case "TSAnyKeyword":
      return "any";
    case "TSUnknownKeyword":
      return "unknown";
    case "TSNeverKeyword":
      return "never";
    case "TSVoidKeyword":
      return "void";
    case "TSNullKeyword":
      return "null";
    case "TSUndefinedKeyword":
      return "undefined";
    case "TSSymbolKeyword":
      return "symbol";
    case "TSObjectKeyword":
      return "object";
    case "TSIntrinsicKeyword":
      return "intrinsic";
    case "TSThisType":
      return "this";
    case "TSLiteralType":
      return context.print(node.literal);
    case "TSTypeReference":
      return `${context.print(node.typeName)}${printTypeParameters(node.typeArguments, context)}`;
    case "TSQualifiedName":
      return `${context.print(node.left)}.${context.print(node.right)}`;
    case "TSArrayType":
      return `${context.print(node.elementType)}[]`;
    case "TSTupleType":
      return `[${context.printList(node.elementTypes)}]`;
    case "TSUnionType":
      return node.types.map((type) => context.print(type)).join(" | ");
    case "TSIntersectionType":
      return node.types.map((type) => context.print(type)).join(" & ");
    case "TSFunctionType":
    case "TSConstructorType":
      return `${node.type === "TSConstructorType" ? "new " : ""}${printTypeParameters(node.typeParameters, context)}(${context.printList(node.params)}) => ${context.print(node.returnType)}`;
    case "TSTypeLiteral": {
      const members = node.members;
      return `{ ${members.map((member) => context.print(member)).join(" ")} }`;
    }
    case "TSPropertySignature":
      return `${node.readonly ? "readonly " : ""}${context.print(node.key)}${node.optional ? "?" : ""}${printOptionalTypeAnnotation(node, context)};`;
    case "TSMethodSignature":
      return `${context.print(node.key)}${node.optional ? "?" : ""}(${context.printList(node.params)})${printOptionalReturnType(node, context)};`;
    case "TSInterfaceDeclaration": {
      const typeParameters = printTypeParameters(node.typeParameters, context);
      const heritage = node.extends
        ? ` extends ${context.printList(node.extends)}`
        : "";
      return `interface ${context.print(node.id)}${typeParameters}${heritage} ${context.print(node.body)}`;
    }
    case "TSInterfaceBody":
      return `{ ${node.body.map((member) => context.print(member)).join(" ")} }`;
    case "TSTypeAliasDeclaration":
      return `type ${context.print(node.id)}${printTypeParameters(node.typeParameters, context)} = ${context.print(node.typeAnnotation)};`;
    case "TSEnumDeclaration":
      return `enum ${context.print(node.id)} { ${context.printList(node.members)} }`;
    case "TSEnumMember":
      return `${context.print(node.id)}${node.initializer ? ` = ${context.print(node.initializer)}` : ""}`;
    case "TSDeclareFunction":
      return printDeclareFunction(node, context);
    default:
      throw new Error(`Unsupported TypeScript AST node: ${node.type}`);
  }
}

function printOptionalTypeAnnotation<T>(
  node: { typeAnnotation?: AST.TSTypeAnnotation },
  context: InternalContext<T>,
): string {
  return node.typeAnnotation ? context.print(node.typeAnnotation) : "";
}

function printDeclareFunction<T>(
  node: AST.TSDeclareFunction,
  context: InternalContext<T>,
): string {
  const prefix = node.declare ? "declare " : "";
  const id = node.id ? context.print(node.id) : "";
  const params = context.printList(node.params);
  return `${prefix}function ${id}${printTypeParameters(node.typeParameters, context)}(${params})${printOptionalReturnType(node, context)};`;
}

function printOptionalReturnType<T>(
  node: { returnType?: AST.TSTypeAnnotation },
  context: InternalContext<T>,
): string {
  return node.returnType ? context.print(node.returnType) : "";
}

function printTypeParameters<T>(
  node: AST.Node | undefined,
  context: InternalContext<T>,
): string {
  return node ? context.print(node) : "";
}

function printStatementBody<T>(
  node: AST.Node,
  context: InternalContext<T>,
): string {
  return node.type === "BlockStatement"
    ? context.print(node)
    : context.print(node);
}

function printKeywordArgument<T>(
  keyword: string,
  argument: AST.Node | null | undefined,
  context: InternalContext<T>,
  suffix = "",
): string {
  return `${keyword}${argument ? ` ${context.print(argument)}` : ""}${suffix}`;
}

function printLabelledJump(keyword: string, node: AST.Statement): string {
  return `${keyword}${"label" in node && node.label ? ` ${node.label.name ?? ""}` : ""};`;
}

function printLiteral(node: AST.Literal): string {
  if (typeof node.raw === "string") {
    return node.raw;
  }
  const literal = node as AST.Literal;
  if (typeof literal.value === "string") {
    return JSON.stringify(literal.value);
  }
  if (literal.value instanceof RegExp) {
    return String(literal.value);
  }
  return String(literal.value);
}

function isFunctionLikeValue(
  node: AST.Node,
): node is AST.FunctionExpression | AST.TSEmptyBodyFunctionExpression {
  return (
    node.type === "FunctionExpression" ||
    node.type === "TSEmptyBodyFunctionExpression"
  );
}

function needsSemicolon(node: AST.BaseNode): boolean {
  return expressionStatementNeedsSemicolon.has(node.type);
}

function isStatementLike(node: AST.BaseNode): boolean {
  return node.type.endsWith("Declaration") || node.type.endsWith("Statement");
}

function wordOperator(operator: string): boolean {
  return operator === "delete" || operator === "void" || operator === "typeof";
}

function indent(code: string): string {
  return code
    .split("\n")
    .map((line) => (line ? `  ${line}` : line))
    .join("\n");
}

function getRange(node: AST.Node): SourceRange | undefined {
  if (
    Array.isArray(node.range) &&
    typeof node.range[0] === "number" &&
    typeof node.range[1] === "number"
  ) {
    return [node.range[0], node.range[1]];
  }
  if (typeof node.start === "number" && typeof node.end === "number") {
    return [node.start, node.end];
  }
  return undefined;
}

function mustGetRange(node: AST.Node): SourceRange {
  const range = getRange(node);
  if (!range) {
    throw new Error(`Expected source range for ${node.type}`);
  }
  return range;
}

function sliceSource(source: string, range: SourceRange | undefined): string {
  if (!range) {
    return "";
  }
  return source.slice(range[0], range[1]);
}
