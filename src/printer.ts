import type { Mapping } from "@volar/source-map";

export type SourceRange = [start: number, end: number];

export type AstNode = {
  type: string;
  range?: SourceRange;
  start?: number;
  end?: number;
  loc?: unknown;
  [key: string]: unknown;
};

type WritableMapping<T> = Mapping<T> & {
  sourceOffsets: number[];
  generatedOffsets: number[];
  lengths: number[];
  generatedLengths?: number[];
  data: T;
};

export type MappingFactory<T = unknown> = (input: {
  node: AstNode;
  source: string;
  sourceRange: SourceRange;
  generatedRange: SourceRange;
}) => Mapping<T>;

export type PrinterHooks<T = unknown> = {
  isUntouched?: (node: AstNode, context: PrintContext<T>) => boolean;
  printNode?: (node: AstNode, context: PrintContext<T>, next: () => string) => string;
  createMapping?: MappingFactory<T>;
  shouldMergeMappings?: (previous: Mapping<T>, next: Mapping<T>) => boolean;
};

export type PrintOptions<T = unknown> = PrinterHooks<T> & {
  source: string;
  sourceName?: string;
  mappingData?: T;
};

export type PrintResult<T = unknown> = {
  code: string;
  mappings: Mapping<T>[];
};

export type PrintContext<T = unknown> = {
  readonly options: PrintOptions<T>;
  readonly source: string;
  readonly mappings: Mapping<T>[];
  print: (node: AstNode | null | undefined) => string;
  printList: (nodes: readonly AstNode[], separator?: string) => string;
  raw: (node: AstNode) => string;
  appendMapping: (node: AstNode, generatedStart: number, generatedEnd: number) => void;
};

export type Printer<T = unknown> = {
  print: (node: AstNode) => PrintResult<T>;
};

type InternalContext<T> = PrintContext<T> & {
  generatedOffset: number;
  enter: (node: AstNode) => string;
  pendingMappings: PendingMapping<T>[];
};

type PendingMapping<T> = {
  node: AstNode;
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

export function createPrinter<T = unknown>(options: PrintOptions<T>): Printer<T> {
  return {
    print(node) {
      return print(node, options);
    },
  };
}

export function print<T = unknown>(node: AstNode, options: PrintOptions<T>): PrintResult<T> {
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
      context.pendingMappings.push({ node: child, sourceRange, generatedRange: [generatedStart, generatedEnd] });
    },
    enter(child) {
      const start = context.generatedOffset;
      if (isUntouched(child, context)) {
        const code = context.raw(child);
        context.pendingMappings.push({ node: child, sourceRange: mustGetRange(child) });
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

function isUntouched<T>(node: AstNode, context: PrintContext<T>): boolean {
  if (!getRange(node)) {
    return false;
  }
  return context.options.isUntouched?.(node, context) ?? true;
}

function appendMapping<T>(
  context: InternalContext<T>,
  node: AstNode,
  sourceRange: SourceRange,
  generatedRange: SourceRange,
): void {
  const next = context.options.createMapping?.({
    node,
    source: context.options.sourceName ?? "",
    sourceRange,
    generatedRange,
  }) ?? ({
    sourceOffsets: [sourceRange[0]],
    generatedOffsets: [generatedRange[0]],
    lengths: [sourceRange[1] - sourceRange[0]],
    generatedLengths: generatedRange[1] - generatedRange[0] === sourceRange[1] - sourceRange[0]
      ? undefined
      : [generatedRange[1] - generatedRange[0]],
    data: context.options.mappingData as T,
  } satisfies WritableMapping<T>);

  const previous = context.mappings.at(-1);
  if (previous && shouldMergeMappings(context, previous, next)) {
    mergeMappings(previous as WritableMapping<T>, next as WritableMapping<T>);
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
    appendMapping(context, pending.node, pending.sourceRange, [generatedStart, generatedEnd]);
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
    previous.data !== next.data
    || previous.sourceOffsets.length !== 1
    || next.sourceOffsets.length !== 1
    || previous.generatedOffsets.length !== 1
    || next.generatedOffsets.length !== 1
    || previous.lengths.length !== 1
    || next.lengths.length !== 1
  ) {
    return false;
  }
  const sourceGap = next.sourceOffsets[0] - (previous.sourceOffsets[0] + previous.lengths[0]);
  const previousGeneratedLength = previous.generatedLengths?.[0] ?? previous.lengths[0];
  const generatedGap = next.generatedOffsets[0] - (previous.generatedOffsets[0] + previousGeneratedLength);
  return sourceGap >= 0 && sourceGap === generatedGap;
}

function mergeMappings<T>(previous: WritableMapping<T>, next: WritableMapping<T>): void {
  previous.lengths[0] = next.sourceOffsets[0] + next.lengths[0] - previous.sourceOffsets[0];
  const nextGeneratedLength = next.generatedLengths?.[0] ?? next.lengths[0];
  const generatedLength = next.generatedOffsets[0] + nextGeneratedLength - previous.generatedOffsets[0];
  if (generatedLength === previous.lengths[0]) {
    delete previous.generatedLengths;
  } else {
    previous.generatedLengths = [generatedLength];
  }
}

function printChangedNode<T>(node: AstNode, context: InternalContext<T>): string {
  switch (node.type) {
    case "Program":
      return printProgram(node, context);
    case "BlockStatement":
    case "StaticBlock":
      return printBlock(node, context);
    case "EmptyStatement":
      return ";";
    case "ExpressionStatement":
      return `${context.print(node.expression as AstNode)}${needsSemicolon(node.expression as AstNode) ? ";" : ""}`;
    case "DebuggerStatement":
      return "debugger;";
    case "ReturnStatement":
      return printKeywordArgument("return", node.argument as AstNode | null | undefined, context, ";");
    case "ThrowStatement":
      return printKeywordArgument("throw", node.argument as AstNode | null | undefined, context, ";");
    case "BreakStatement":
      return printLabelledJump("break", node);
    case "ContinueStatement":
      return printLabelledJump("continue", node);
    case "LabeledStatement":
      return `${context.print(node.label as AstNode)}: ${context.print(node.body as AstNode)}`;
    case "IfStatement":
      return printIf(node, context);
    case "SwitchStatement":
      return printSwitch(node, context);
    case "WhileStatement":
      return `while (${context.print(node.test as AstNode)}) ${printStatementBody(node.body as AstNode, context)}`;
    case "DoWhileStatement":
      return `do ${printStatementBody(node.body as AstNode, context)} while (${context.print(node.test as AstNode)});`;
    case "ForStatement":
      return printFor(node, context);
    case "ForInStatement":
      return printForInOf("for", "in", node, context);
    case "ForOfStatement":
      return printForInOf(node.await ? "for await" : "for", "of", node, context);
    case "WithStatement":
      return `with (${context.print(node.object as AstNode)}) ${printStatementBody(node.body as AstNode, context)}`;
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
      return `export default ${context.print(node.declaration as AstNode)}${isStatementLike(node.declaration as AstNode) ? "" : ";"}`;
    case "ExportAllDeclaration":
      return `export *${node.exported ? ` as ${context.print(node.exported as AstNode)}` : ""} from ${context.print(node.source as AstNode)};`;
    case "ExportSpecifier":
      return printAliasedName(node.local as AstNode, node.exported as AstNode, context);
    case "Identifier":
    case "PrivateIdentifier":
      return String(node.name);
    case "Literal":
      return printLiteral(node);
    case "TemplateElement":
      return String(node.value && typeof node.value === "object" && "raw" in node.value ? node.value.raw : "");
    case "ThisExpression":
      return "this";
    case "Super":
      return "super";
    case "MetaProperty":
      return `${context.print(node.meta as AstNode)}.${context.print(node.property as AstNode)}`;
    case "ArrayExpression":
    case "ArrayPattern":
      return `[${(node.elements as readonly (AstNode | null)[] ?? []).map((element) => element ? context.print(element) : "").join(", ")}]`;
    case "ObjectExpression":
    case "ObjectPattern":
      return `{ ${context.printList(node.properties as readonly AstNode[] ?? [])} }`;
    case "Property":
      return printProperty(node, context);
    case "RestElement":
      return `...${context.print(node.argument as AstNode)}`;
    case "AssignmentPattern":
      return `${context.print(node.left as AstNode)} = ${context.print(node.right as AstNode)}`;
    case "MemberExpression":
      return printMemberExpression(node, context);
    case "ChainExpression":
      return context.print(node.expression as AstNode);
    case "CallExpression":
    case "NewExpression":
      return printCallExpression(node, context);
    case "TaggedTemplateExpression":
      return `${context.print(node.tag as AstNode)}${context.print(node.quasi as AstNode)}`;
    case "TemplateLiteral":
      return printTemplateLiteral(node, context);
    case "SpreadElement":
      return `...${context.print(node.argument as AstNode)}`;
    case "UnaryExpression":
      return `${wordOperator(node.operator) ? `${node.operator} ` : node.operator}${context.print(node.argument as AstNode)}`;
    case "UpdateExpression":
      return node.prefix
        ? `${node.operator}${context.print(node.argument as AstNode)}`
        : `${context.print(node.argument as AstNode)}${node.operator}`;
    case "AwaitExpression":
      return `await ${context.print(node.argument as AstNode)}`;
    case "YieldExpression":
      return `yield${node.delegate ? "*" : ""}${node.argument ? ` ${context.print(node.argument as AstNode)}` : ""}`;
    case "BinaryExpression":
    case "LogicalExpression":
    case "AssignmentExpression":
      return `${context.print(node.left as AstNode)} ${node.operator} ${context.print(node.right as AstNode)}`;
    case "ConditionalExpression":
      return `${context.print(node.test as AstNode)} ? ${context.print(node.consequent as AstNode)} : ${context.print(node.alternate as AstNode)}`;
    case "SequenceExpression":
      return context.printList(node.expressions as readonly AstNode[] ?? []);
    case "ParenthesizedExpression":
      return `(${context.print(node.expression as AstNode)})`;
    case "TSAsExpression":
    case "TSTypeAssertion":
      return printTypeAssertion(node, context);
    case "TSSatisfiesExpression":
      return `${context.print(node.expression as AstNode)} satisfies ${context.print(node.typeAnnotation as AstNode)}`;
    case "TSNonNullExpression":
      return `${context.print(node.expression as AstNode)}!`;
    case "TSInstantiationExpression":
      return `${context.print(node.expression as AstNode)}${printTypeParameters(node.typeParameters as AstNode | undefined, context)}`;
    default:
      if (node.type.startsWith("TS")) {
        return printTypeScriptNode(node, context);
      }
      throw new Error(`Unsupported AST node: ${node.type}`);
  }
}

function printProgram<T>(node: AstNode, context: InternalContext<T>): string {
  return (node.body as readonly AstNode[] ?? []).map((statement) => context.print(statement)).join("\n");
}

function printBlock<T>(node: AstNode, context: InternalContext<T>): string {
  const body = node.body as readonly AstNode[] ?? [];
  if (body.length === 0) {
    return "{}";
  }
  return `{\n${body.map((statement) => indent(context.print(statement))).join("\n")}\n}`;
}

function printIf<T>(node: AstNode, context: InternalContext<T>): string {
  let code = `if (${context.print(node.test as AstNode)}) ${printStatementBody(node.consequent as AstNode, context)}`;
  if (node.alternate) {
    code += ` else ${node.alternate && (node.alternate as AstNode).type === "IfStatement"
      ? context.print(node.alternate as AstNode)
      : printStatementBody(node.alternate as AstNode, context)}`;
  }
  return code;
}

function printSwitch<T>(node: AstNode, context: InternalContext<T>): string {
  const cases = node.cases as readonly AstNode[] ?? [];
  if (cases.length === 0) {
    return `switch (${context.print(node.discriminant as AstNode)}) {}`;
  }
  const body = cases.map((switchCase) => {
    const label = switchCase.test ? `case ${context.print(switchCase.test as AstNode)}:` : "default:";
    const consequent = (switchCase.consequent as readonly AstNode[] ?? []).map((statement) => indent(context.print(statement))).join("\n");
    return consequent ? `${label}\n${consequent}` : label;
  }).map(indent).join("\n");
  return `switch (${context.print(node.discriminant as AstNode)}) {\n${body}\n}`;
}

function printFor<T>(node: AstNode, context: InternalContext<T>): string {
  const init = node.init
    ? (node.init as AstNode).type === "VariableDeclaration"
      ? printVariableDeclaration(node.init as AstNode, context, false)
      : context.print(node.init as AstNode)
    : "";
  const test = node.test ? context.print(node.test as AstNode) : "";
  const update = node.update ? context.print(node.update as AstNode) : "";
  return `for (${init}; ${test}; ${update}) ${printStatementBody(node.body as AstNode, context)}`;
}

function printForInOf<T>(prefix: string, operator: string, node: AstNode, context: InternalContext<T>): string {
  const left = (node.left as AstNode).type === "VariableDeclaration"
    ? printVariableDeclaration(node.left as AstNode, context, false)
    : context.print(node.left as AstNode);
  return `${prefix} (${left} ${operator} ${context.print(node.right as AstNode)}) ${printStatementBody(node.body as AstNode, context)}`;
}

function printTry<T>(node: AstNode, context: InternalContext<T>): string {
  let code = `try ${context.print(node.block as AstNode)}`;
  if (node.handler) {
    const handler = node.handler as AstNode;
    code += ` catch${handler.param ? ` (${context.print(handler.param as AstNode)})` : ""} ${context.print(handler.body as AstNode)}`;
  }
  if (node.finalizer) {
    code += ` finally ${context.print(node.finalizer as AstNode)}`;
  }
  return code;
}

function printVariableDeclaration<T>(node: AstNode, context: InternalContext<T>, statement: boolean): string {
  return `${node.kind ?? "let"} ${context.printList(node.declarations as readonly AstNode[] ?? [])}${statement ? ";" : ""}`;
}

function printVariableDeclarator<T>(node: AstNode, context: InternalContext<T>): string {
  const id = context.print(node.id as AstNode);
  const type = printOptionalTypeAnnotation(node.id as AstNode, context);
  const init = node.init ? ` = ${context.print(node.init as AstNode)}` : "";
  return `${id}${type}${init}`;
}

function printFunction<T>(node: AstNode, context: InternalContext<T>, declaration: boolean): string {
  const prefix = node.async ? "async " : "";
  const star = node.generator ? "*" : "";
  const id = node.id ? context.print(node.id as AstNode) : "";
  const params = context.printList(node.params as readonly AstNode[] ?? []);
  const returnType = printOptionalReturnType(node, context);
  const body = node.body ? ` ${context.print(node.body as AstNode)}` : ";";
  return `${prefix}function${star}${declaration || id ? " " : ""}${id}${printTypeParameters(node.typeParameters as AstNode | undefined, context)}(${params})${returnType}${body}`;
}

function printArrowFunction<T>(node: AstNode, context: InternalContext<T>): string {
  const prefix = node.async ? "async " : "";
  const params = node.params && (node.params as readonly AstNode[]).length === 1
    ? context.print((node.params as readonly AstNode[])[0])
    : `(${context.printList(node.params as readonly AstNode[] ?? [])})`;
  return `${prefix}${printTypeParameters(node.typeParameters as AstNode | undefined, context)}${params}${printOptionalReturnType(node, context)} => ${context.print(node.body as AstNode)}`;
}

function printClass<T>(node: AstNode, context: InternalContext<T>, declaration: boolean): string {
  const id = node.id ? context.print(node.id as AstNode) : "";
  const typeParameters = printTypeParameters(node.typeParameters as AstNode | undefined, context);
  const superClass = node.superClass ? ` extends ${context.print(node.superClass as AstNode)}${printTypeParameters(node.superTypeParameters as AstNode | undefined, context)}` : "";
  const body = node.body as AstNode;
  return `class${declaration || id ? " " : ""}${id}${typeParameters}${superClass} ${context.print(body)}`;
}

function printClassElement<T>(node: AstNode, context: InternalContext<T>): string {
  const prefix = [
    node.static ? "static" : "",
    node.readonly ? "readonly" : "",
    node.accessibility,
  ].filter(Boolean).join(" ");
  const key = node.computed ? `[${context.print(node.key as AstNode)}]` : context.print(node.key as AstNode);
  const value = node.value as AstNode | undefined;
  const head = `${prefix ? `${prefix} ` : ""}${node.kind === "get" || node.kind === "set" ? `${node.kind} ` : ""}${key}`;
  if (value?.type === "FunctionExpression") {
    return `${head}(${context.printList(value.params as readonly AstNode[] ?? [])})${printOptionalReturnType(value, context)} ${context.print(value.body as AstNode)}`;
  }
  const type = printOptionalTypeAnnotation(node, context);
  return `${head}${type}${value ? ` = ${context.print(value)}` : ""};`;
}

function printProperty<T>(node: AstNode, context: InternalContext<T>): string {
  if (node.kind === "get" || node.kind === "set") {
    return `${node.kind} ${context.print(node.key as AstNode)}() ${context.print((node.value as AstNode).body as AstNode)}`;
  }
  const key = node.computed ? `[${context.print(node.key as AstNode)}]` : context.print(node.key as AstNode);
  const value = context.print(node.value as AstNode);
  if (node.method) {
    const fn = node.value as AstNode;
    return `${key}(${context.printList(fn.params as readonly AstNode[] ?? [])}) ${context.print(fn.body as AstNode)}`;
  }
  if (node.shorthand && key === value) {
    return key;
  }
  return `${key}: ${value}`;
}

function printMemberExpression<T>(node: AstNode, context: InternalContext<T>): string {
  const object = context.print(node.object as AstNode);
  const property = context.print(node.property as AstNode);
  if (node.computed) {
    return `${object}${node.optional ? "?." : ""}[${property}]`;
  }
  return `${object}${node.optional ? "?." : "."}${property}`;
}

function printCallExpression<T>(node: AstNode, context: InternalContext<T>): string {
  const callee = context.print(node.callee as AstNode);
  const args = context.printList(node.arguments as readonly AstNode[] ?? []);
  const typeParameters = printTypeParameters(
    (node.typeParameters ?? node.typeArguments) as AstNode | undefined,
    context,
  );
  return `${node.type === "NewExpression" ? "new " : ""}${callee}${typeParameters}${node.optional ? "?." : ""}(${args})`;
}

function printTemplateLiteral<T>(node: AstNode, context: InternalContext<T>): string {
  const quasis = node.quasis as readonly AstNode[] ?? [];
  const expressions = node.expressions as readonly AstNode[] ?? [];
  let code = "`";
  quasis.forEach((quasi, index) => {
    code += context.print(quasi);
    if (index < expressions.length) {
      code += "${" + context.print(expressions[index]) + "}";
    }
  });
  return `${code}\``;
}

function printImportDeclaration<T>(node: AstNode, context: InternalContext<T>): string {
  const specifiers = node.specifiers as readonly AstNode[] ?? [];
  if (specifiers.length === 0) {
    return `import ${context.print(node.source as AstNode)};`;
  }
  return `import ${context.printList(specifiers)} from ${context.print(node.source as AstNode)};`;
}

function printImportSpecifier<T>(node: AstNode, context: InternalContext<T>): string {
  if (node.type === "ImportDefaultSpecifier") {
    return context.print(node.local as AstNode);
  }
  if (node.type === "ImportNamespaceSpecifier") {
    return `* as ${context.print(node.local as AstNode)}`;
  }
  const imported = node.imported as AstNode;
  return printAliasedName(imported, node.local as AstNode, context);
}

function printExportNamedDeclaration<T>(node: AstNode, context: InternalContext<T>): string {
  if (node.declaration) {
    return `export ${context.print(node.declaration as AstNode)}`;
  }
  const specifiers = context.printList(node.specifiers as readonly AstNode[] ?? []);
  const source = node.source ? ` from ${context.print(node.source as AstNode)}` : "";
  return `export { ${specifiers} }${source};`;
}

function printAliasedName<T>(left: AstNode, right: AstNode, context: InternalContext<T>): string {
  const leftCode = context.print(left);
  const rightCode = context.print(right);
  return leftCode === rightCode ? leftCode : `${leftCode} as ${rightCode}`;
}

function printTypeAssertion<T>(node: AstNode, context: InternalContext<T>): string {
  if (node.type === "TSTypeAssertion") {
    return `<${context.print(node.typeAnnotation as AstNode)}>${context.print(node.expression as AstNode)}`;
  }
  return `${context.print(node.expression as AstNode)} as ${context.print(node.typeAnnotation as AstNode)}`;
}

function printTypeScriptNode<T>(node: AstNode, context: InternalContext<T>): string {
  switch (node.type) {
    case "TSTypeAnnotation":
      return `: ${context.print(node.typeAnnotation as AstNode)}`;
    case "TSTypeParameterDeclaration":
    case "TSTypeParameterInstantiation":
      return `<${context.printList(node.params as readonly AstNode[] ?? [])}>`;
    case "TSTypeParameter": {
      const constraint = node.constraint ? ` extends ${context.print(node.constraint as AstNode)}` : "";
      const defaultType = node.default ? ` = ${context.print(node.default as AstNode)}` : "";
      return `${context.print(node.name as AstNode)}${constraint}${defaultType}`;
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
      return context.print(node.literal as AstNode);
    case "TSTypeReference":
      return `${context.print(node.typeName as AstNode)}${printTypeParameters((node.typeParameters ?? node.typeArguments) as AstNode | undefined, context)}`;
    case "TSQualifiedName":
      return `${context.print(node.left as AstNode)}.${context.print(node.right as AstNode)}`;
    case "TSArrayType":
      return `${context.print(node.elementType as AstNode)}[]`;
    case "TSTupleType":
      return `[${context.printList(node.elementTypes as readonly AstNode[] ?? [])}]`;
    case "TSUnionType":
      return (node.types as readonly AstNode[] ?? []).map((type) => context.print(type)).join(" | ");
    case "TSIntersectionType":
      return (node.types as readonly AstNode[] ?? []).map((type) => context.print(type)).join(" & ");
    case "TSParenthesizedType":
      return `(${context.print(node.typeAnnotation as AstNode)})`;
    case "TSFunctionType":
    case "TSConstructorType":
      return `${node.type === "TSConstructorType" ? "new " : ""}${printTypeParameters(node.typeParameters as AstNode | undefined, context)}(${context.printList(node.params as readonly AstNode[] ?? [])}) => ${context.print(node.returnType as AstNode)}`;
    case "TSTypeLiteral": {
      const members = node.members as readonly AstNode[] ?? [];
      return `{ ${members.map((member) => context.print(member)).join(" ")} }`;
    }
    case "TSPropertySignature":
      return `${node.readonly ? "readonly " : ""}${context.print(node.key as AstNode)}${node.optional ? "?" : ""}${printOptionalTypeAnnotation(node, context)};`;
    case "TSMethodSignature":
      return `${context.print(node.key as AstNode)}${node.optional ? "?" : ""}(${context.printList(node.params as readonly AstNode[] ?? [])})${printOptionalReturnType(node, context)};`;
    case "TSInterfaceDeclaration": {
      const typeParameters = printTypeParameters(node.typeParameters as AstNode | undefined, context);
      const heritage = node.extends ? ` extends ${context.printList(node.extends as readonly AstNode[])}` : "";
      return `interface ${context.print(node.id as AstNode)}${typeParameters}${heritage} ${context.print(node.body as AstNode)}`;
    }
    case "TSInterfaceBody":
      return `{ ${(node.body as readonly AstNode[] ?? []).map((member) => context.print(member)).join(" ")} }`;
    case "TSTypeAliasDeclaration":
      return `type ${context.print(node.id as AstNode)}${printTypeParameters(node.typeParameters as AstNode | undefined, context)} = ${context.print(node.typeAnnotation as AstNode)};`;
    case "TSEnumDeclaration":
      return `enum ${context.print(node.id as AstNode)} { ${context.printList(node.members as readonly AstNode[] ?? [])} }`;
    case "TSEnumMember":
      return `${context.print(node.id as AstNode)}${node.initializer ? ` = ${context.print(node.initializer as AstNode)}` : ""}`;
    case "TSDeclareFunction":
      return `declare ${printFunction({ ...node, type: "FunctionDeclaration" }, context, true)}`;
    default:
      throw new Error(`Unsupported TypeScript AST node: ${node.type}`);
  }
}

function printOptionalTypeAnnotation<T>(node: AstNode, context: InternalContext<T>): string {
  return node.typeAnnotation ? context.print(node.typeAnnotation as AstNode) : "";
}

function printOptionalReturnType<T>(node: AstNode, context: InternalContext<T>): string {
  return node.returnType ? context.print(node.returnType as AstNode) : "";
}

function printTypeParameters<T>(node: AstNode | undefined, context: InternalContext<T>): string {
  return node ? context.print(node) : "";
}

function printStatementBody<T>(node: AstNode, context: InternalContext<T>): string {
  return node.type === "BlockStatement" ? context.print(node) : context.print(node);
}

function printKeywordArgument<T>(
  keyword: string,
  argument: AstNode | null | undefined,
  context: InternalContext<T>,
  suffix = "",
): string {
  return `${keyword}${argument ? ` ${context.print(argument)}` : ""}${suffix}`;
}

function printLabelledJump(keyword: string, node: AstNode): string {
  return `${keyword}${node.label ? ` ${(node.label as AstNode).name ?? ""}` : ""};`;
}

function printLiteral(node: AstNode): string {
  if (typeof node.raw === "string") {
    return node.raw;
  }
  if (typeof node.value === "string") {
    return JSON.stringify(node.value);
  }
  if (node.value instanceof RegExp) {
    return String(node.value);
  }
  return String(node.value);
}

function needsSemicolon(node: AstNode): boolean {
  return expressionStatementNeedsSemicolon.has(node.type);
}

function isStatementLike(node: AstNode): boolean {
  return node.type.endsWith("Declaration") || node.type.endsWith("Statement");
}

function wordOperator(operator: unknown): boolean {
  return operator === "delete" || operator === "void" || operator === "typeof";
}

function indent(code: string): string {
  return code.split("\n").map((line) => line ? `  ${line}` : line).join("\n");
}

function getRange(node: AstNode): SourceRange | undefined {
  if (Array.isArray(node.range) && typeof node.range[0] === "number" && typeof node.range[1] === "number") {
    return [node.range[0], node.range[1]];
  }
  if (typeof node.start === "number" && typeof node.end === "number") {
    return [node.start, node.end];
  }
  return undefined;
}

function mustGetRange(node: AstNode): SourceRange {
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
