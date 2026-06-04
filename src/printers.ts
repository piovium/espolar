import type { PrinterContext, Printers } from "./api.ts";
import type { AST, AST_NODE_TYPES, Comment } from "./types.ts";

const EXPRESSIONS_PRECEDENCE = {
  // LHS of =, must NOT parenthesized
  ArrayPattern: 20,
  ObjectPattern: 20,

  // PrimaryExpression
  // @ts-expect-error acorn-typescript compat
  ParenthesizedExpression: 18,
  ThisExpression: 18,
  Super: 18, // like ThisExpression
  Identifier: 18,
  PrivateIdentifier: 18, // LHS of in
  Literal: 18,
  ClassExpression: 18,
  FunctionExpression: 18,
  ObjectExpression: 18,
  ArrayExpression: 18,
  TemplateLiteral: 18,
  // https://react.github.io/jsx/
  JSXElement: 18,
  JSXFragment: 18,

  MetaProperty: 17,
  MemberExpression: 17,
  // Same precedence as MemberExpression, e.g. foo!.bar
  TSNonNullExpression: 17,
  ChainExpression: 17,
  NewExpression: 17, // only with argument list, 16 if not (we don't print this form)
  CallExpression: 17,
  TaggedTemplateExpression: 17,
  ImportExpression: 17,
  // Between MemberExpression and NewExpression w/o arguments, e.g.
  // f<T>.x // Error
  // (f<T>).x // OK
  // new f<T> // OK
  TSInstantiationExpression: 16.5,

  // postfix operators
  UpdateExpression: 15,
  // prefix operators
  UnaryExpression: 14,
  AwaitExpression: 14,
  // behaves like postfix operators (e.g. cannot be part of LHS of **)
  TSTypeAssertion: 14,

  // ranges from 13-5 depending on operator
  BinaryExpression: 13,
  // as/satisfies have same precedence as relational operators
  TSAsExpression: 9,
  TSSatisfiesExpression: 9,
  // ranges from 4-3 depending on operator
  LogicalExpression: 4,

  AssignmentExpression: 2,
  ConditionalExpression: 2,
  YieldExpression: 2,
  ArrowFunctionExpression: 2,
  SpreadElement: 2,

  SequenceExpression: 1,
} as const satisfies Partial<Record<AST.Expression["type"], number>>;

const OPERATOR_PRECEDENCE = {
  "**": 13,
  "*": 12,
  "%": 12,
  "/": 12,
  "+": 11,
  "-": 11,
  "<<": 10,
  ">>": 10,
  ">>>": 10,
  "<": 9,
  ">": 9,
  "<=": 9,
  ">=": 9,
  in: 9,
  instanceof: 9,
  "==": 8,
  "!=": 8,
  "===": 8,
  "!==": 8,
  "&": 7,
  "^": 6,
  "|": 5,
  "&&": 4,
  "??": 3,
  "||": 3,
} as const satisfies Record<
  (AST.BinaryExpression | AST.LogicalExpression)["operator"],
  number
>;

const ASSOCIATIVE: Record<number, "left" | "right"> = {
  [EXPRESSIONS_PRECEDENCE.MemberExpression]: "left",
  [EXPRESSIONS_PRECEDENCE.UpdateExpression]: "left",
  [EXPRESSIONS_PRECEDENCE.UnaryExpression]: "right",
  [OPERATOR_PRECEDENCE["**"]]: "right",
  [OPERATOR_PRECEDENCE["*"]]: "left",
  [OPERATOR_PRECEDENCE["+"]]: "left",
  [OPERATOR_PRECEDENCE["<"]]: "left",
  [OPERATOR_PRECEDENCE["==="]]: "left",
  [OPERATOR_PRECEDENCE["&"]]: "left",
  [OPERATOR_PRECEDENCE["^"]]: "left",
  [OPERATOR_PRECEDENCE["|"]]: "left",
  [OPERATOR_PRECEDENCE["&&"]]: "left",
  [OPERATOR_PRECEDENCE["||"]]: "left",
  [EXPRESSIONS_PRECEDENCE.AssignmentExpression]: "right",
};

function getPrecedence(node: AST.Expression | AST.PrivateIdentifier): number {
  if (node.type === "BinaryExpression" || node.type === "LogicalExpression") {
    return (
      OPERATOR_PRECEDENCE[node.operator] ?? EXPRESSIONS_PRECEDENCE[node.type]
    );
  }
  return EXPRESSIONS_PRECEDENCE[node.type] ?? 20;
}

type ExpressionWithPrecedence = keyof typeof EXPRESSIONS_PRECEDENCE;
type ExpressionTypeWithPrecedenceAs<T extends number> = {
  [K in AST_NODE_TYPES]: K extends ExpressionWithPrecedence
    ? (typeof EXPRESSIONS_PRECEDENCE)[K] extends T
      ? K
      : never
    : never;
}[AST_NODE_TYPES];

// Expression with same precedence as MemberExpression
type MemberLikeExpression = Extract<
  AST.Expression,
  {
    type: ExpressionTypeWithPrecedenceAs<
      typeof EXPRESSIONS_PRECEDENCE.MemberExpression
    >;
  }
>;

/**
 * Check whether the operand of a Binary/Logical/AssignmentExpression needs parentheses.
 * @param node
 * @param parent
 * @param where
 * @returns
 */
function operandOfBinaryExprNeedsParens(
  node: AST.Expression | AST.PrivateIdentifier,
  parent:
    | AST.MemberExpression
    | AST.CallExpression
    | AST.NewExpression
    | AST.TaggedTemplateExpression
    | AST.TSInstantiationExpression
    | AST.TSNonNullExpression
    | AST.TSAsExpression
    | AST.TSSatisfiesExpression
    | AST.BinaryExpression
    | AST.LogicalExpression
    | AST.AssignmentExpression
    | AST.ConditionalExpression,
  where: "left" | "right",
): boolean {
  // In a BinaryExpression where LHS have a TS postfix, e.g.:
  //   (0 as number) & 1;
  //   (0 as number) | 1;
  // If op is & or |, then LHS should be parenthesized to disambiguate;
  // otherwise, no need to parenthesize.
  if (
    where === "left" &&
    (node.type === "TSAsExpression" || node.type === "TSSatisfiesExpression") &&
    parent.type === "BinaryExpression"
  ) {
    return parent.operator === "&" || parent.operator === "|";
  }

  // LogicalExpression mixed with ?? requires parens
  if (
    node.type === "LogicalExpression" &&
    parent.type === "LogicalExpression" &&
    (parent.operator === "??") !== (node.operator === "??")
  ) {
    return true;
  }

  const precedence = getPrecedence(node);
  const parentPrecedence = getPrecedence(parent);

  if (
    parent.type === "BinaryExpression" &&
    parent.operator === "**" &&
    precedence === EXPRESSIONS_PRECEDENCE.UnaryExpression
  ) {
    // LHS of ** cannot have prefix operators, according to ES spec.
    return true;
  }

  if (precedence !== parentPrecedence) {
    return precedence < parentPrecedence;
  }

  // optional chain cannot appeared as LHS of MemberExpression-like
  if (
    precedence === EXPRESSIONS_PRECEDENCE.MemberExpression &&
    node.type === "ChainExpression"
  ) {
    return true;
  }
  if (
    parent.type === "NewExpression" &&
    !validUnparenthesizedNewOperand(node as MemberLikeExpression)
  ) {
    // new X(), X cannot contain CallExpression
    return true;
  }

  const associative = ASSOCIATIVE[precedence] ?? "left";
  return associative !== where;
}

/**
 * A valid unparenthesized `new` operand must be a member chain
 * which not contains a CallExpression
 */
function validUnparenthesizedNewOperand(node: MemberLikeExpression): boolean {
  let cur: AST.Expression = node;
  while (true) {
    if (cur.type === "CallExpression") {
      return false;
    } else if (cur.type === "TSNonNullExpression") {
      cur = cur.expression;
    } else if (cur.type === "MemberExpression") {
      cur = cur.object;
    } else if (cur.type === "TaggedTemplateExpression") {
      cur = cur.tag;
    } else if (
      cur.type === "MetaProperty" ||
      cur.type === "NewExpression" ||
      cur.type === "ImportExpression"
    ) {
      return true;
    } else {
      // The operand is either:
      // - an expression with higher precedence, no need to check further
      // - an expression with lower precedence, will be inner-parenthesized later
      // - a ChainExpression, will be inner-parenthesized later
      return cur !== node;
    }
  }
}

function operandOfUnaryExprNeedsParens(node: AST.Expression): boolean {
  return (
    EXPRESSIONS_PRECEDENCE[node.type] < EXPRESSIONS_PRECEDENCE.UnaryExpression
  );
}

export function expectAssignmentExprNeedsParen(
  node: AST.Expression | AST.SpreadElement,
): boolean {
  return (
    EXPRESSIONS_PRECEDENCE[node.type] <
    EXPRESSIONS_PRECEDENCE.AssignmentExpression
  );
}

export function expectLHSExprNeedsParen(
  node: AST.Expression | AST.SpreadElement,
): boolean {
  return (
    EXPRESSIONS_PRECEDENCE[node.type] < EXPRESSIONS_PRECEDENCE.MemberExpression
  );
}

function commentNeedsNewline(comment: Comment): boolean {
  if (comment.type === "Line") return true;
  return comment.value.includes("\n");
}

function arrowConciseBodyNeedsWrap(
  body: AST.BlockStatement | AST.Expression,
): boolean {
  if (body.type === "BlockStatement") return false;
  switch (body.type) {
    case "ObjectExpression":
      return true;
    case "AssignmentExpression":
      return body.left.type === "ObjectPattern";
    case "LogicalExpression":
      return body.left.type === "ObjectExpression";
    case "ConditionalExpression":
      return body.test.type === "ObjectExpression";
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSNonNullExpression":
      return body.expression
        ? arrowConciseBodyNeedsWrap(body.expression)
        : false;
    default:
      return false;
  }
}

// Printers
export const defaultPrinters = {
  Program: printProgram,
  Identifier: printIdentifier,
  PrivateIdentifier: printPrivateIdentifier,
  Literal: printLiteral,
  ExpressionStatement: printExpressionStatement,
  EmptyStatement: printEmptyStatement,
  VariableDeclaration: printVariableDeclaration,
  VariableDeclarator: printVariableDeclarator,
  BlockStatement: printBlockStatement,
  ReturnStatement: printReturnStatement,
  ThrowStatement: printThrowStatement,
  DebuggerStatement: printDebuggerStatement,
  BreakStatement: printBreakStatement,
  ContinueStatement: printContinueStatement,
  LabeledStatement: printLabeledStatement,
  WhileStatement: printWhileStatement,
  DoWhileStatement: printDoWhileStatement,
  IfStatement: printIfStatement,
  ForStatement: printForStatement,
  ForInStatement: printForInStatement,
  ForOfStatement: printForOfStatement,
  SwitchStatement: printSwitchStatement,
  SwitchCase: printSwitchCase,
  TryStatement: printTryStatement,
  WithStatement: printWithStatement,
  FunctionDeclaration: printFunctionDeclaration,
  FunctionExpression: printFunctionExpression,
  ArrowFunctionExpression: printArrowFunctionExpression,
  UnaryExpression: printUnaryExpression,
  UpdateExpression: printUpdateExpression,
  BinaryExpression: printBinaryExpression,
  LogicalExpression: printBinaryExpression,
  AssignmentExpression: printBinaryExpression,
  ConditionalExpression: printConditionalExpression,
  YieldExpression: printYieldExpression,
  AwaitExpression: printAwaitExpression,
  SequenceExpression: printSequenceExpression,
  CallExpression: printCallExpression,
  NewExpression: printNewExpression,
  ChainExpression: printChainExpression,
  MemberExpression: printMemberExpression,
  ObjectExpression: printObjectExpression,
  ObjectPattern: printObjectPattern,
  ArrayExpression: printArrayExpression,
  ArrayPattern: printArrayPattern,
  Property: printProperty,
  SpreadElement: printSpreadElement,
  RestElement: printRestElement,
  AssignmentPattern: printAssignmentPattern,
  TemplateLiteral: printTemplateLiteral,
  TaggedTemplateExpression: printTaggedTemplateExpression,
  ThisExpression: printThisExpression,
  Super: printSuper,
  MetaProperty: printMetaProperty,
  // @ts-expect-error acorn-typescript compat (ParenthesizedExpression is not in TSESTree types)
  ParenthesizedExpression: printParenthesizedExpression,
  ClassDeclaration: printClassDeclaration,
  ClassExpression: printClassExpression,
  ClassBody: printClassBody,
  StaticBlock: printStaticBlock,
  PropertyDefinition: printPropertyDefinition,
  AccessorProperty: printPropertyDefinition,
  MethodDefinition: printMethodDefinition,
  Decorator: printDecorator,

  ImportDeclaration: printImportDeclaration,
  ImportExpression: printImportExpression,
  ImportSpecifier: printImportSpecifier,
  ImportDefaultSpecifier: printImportDefaultSpecifier,
  ExportNamedDeclaration: printExportNamedDeclaration,
  ExportDefaultDeclaration: printExportDefaultDeclaration,
  ExportAllDeclaration: printExportAllDeclaration,
  ExportSpecifier: printExportSpecifier,

  // TypeScript
  TSAsExpression: printTSAsExpression,
  TSSatisfiesExpression: printTSSatisfiesExpression,
  TSTypeAssertion: printTSTypeAssertion,
  TSNonNullExpression: printTSNonNullExpression,
  TSTypeAnnotation: printTSTypeAnnotation,
  TSTypeAliasDeclaration: printTSTypeAliasDeclaration,
  TSInterfaceDeclaration: printTSInterfaceDeclaration,
  // TSESTree do not have this entry
  // https://github.com/sveltejs/acorn-typescript/issues/7#issuecomment-3237280163
  TSExpressionWithTypeArguments: printTSExpressionWithTypeArguments,
  TSClassImplements: printTSExpressionWithTypeArguments,
  TSInterfaceHeritage: printTSExpressionWithTypeArguments,
  TSFunctionType: printTSFunctionType,
  TSConstructorType: printTSConstructorType,
  TSMethodSignature: printTSMethodSignature,
  TSCallSignatureDeclaration: printTSCallSignatureDeclaration,
  TSConstructSignatureDeclaration: printTSConstructSignatureDeclaration,
  TSIndexSignature: printTSIndexSignature,
  TSPropertySignature: printTSPropertySignature,
  TSTypeParameterDeclaration: printTypeParameterDeclaration,
  TSTypeParameterInstantiation: printTypeParameterInstantiation,
  TSTypeParameter: printTSTypeParameter,
  TSTypeReference: printTSTypeReference,
  TSQualifiedName: printTSQualifiedName,
  TSUnionType: printJoinedTypes,
  TSIntersectionType: printJoinedTypes,
  TSArrayType: printTSArrayType,
  TSTupleType: printTSTupleType,
  TSNamedTupleMember: printTSNamedTupleMember,
  TSTypeLiteral: printTSTypeLiteral,
  TSTypeOperator: printTSTypeOperator,
  TSTypePredicate: printTSTypePredicate,
  TSTypeQuery: printTSTypeQuery,
  TSMappedType: printTSMappedType,
  TSConditionalType: printTSConditionalType,
  TSInferType: printTSInferType,
  TSIndexedAccessType: printTSIndexedAccessType,
  TSOptionalType: printTSOptionalType,
  TSRestType: printTSRestType,
  TSThisType: printTSThisType,
  TSLiteralType: printTSLiteralType,
  TSTemplateLiteralType: printTSTemplateLiteralType,
  TSImportType: printTSImportType,
  TSImportEqualsDeclaration: printTSImportEqualsDeclaration,
  TSExternalModuleReference: printTSExternalModuleReference,
  TSEnumDeclaration: printTSEnumDeclaration,
  TSEnumMember: printTSEnumMember,
  TSModuleDeclaration: printTSModuleDeclaration,
  TSModuleBlock: printTSModuleBlock,
  TSDeclareFunction: printTSDeclareFunction,
  TSParameterProperty: printTSParameterProperty,
  TSAbstractMethodDefinition: printMethodDefinition,
  TSAbstractPropertyDefinition: printPropertyDefinition,
  TSAbstractAccessorProperty: printPropertyDefinition,
  TSExportAssignment: printTSExportAssignment,
  TSNamespaceExportDeclaration: printTSNamespaceExportDeclaration,
  TSInstantiationExpression: printTSInstantiationExpression,
  TSParenthesizedType: printTSParenthesizedType,
  TSInterfaceBody: printTSInterfaceBody,
  TSStringKeyword: printKeywordType,
  TSNumberKeyword: printKeywordType,
  TSBooleanKeyword: printKeywordType,
  TSVoidKeyword: printKeywordType,
  TSUnknownKeyword: printKeywordType,
  TSAnyKeyword: printKeywordType,
  TSNeverKeyword: printKeywordType,
  TSNullKeyword: printKeywordType,
  TSUndefinedKeyword: printKeywordType,
  TSObjectKeyword: printKeywordType,
  TSSymbolKeyword: printKeywordType,
  TSBigIntKeyword: printKeywordType,
  TSIntrinsicKeyword: printKeywordType,
} satisfies Printers<unknown>;

// JS – Statements

function printProgram(program: AST.Program, context: PrinterContext): void {
  context.writeNodeListWithNewLineSep(program.body);
}

function canStartExpressionStatement(
  node: AST.Expression | AST.PrivateIdentifier,
): boolean {
  let lhs: AST.Expression | AST.PrivateIdentifier;
  switch (node.type) {
    default:
      return true;
    case "ObjectExpression":
    case "FunctionExpression":
    case "ClassExpression":
    case "ObjectPattern":
      return false;
    case "AssignmentExpression":
    case "LogicalExpression":
    case "BinaryExpression":
      lhs = node.left;
      break;
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSNonNullExpression":
      lhs = node.expression;
      break;
    case "CallExpression":
      lhs = node.callee;
      break;
    case "MemberExpression":
      lhs = node.object;
      break;
    case "TaggedTemplateExpression":
      lhs = node.tag;
      break;
    case "ConditionalExpression":
      lhs = node.test;
      break;
    case "SequenceExpression":
      return canStartExpressionStatement(node.expressions[0]);
    case "UpdateExpression":
      return canStartExpressionStatement(node.argument);
    case "ChainExpression":
      return canStartExpressionStatement(node.expression);
  }
  return (
    operandOfBinaryExprNeedsParens(lhs, node, "left") ||
    canStartExpressionStatement(lhs)
  );
}

function printExpressionStatement(
  statement: AST.ExpressionStatement,
  context: PrinterContext,
): void {
  const expr = statement.expression;
  if (!canStartExpressionStatement(expr)) {
    context.write("(");
    context.writeNode(expr);
    context.write(");");
  } else {
    context.writeNode(expr);
    context.write(";");
  }
}

function printEmptyStatement(
  _statement: AST.EmptyStatement,
  context: PrinterContext,
): void {
  context.write(";");
}

function printVariableDeclaration(
  declaration: AST.VariableDeclaration,
  context: PrinterContext,
): void {
  if (declaration.declare === true) {
    context.write("declare ");
  }
  context.write(String(declaration.kind));
  context.write(" ");
  context.writeNodeList(declaration.declarations, ", ");
  context.write(";");
}

function printVariableDeclarator(
  declarator: AST.VariableDeclarator,
  context: PrinterContext,
): void {
  context.writeNode(declarator.id);
  if (declarator.definite === true) {
    context.write("!");
  }
  if (declarator.init) {
    context.write(" = ");
    const needsParens = expectAssignmentExprNeedsParen(declarator.init);
    if (needsParens) {
      context.write("(");
      context.writeNode(declarator.init);
      context.write(")");
    } else {
      context.writeNode(declarator.init);
    }
  }
}

function printBlockStatement(
  block: AST.BlockStatement,
  context: PrinterContext,
): void {
  const body = block.body;
  context.write("{");
  if (body.length > 0) {
    context.write("\n");
    context.writeNodeListWithNewLineSep(body);
    context.write("\n");
  }
  context.write("}");
}

function printReturnStatement(
  statement: AST.ReturnStatement,
  context: PrinterContext,
): void {
  context.write("return");
  if (statement.argument) {
    context.write(" ");
    const leadingComments = context.options.getLeadingComments?.(
      statement.argument,
    );
    const needsParensASi =
      leadingComments?.some((c) => commentNeedsNewline(c)) ?? false;
    if (needsParensASi) {
      context.write("(");
    }
    context.writeNode(statement.argument);
    if (needsParensASi) {
      context.write(")");
    }
  }
  context.write(";");
}

function printThrowStatement(
  statement: AST.ThrowStatement,
  context: PrinterContext,
): void {
  context.write("throw ");
  if (statement.argument) {
    const leadingComments = context.options.getLeadingComments?.(
      statement.argument,
    );
    const needsParensASi =
      leadingComments?.some((c) => commentNeedsNewline(c)) ?? false;
    if (needsParensASi) {
      context.write("(");
    }
    context.writeNode(statement.argument);
    if (needsParensASi) {
      context.write(")");
    }
  }
  context.write(";");
}

function printDebuggerStatement(
  _statement: AST.DebuggerStatement,
  context: PrinterContext,
): void {
  context.write("debugger;");
}

function printBreakStatement(
  statement: AST.BreakStatement,
  context: PrinterContext,
): void {
  context.write("break");
  if (statement.label) {
    context.write(" ");
    context.writeNode(statement.label);
  }
  context.write(";");
}

function printContinueStatement(
  statement: AST.ContinueStatement,
  context: PrinterContext,
): void {
  context.write("continue");
  if (statement.label) {
    context.write(" ");
    context.writeNode(statement.label);
  }
  context.write(";");
}

function printLabeledStatement(
  statement: AST.LabeledStatement,
  context: PrinterContext,
): void {
  context.writeNode(statement.label);
  context.write(": ");
  context.writeNode(statement.body);
}

function printWhileStatement(
  statement: AST.WhileStatement,
  context: PrinterContext,
): void {
  context.write("while (");
  context.writeNode(statement.test);
  context.write(") ");
  context.writeNode(statement.body);
}

function printDoWhileStatement(
  statement: AST.DoWhileStatement,
  context: PrinterContext,
): void {
  context.write("do ");
  context.writeNode(statement.body);
  context.write(" while (");
  context.writeNode(statement.test);
  context.write(");");
}

function printIfStatement(
  statement: AST.IfStatement,
  context: PrinterContext,
): void {
  context.write("if (");
  context.writeNode(statement.test);
  context.write(") ");
  context.writeNode(statement.consequent);
  if (statement.alternate) {
    context.write(" else ");
    context.writeNode(statement.alternate);
  }
}

function printForStatement(
  statement: AST.ForStatement,
  context: PrinterContext,
): void {
  context.write("for (");
  if (statement.init) {
    if (statement.init.type === "VariableDeclaration") {
      printVariableDeclarationFor(statement.init, context);
    } else {
      context.writeNode(statement.init);
    }
  }
  context.write("; ");
  if (statement.test) {
    context.writeNode(statement.test);
  }
  context.write("; ");
  if (statement.update) {
    context.writeNode(statement.update);
  }
  context.write(") ");
  context.writeNode(statement.body);
}

function printForInStatement(
  statement: AST.ForInStatement,
  context: PrinterContext,
): void {
  context.write("for (");
  if (statement.left.type === "VariableDeclaration") {
    printVariableDeclarationFor(statement.left, context);
  } else {
    context.writeNode(statement.left);
  }
  context.write(" in ");
  context.writeNode(statement.right);
  context.write(") ");
  context.writeNode(statement.body);
}

function printForOfStatement(
  statement: AST.ForOfStatement,
  context: PrinterContext,
): void {
  context.write("for ");
  if (statement.await === true) {
    context.write("await ");
  }
  context.write("(");
  if (statement.left.type === "VariableDeclaration") {
    printVariableDeclarationFor(statement.left, context);
  } else {
    context.writeNode(statement.left);
  }
  context.write(" of ");
  context.writeNode(statement.right);
  context.write(") ");
  context.writeNode(statement.body);
}

function printVariableDeclarationFor(
  declaration: AST.VariableDeclaration,
  context: PrinterContext,
): void {
  context.write(String(declaration.kind));
  context.write(" ");
  context.writeNodeList(declaration.declarations, ", ");
}

function printSwitchStatement(
  statement: AST.SwitchStatement,
  context: PrinterContext,
): void {
  context.write("switch (");
  context.writeNode(statement.discriminant);
  context.write(") {");
  for (const case_ of statement.cases) {
    context.writeNode(case_);
  }
  context.write("}");
}

function printSwitchCase(case_: AST.SwitchCase, context: PrinterContext): void {
  if (case_.test) {
    context.write("\ncase ");
    context.writeNode(case_.test);
    context.write(":");
  } else {
    context.write("\ndefault:");
  }
  for (const stmt of case_.consequent) {
    context.write("\n");
    context.writeNode(stmt);
  }
}

function printTryStatement(
  statement: AST.TryStatement,
  context: PrinterContext,
): void {
  context.write("try ");
  context.writeNode(statement.block);
  if (statement.handler) {
    context.write(" catch");
    if (statement.handler.param) {
      context.write(" (");
      context.writeNode(statement.handler.param);
      context.write(") ");
    } else {
      context.write(" ");
    }
    context.writeNode(statement.handler.body);
  }
  if (statement.finalizer) {
    context.write(" finally ");
    context.writeNode(statement.finalizer);
  }
}

function printWithStatement(
  statement: AST.WithStatement,
  context: PrinterContext,
): void {
  context.write("with (");
  context.writeNode(statement.object);
  context.write(") ");
  context.writeNode(statement.body);
}

// JS – Expressions

function printIdentifier(
  identifier: AST.Identifier,
  context: PrinterContext,
): void {
  context.write(String(identifier.name));
  writeOptionalTypeAnnotation(identifier, context);
}

function printPrivateIdentifier(
  identifier: AST.PrivateIdentifier,
  context: PrinterContext,
): void {
  context.write("#");
  context.write(String(identifier.name));
}

function printLiteral(literal: AST.Literal, context: PrinterContext): void {
  if (typeof literal.raw === "string") {
    context.write(literal.raw);
    return;
  }
  const l = literal as AST.Literal;
  context.write(JSON.stringify(l.value));
}

function printUnaryExpression(
  expr: AST.UnaryExpression,
  context: PrinterContext,
): void {
  context.write(expr.operator);
  if (expr.operator.length > 1) {
    context.write(" ");
  }
  const needsParen = operandOfUnaryExprNeedsParens(expr.argument);
  if (needsParen) {
    context.write("(");
    context.writeNode(expr.argument);
    context.write(")");
  } else {
    if (
      expr.operator.length === 1 &&
      (expr.argument.type === "UnaryExpression" ||
        expr.argument.type === "UpdateExpression") &&
      expr.argument.operator.startsWith(expr.operator)
    ) {
      // `- -x` or `+ ++x` should not be printed as `--x` or `+++x`
      context.write(" ");
    }
    context.writeNode(expr.argument);
  }
}

function printUpdateExpression(
  expr: AST.UpdateExpression,
  context: PrinterContext,
): void {
  if (expr.prefix === true) {
    context.write(expr.operator);
    context.writeNode(expr.argument);
  } else {
    const trailingComments = context.options.getTrailingComments?.(
      expr.argument,
    );
    const needsParensASi =
      trailingComments?.some((c) => commentNeedsNewline(c)) ?? false;
    if (needsParensASi) {
      context.write("(");
    }
    context.writeNode(expr.argument);
    if (needsParensASi) {
      context.write(")");
    }
    context.write(expr.operator);
  }
}

function printBinaryExpression(
  expression:
    | AST.AssignmentExpression
    | AST.LogicalExpression
    | AST.BinaryExpression,
  context: PrinterContext,
): void {
  const left = expression.left;
  const right = expression.right;

  if (operandOfBinaryExprNeedsParens(left, expression, "left")) {
    context.write("(");
    context.writeNode(left);
    context.write(")");
  } else {
    context.writeNode(left);
  }

  context.write(" ");
  context.write(String(expression.operator));
  context.write(" ");

  if (operandOfBinaryExprNeedsParens(right, expression, "right")) {
    context.write("(");
    context.writeNode(right);
    context.write(")");
  } else {
    context.writeNode(right);
  }
}

function printConditionalExpression(
  expr: AST.ConditionalExpression,
  context: PrinterContext,
): void {
  if (operandOfBinaryExprNeedsParens(expr.test, expr, "left")) {
    context.write("(");
    context.writeNode(expr.test);
    context.write(")");
  } else {
    context.writeNode(expr.test);
  }
  context.write(" ? ");
  context.writeNode(expr.consequent);
  context.write(" : ");
  if (operandOfBinaryExprNeedsParens(expr.alternate, expr, "right")) {
    context.write("(");
    context.writeNode(expr.alternate);
    context.write(")");
  } else {
    context.writeNode(expr.alternate);
  }
}

function printYieldExpression(
  expr: AST.YieldExpression,
  context: PrinterContext,
): void {
  context.write(expr.delegate === true ? "yield*" : "yield");
  if (expr.argument) {
    context.write(" ");
    const leadingComments = context.options.getLeadingComments?.(expr.argument);
    const needsParensASi =
      leadingComments?.some((c) => commentNeedsNewline(c)) ?? false;
    const needsParens =
      needsParensASi || expectAssignmentExprNeedsParen(expr.argument);
    if (needsParens) {
      context.write("(");
      context.writeNode(expr.argument);
      context.write(")");
    } else {
      context.writeNode(expr.argument);
    }
  }
}

function printAwaitExpression(
  expr: AST.AwaitExpression,
  context: PrinterContext,
): void {
  context.write("await");
  if (expr.argument) {
    const needsParens = operandOfUnaryExprNeedsParens(expr.argument);
    if (needsParens) {
      context.write(" (");
      context.writeNode(expr.argument);
      context.write(")");
    } else {
      context.write(" ");
      context.writeNode(expr.argument);
    }
  }
}

function printSequenceExpression(
  expr: AST.SequenceExpression,
  context: PrinterContext,
): void {
  context.writeNodeList(expr.expressions, ", ");
}

function printCallExpression(
  expression: AST.CallExpression,
  context: PrinterContext,
): void {
  const needsParens = operandOfBinaryExprNeedsParens(
    expression.callee,
    expression,
    "left",
  );
  if (needsParens) {
    context.write("(");
    context.writeNode(expression.callee);
    context.write(")");
  } else {
    context.writeNode(expression.callee);
  }
  if (expression.typeArguments) {
    context.writeNode(expression.typeArguments);
  }
  if (expression.optional === true) {
    context.write("?.");
  }
  const parenRange =
    context.options.experimentalGetLeftParenSourceRange?.(expression);
  if (parenRange) {
    context.writeMapped("(", parenRange.start, parenRange.end);
  } else {
    context.write("(");
  }
  context.writeExpressionListWithCommaSep(expression.arguments);
  context.write(")");
}

function printNewExpression(
  expression: AST.NewExpression,
  context: PrinterContext,
): void {
  context.write("new ");
  const needsParens = operandOfBinaryExprNeedsParens(
    expression.callee,
    expression,
    "left",
  );
  if (needsParens) {
    context.write("(");
    context.writeNode(expression.callee);
    context.write(")");
  } else {
    context.writeNode(expression.callee);
  }
  if (expression.typeArguments) {
    context.writeNode(expression.typeArguments);
  }
  const parenRange =
    context.options.experimentalGetLeftParenSourceRange?.(expression);
  if (parenRange) {
    context.writeMapped("(", parenRange.start, parenRange.end);
  } else {
    context.write("(");
  }
  context.writeExpressionListWithCommaSep(expression.arguments);
  context.write(")");
}

function printChainExpression(
  expression: AST.ChainExpression,
  context: PrinterContext,
): void {
  context.writeNode(expression.expression);
}

function printMemberExpression(
  expression: AST.MemberExpression,
  context: PrinterContext,
): void {
  const needsParens = operandOfBinaryExprNeedsParens(
    expression.object,
    expression,
    "left",
  );
  if (needsParens) {
    context.write("(");
    context.writeNode(expression.object);
    context.write(")");
  } else {
    context.writeNode(expression.object);
  }
  if (expression.computed === true) {
    context.write(expression.optional === true ? "?.[" : "[");
    context.writeNode(expression.property);
    context.write("]");
  } else {
    context.write(expression.optional === true ? "?." : ".");
    context.writeNode(expression.property);
  }
}

function printObjectExpression(
  object: AST.ObjectExpression,
  context: PrinterContext,
): void {
  context.write("{ ");
  context.writeNodeList(object.properties, ", ");
  context.write(" }");
}

function printObjectPattern(
  pattern: AST.ObjectPattern,
  context: PrinterContext,
): void {
  context.write("{ ");
  context.writeNodeList(pattern.properties, ", ");
  context.write(" }");
  writeOptionalTypeAnnotation(pattern, context);
}

function printArrayExpression(
  array: AST.ArrayExpression,
  context: PrinterContext,
): void {
  context.write("[");
  context.writeExpressionListWithCommaSep(array.elements);
  context.write("]");
}

function printArrayPattern(
  pattern: AST.ArrayPattern,
  context: PrinterContext,
): void {
  context.write("[");
  context.writeNodeList(pattern.elements, ", ");
  context.write("]");
  writeOptionalTypeAnnotation(pattern, context);
}

function printProperty(
  property: AST.Property | AST.PropertyDefinition,
  context: PrinterContext,
): void {
  if (property.type === "Property") {
    const value = property.value;
    const valNode = value.type === "AssignmentPattern" ? value.left : value;

    const shorthand =
      !property.computed &&
      property.kind === "init" &&
      property.key.type === "Identifier" &&
      valNode.type === "Identifier" &&
      property.key.name === valNode.name;

    if (shorthand) {
      context.writeNode(value);
      return;
    }

    // shorthand method
    if (
      value.type === "FunctionExpression" &&
      (property.method || property.kind !== "init")
    ) {
      if (property.kind !== "init") {
        context.write(property.kind + " ");
      }
      if (value.async === true) {
        context.write("async ");
      }
      if (value.generator === true) {
        context.write("*");
      }
      if (property.computed === true) {
        context.write("[");
        context.writeNode(property.key);
        context.write("]");
      } else {
        context.writeNode(property.key);
      }
      context.write("(");
      context.writeNodeList(value.params, ", ");
      context.write(")");
      writeReturnType(value, context);
      context.write(" ");
      context.writeNode(value.body!);
      return;
    }

    if (property.computed === true) {
      context.write("[");
      context.writeNode(property.key);
      context.write("]: ");
    } else {
      context.writeNode(property.key);
      context.write(": ");
    }
    context.writeNode(property.value);
  }
}

function printSpreadElement(
  spread: AST.SpreadElement,
  context: PrinterContext,
): void {
  context.write("...");
  const needsParens = expectAssignmentExprNeedsParen(spread.argument);
  if (needsParens) {
    context.write("(");
    context.writeNode(spread.argument);
    context.write(")");
  } else {
    context.writeNode(spread.argument);
  }
}

function printRestElement(
  rest: AST.RestElement,
  context: PrinterContext,
): void {
  context.write("...");
  context.writeNode(rest.argument);
  writeOptionalTypeAnnotation(rest, context);
}

function printAssignmentPattern(
  pattern: AST.AssignmentPattern,
  context: PrinterContext,
): void {
  context.writeNode(pattern.left);
  context.write(" = ");
  context.writeNode(pattern.right);
}

function printTemplateLiteral(
  node: AST.TemplateLiteral,
  context: PrinterContext,
): void {
  context.write("`");
  const { quasis, expressions } = node;
  for (let i = 0; i < expressions.length; i++) {
    context.write(quasis[i].value.raw);
    context.write("${");
    context.writeNode(expressions[i]);
    context.write("}");
  }
  context.write(quasis[quasis.length - 1].value.raw);
  context.write("`");
}

function printTaggedTemplateExpression(
  node: AST.TaggedTemplateExpression,
  context: PrinterContext,
): void {
  const needsParens = operandOfBinaryExprNeedsParens(node.tag, node, "left");
  if (needsParens) {
    context.write("(");
    context.writeNode(node.tag);
    context.write(")");
  } else {
    context.writeNode(node.tag);
  }
  if (node.typeArguments) {
    context.writeNode(node.typeArguments);
  }
  context.writeNode(node.quasi);
}

function printThisExpression(
  _node: AST.ThisExpression,
  context: PrinterContext,
): void {
  context.write("this");
}

function printSuper(_node: AST.Super, context: PrinterContext): void {
  context.write("super");
}

function printMetaProperty(
  node: AST.MetaProperty,
  context: PrinterContext,
): void {
  context.writeNode(node.meta);
  context.write(".");
  context.writeNode(node.property);
}

function printParenthesizedExpression(
  node: { expression: AST.Node },
  context: PrinterContext,
): void {
  context.write("(");
  context.writeNode(node.expression);
  context.write(")");
}

// JS – Functions / Classes

function printFunctionDeclaration(
  node: AST.FunctionDeclaration,
  context: PrinterContext,
): void {
  printFunction(node, context);
}

function printFunctionExpression(
  node: AST.FunctionExpression,
  context: PrinterContext,
): void {
  printFunction(node, context);
}

function printFunction(
  fn: AST.FunctionDeclaration | AST.FunctionExpression,
  context: PrinterContext,
): void {
  if (fn.async === true) {
    context.write("async ");
  }
  context.write("function");
  if (fn.generator === true) {
    context.write("*");
  }
  if (fn.id) {
    context.write(" ");
    context.writeNode(fn.id);
  }
  if (fn.typeParameters) {
    context.writeNode(fn.typeParameters);
  }
  context.write("(");
  context.writeNodeList(fn.params, ", ");
  context.write(")");
  writeReturnType(fn, context);
  if (fn.body) {
    context.write(" ");
    context.writeNode(fn.body);
  }
}

function printArrowFunctionExpression(
  fn: AST.ArrowFunctionExpression,
  context: PrinterContext,
): void {
  if (fn.async === true) {
    context.write("async ");
  }
  if (fn.typeParameters) {
    context.writeNode(fn.typeParameters);
  }
  context.write("(");
  context.writeNodeList(fn.params, ", ");
  context.write(")");
  writeReturnType(fn, context);
  context.write(" => ");
  const body = fn.body;
  if (arrowConciseBodyNeedsWrap(body)) {
    context.write("(");
    context.writeNode(body);
    context.write(")");
  } else {
    context.writeNode(body);
  }
}

function printClassDeclaration(
  node: AST.ClassDeclaration,
  context: PrinterContext,
): void {
  printClass(node, context);
}

function printClassExpression(
  node: AST.ClassExpression,
  context: PrinterContext,
): void {
  printClass(node, context);
}

function printClass(
  node: AST.ClassDeclaration | AST.ClassExpression,
  context: PrinterContext,
): void {
  if (node.decorators) {
    for (const d of node.decorators) {
      context.writeNode(d);
    }
  }
  if (node.declare === true) {
    context.write("declare ");
  }
  if (node.abstract === true) {
    context.write("abstract ");
  }
  context.write("class ");
  if (node.id) {
    context.writeNode(node.id);
    context.write(" ");
  }
  if (node.superClass) {
    context.write("extends ");
    const needsParens = expectLHSExprNeedsParen(node.superClass);
    if (needsParens) {
      context.write("(");
      context.writeNode(node.superClass);
      context.write(")");
    } else {
      context.writeNode(node.superClass);
    }
    if (node.superTypeArguments) {
      context.writeNode(node.superTypeArguments);
    } else if (node.superTypeParameters) {
      context.writeNode(node.superTypeParameters);
    }
  }
  if (node.implements && node.implements.length > 0) {
    context.write(" implements ");
    context.writeNodeList(node.implements, ", ");
  }
  if (node.superClass || (node.implements && node.implements.length > 0)) {
    context.write(" ");
  }
  context.writeNode(node.body);
}

function printClassBody(node: AST.ClassBody, context: PrinterContext): void {
  context.write("{");
  const body = node.body;
  if (body.length > 0) {
    context.write("\n");
    context.writeNodeListWithNewLineSep(body);
    context.write("\n");
  }
  context.write("}");
}

function printStaticBlock(
  node: AST.StaticBlock,
  context: PrinterContext,
): void {
  context.write("static {");
  const body = node.body;
  if (body.length > 0) {
    context.write("\n");
    context.writeNodeListWithNewLineSep(body);
    context.write("\n");
  }
  context.write("}");
}

function validUnparenthesizedDecorator(node: AST.Expression): boolean {
  let current: AST.Expression = node;
  if (current.type === "CallExpression") {
    current = current.callee;
  }
  if (current.type === "TSInstantiationExpression") {
    current = current.expression;
  }
  while (true) {
    if (current.type === "Identifier") {
      return true;
    } else if (current.type === "MemberExpression") {
      if (current.computed) {
        return false;
      }
      current = current.object;
    } else {
      return false;
    }
  }
}

function printDecorator(node: AST.Decorator, context: PrinterContext): void {
  context.write("@");
  if (!validUnparenthesizedDecorator(node.expression)) {
    context.write("(");
    context.writeNode(node.expression);
    context.write(")");
  } else {
    context.writeNode(node.expression);
  }
  context.write("\n");
}

function printPropertyDefinition(
  node:
    | AST.PropertyDefinition
    | AST.AccessorProperty
    | AST.TSAbstractAccessorProperty
    | AST.TSAbstractPropertyDefinition,
  context: PrinterContext,
): void {
  if (node.decorators) {
    for (const d of node.decorators) {
      context.writeNode(d);
    }
  }
  if (
    node.type === "TSAbstractPropertyDefinition" ||
    ("abstract" in node && node.abstract === true)
  ) {
    context.write("abstract ");
  }
  if (node.accessibility) {
    context.write(node.accessibility + " ");
  }
  if (node.static === true) {
    context.write("static ");
  }
  if (node.override === true) {
    context.write("override ");
  }
  if (node.readonly === true) {
    context.write("readonly ");
  }
  if (
    node.type === "AccessorProperty" ||
    node.type === "TSAbstractAccessorProperty" ||
    ("accessor" in node && node.accessor === true)
  ) {
    context.write("accessor ");
  }
  if (node.computed === true) {
    context.write("[");
    context.writeNode(node.key);
    context.write("]");
  } else {
    context.writeNode(node.key);
  }
  if (node.typeAnnotation) {
    if ("accessor" in node && node.accessor === true) {
      context.writeNode(node.typeAnnotation);
    } else {
      context.write(": ");
      context.writeNode(node.typeAnnotation.typeAnnotation);
    }
  }
  if (node.value) {
    context.write(" = ");
    context.writeNode(node.value);
  }
  context.write(";");
}

function printMethodDefinition(
  node: AST.MethodDefinition | AST.TSAbstractMethodDefinition,
  context: PrinterContext,
): void {
  const def = node;
  if (def.decorators) {
    for (const d of def.decorators) {
      context.writeNode(d);
    }
  }
  if (def.accessibility) {
    context.write(def.accessibility + " ");
  }
  if (def.static === true) {
    context.write("static ");
  }
  if (def.override === true) {
    context.write("override ");
  }
  if (
    node.type === "TSAbstractMethodDefinition" ||
    ("abstract" in def && def.abstract === true)
  ) {
    context.write("abstract ");
  }
  if (def.kind === "get" || def.kind === "set") {
    context.write(def.kind + " ");
  }
  if (def.value.async === true) {
    context.write("async ");
  }
  if (def.value.generator === true) {
    context.write("*");
  }
  if (def.computed === true) {
    context.write("[");
    context.writeNode(def.key);
    context.write("]");
  } else {
    context.writeNode(def.key);
  }
  context.write("(");
  context.writeNodeList(def.value.params, ", ");
  context.write(")");
  writeReturnType(def.value, context);
  if (def.value.body) {
    context.write(" ");
    context.writeNode(def.value.body);
  } else {
    context.write(";");
  }
}

// JS – Imports / Exports

function printImportDeclaration(
  node: AST.ImportDeclaration,
  context: PrinterContext,
): void {
  context.write("import ");
  if (node.importKind === "type") {
    context.write("type ");
  }

  const specifiers = node.specifiers;
  if (specifiers.length === 0) {
    context.writeNode(node.source);
    context.write(";");
    return;
  }

  let wroteDefault = false;

  for (const s of specifiers) {
    if (s.type === "ImportDefaultSpecifier") {
      context.writeNode(s);
      wroteDefault = true;
    }
  }

  let namespaceSpec: AST.ImportNamespaceSpecifier | undefined;
  const namedSpecs: AST.ImportSpecifier[] = [];

  for (const s of specifiers) {
    if (s.type === "ImportNamespaceSpecifier") {
      namespaceSpec = s;
    } else if (s.type === "ImportSpecifier") {
      namedSpecs.push(s);
    }
  }

  if (namespaceSpec) {
    if (wroteDefault) {
      context.write(", ");
    }
    context.write("* as ");
    context.writeNode(namespaceSpec.local);
  }

  if (namedSpecs.length > 0) {
    if (wroteDefault || namespaceSpec) {
      context.write(", ");
    }
    context.write("{ ");
    context.writeNodeList(namedSpecs, ", ");
    context.write(" }");
  }

  context.write(" from ");
  context.writeNode(node.source);

  if (node.attributes && node.attributes.length > 0) {
    context.write(" with { ");
    context.writeNodeList(node.attributes, ", ");
    context.write(" }");
  }
  context.write(";");
}

function printImportExpression(
  node: AST.ImportExpression,
  context: PrinterContext,
): void {
  context.write("import(");
  context.writeNode(node.source);
  if (node.options) {
    context.write(", ");
    context.writeNode(node.options);
  }
  context.write(")");
}

function printImportDefaultSpecifier(
  node: AST.ImportDefaultSpecifier,
  context: PrinterContext,
): void {
  context.writeNode(node.local);
}

function printImportSpecifier(
  node: AST.ImportSpecifier,
  context: PrinterContext,
): void {
  if (node.importKind === "type") {
    context.write("type ");
  }
  if (
    node.local.type === "Identifier" &&
    node.imported.type === "Identifier" &&
    node.local.name !== node.imported.name
  ) {
    context.writeNode(node.imported);
    context.write(" as ");
  }
  context.writeNode(node.local);
}

function printExportNamedDeclaration(
  node: AST.ExportNamedDeclaration,
  context: PrinterContext,
): void {
  if (node.declaration) {
    let decl = node.declaration;
    if ("decorators" in decl && decl.decorators && decl.decorators.length > 0) {
      const { decorators, ...rest } = decl;
      for (const d of decorators) {
        context.writeNode(d);
      }
      decl = rest as typeof decl;
    }
    context.write("export ");
    if (node.exportKind === "type") {
      context.write("type ");
    }
    context.writeNode(decl);
    if (
      decl.type !== "FunctionDeclaration" &&
      decl.type !== "ClassDeclaration" &&
      decl.type !== "VariableDeclaration" &&
      decl.type !== "TSModuleDeclaration" &&
      decl.type !== "TSEnumDeclaration" &&
      decl.type !== "TSTypeAliasDeclaration" &&
      decl.type !== "TSInterfaceDeclaration" &&
      decl.type !== "TSDeclareFunction"
    ) {
      context.write(";");
    }
    return;
  }

  context.write("export ");
  if (node.exportKind === "type") {
    context.write("type ");
  }
  context.write("{ ");
  context.writeNodeList(node.specifiers, ", ");
  context.write(" }");

  if (node.source) {
    context.write(" from ");
    context.writeNode(node.source);
  }
  context.write(";");
}

function printExportDefaultDeclaration(
  node: AST.ExportDefaultDeclaration,
  context: PrinterContext,
): void {
  let decl = node.declaration;
  if ("decorators" in decl && decl.decorators && decl.decorators.length > 0) {
    const { decorators, ...rest } = decl;
    for (const d of decorators) {
      context.writeNode(d);
    }
    decl = rest as typeof decl;
  }
  context.write("export default ");
  context.writeNode(decl);
  if (
    decl.type !== "FunctionDeclaration" &&
    decl.type !== "ClassDeclaration" &&
    decl.type !== "ClassExpression"
  ) {
    context.write(";");
  }
}

function printExportAllDeclaration(
  node: AST.ExportAllDeclaration,
  context: PrinterContext,
): void {
  context.write(node.exportKind === "type" ? "export type * " : "export * ");
  if (node.exported) {
    context.write("as ");
    context.writeNode(node.exported);
    context.write(" ");
  }
  context.write("from ");
  context.writeNode(node.source);
  context.write(";");
}

function printExportSpecifier(
  node: AST.ExportSpecifier,
  context: PrinterContext,
): void {
  if (node.exportKind === "type") {
    context.write("type ");
  }
  context.writeNode(node.local);
  if (
    node.local.type === "Identifier" &&
    node.exported.type === "Identifier" &&
    node.local.name !== node.exported.name
  ) {
    context.write(" as ");
    context.writeNode(node.exported);
  }
}

// TS – Expressions

function printTSAsExpression(
  expression: AST.TSAsExpression,
  context: PrinterContext,
): void {
  const needsParens = operandOfBinaryExprNeedsParens(
    expression.expression,
    expression,
    "left",
  );
  if (needsParens) {
    context.write("(");
    context.writeNode(expression.expression);
    context.write(")");
  } else {
    context.writeNode(expression.expression);
  }
  context.write(" as ");
  context.writeNode(expression.typeAnnotation);
}

function printTSSatisfiesExpression(
  expression: AST.TSSatisfiesExpression,
  context: PrinterContext,
): void {
  const needsParens = operandOfBinaryExprNeedsParens(
    expression.expression,
    expression,
    "left",
  );
  if (needsParens) {
    context.write("(");
    context.writeNode(expression.expression);
    context.write(")");
  } else {
    context.writeNode(expression.expression);
  }
  context.write(" satisfies ");
  context.writeNode(expression.typeAnnotation);
}

function printTSTypeAssertion(
  expression: AST.TSTypeAssertion,
  context: PrinterContext,
): void {
  context.write("<");
  context.writeNode(expression.typeAnnotation);
  context.write(">");
  const needsParens = operandOfUnaryExprNeedsParens(expression.expression);
  if (needsParens) {
    context.write("(");
    context.writeNode(expression.expression);
    context.write(")");
  } else {
    context.writeNode(expression.expression);
  }
}

function printTSNonNullExpression(
  expression: AST.TSNonNullExpression,
  context: PrinterContext,
): void {
  const needsParens = operandOfBinaryExprNeedsParens(
    expression.expression,
    expression,
    "left",
  );
  if (needsParens) {
    context.write("(");
    context.writeNode(expression.expression);
    context.write(")");
  } else {
    context.writeNode(expression.expression);
  }
  context.write("!");
}

function printTSTypeAnnotation(
  annotation: AST.TSTypeAnnotation,
  context: PrinterContext,
): void {
  context.write(": ");
  context.writeNode(annotation.typeAnnotation);
}

function printTSTypeAliasDeclaration(
  alias: AST.TSTypeAliasDeclaration,
  context: PrinterContext,
): void {
  if (alias.declare === true) {
    context.write("declare ");
  }
  context.write("type ");
  context.writeNode(alias.id);
  if (alias.typeParameters) {
    context.writeNode(alias.typeParameters);
  }
  context.write(" = ");
  context.writeNode(alias.typeAnnotation);
  context.write(";");
}

function printTSInterfaceDeclaration(
  node: AST.TSInterfaceDeclaration,
  context: PrinterContext,
): void {
  const declaration = node;
  if (declaration.declare === true) {
    context.write("declare ");
  }
  context.write("interface ");
  context.writeNode(declaration.id);
  if (declaration.typeParameters) {
    context.writeNode(declaration.typeParameters);
  }
  const heritage = declaration.extends ?? [];
  if (heritage.length > 0) {
    context.write(" extends ");
    context.writeNodeList(heritage, ", ");
  }
  context.write(" ");
  context.writeNode(declaration.body);
}

function printTSExpressionWithTypeArguments(
  node: {
    expression: AST.Node;
    typeArguments?: AST.Node;
    typeParameters?: AST.Node;
  },
  context: PrinterContext,
): void {
  context.writeNode(node.expression);
  if (node.typeArguments) {
    context.writeNode(node.typeArguments);
  }
  if (node.typeParameters) {
    context.writeNode(node.typeParameters);
  }
}

function printTSInterfaceBody(
  body: AST.TSInterfaceBody,
  context: PrinterContext,
): void {
  context.write("{");
  const members = body.body;
  if (members.length > 0) {
    context.write(" ");
    context.writeNodeList(members, " ");
    context.write(" ");
  }
  context.write("}");
}

function printTSPropertySignature(
  signature: AST.TSPropertySignature,
  context: PrinterContext,
): void {
  if (signature.readonly === true) {
    context.write("readonly ");
  }
  if (signature.computed === true) {
    context.write("[");
    context.writeNode(signature.key);
    context.write("]");
  } else {
    context.writeNode(signature.key);
  }
  if (signature.optional === true) {
    context.write("?");
  }
  if (signature.typeAnnotation) {
    context.writeNode(signature.typeAnnotation);
  }
  context.write(";");
}

function printTypeParameterDeclaration(
  declaration: AST.TSTypeParameterDeclaration,
  context: PrinterContext,
): void {
  context.write("<");
  context.writeNodeList(declaration.params, ", ");
  context.write(">");
}

function printTypeParameterInstantiation(
  instantiation: AST.TSTypeParameterInstantiation,
  context: PrinterContext,
): void {
  context.write("<");
  context.writeNodeList(instantiation.params, ", ");
  context.write(">");
}

function printTSTypeParameter(
  parameter: AST.TSTypeParameter,
  context: PrinterContext,
): void {
  if (parameter.const === true) {
    context.write("const ");
  }
  if (parameter.in === true) {
    context.write("in ");
  }
  if (parameter.out === true) {
    context.write("out ");
  }
  // https://github.com/sveltejs/acorn-typescript/issues/7
  // parameter.name might be a string instead of an Identifier node
  if (typeof parameter.name === "string") {
    context.write(parameter.name);
  } else {
    context.writeNode(parameter.name);
  }
  if (parameter.constraint) {
    context.write(" extends ");
    context.writeNode(parameter.constraint);
  }
  if (parameter.default) {
    context.write(" = ");
    context.writeNode(parameter.default);
  }
}

function printTSFunctionType(
  type: AST.TSFunctionType,
  context: PrinterContext,
): void {
  if (type.typeParameters) {
    context.writeNode(type.typeParameters);
  }
  context.write("(");
  if (type.params) {
    context.writeNodeList(type.params, ", ");
  } else if (type.parameters) {
    context.writeNodeList(type.parameters, ", ");
  }
  context.write(")");
  context.write(" => ");
  writeReturnType(type, context, { tsArrowType: true });
}

function printTSConstructorType(
  type: AST.TSConstructorType,
  context: PrinterContext,
): void {
  context.write("new ");
  if (type.typeParameters) {
    context.writeNode(type.typeParameters);
  }
  context.write("(");
  if (type.params) {
    context.writeNodeList(type.params, ", ");
  } else if (type.parameters) {
    context.writeNodeList(type.parameters, ", ");
  }
  context.write(")");
  context.write(" => ");
  writeReturnType(type, context, { tsArrowType: true });
}

function printTSMethodSignature(
  signature: AST.TSMethodSignature,
  context: PrinterContext,
): void {
  if (signature.readonly === true) {
    context.write("readonly ");
  }
  if (signature.computed === true) {
    context.write("[");
    context.writeNode(signature.key);
    context.write("]");
  } else {
    context.writeNode(signature.key);
  }
  if (signature.optional === true) {
    context.write("?");
  }
  if (signature.typeParameters) {
    context.writeNode(signature.typeParameters);
  }
  context.write("(");
  if (signature.params) {
    context.writeNodeList(signature.params, ", ");
  } else if (signature.parameters) {
    context.writeNodeList(signature.parameters, ", ");
  }
  context.write(")");
  writeReturnType(signature, context);
  context.write(";");
}

function printTSCallSignatureDeclaration(
  signature: AST.TSCallSignatureDeclaration,
  context: PrinterContext,
): void {
  if (signature.typeParameters) {
    context.writeNode(signature.typeParameters);
  }
  context.write("(");
  if (signature.params) {
    context.writeNodeList(signature.params, ", ");
  } else if (signature.parameters) {
    context.writeNodeList(signature.parameters, ", ");
  }
  context.write(")");
  writeReturnType(signature, context);
  context.write(";");
}

function printTSConstructSignatureDeclaration(
  signature: AST.TSConstructSignatureDeclaration,
  context: PrinterContext,
): void {
  context.write("new ");
  if (signature.typeParameters) {
    context.writeNode(signature.typeParameters);
  }
  context.write("(");
  if (signature.params) {
    context.writeNodeList(signature.params, ", ");
  } else if (signature.parameters) {
    context.writeNodeList(signature.parameters, ", ");
  }
  context.write(")");
  writeReturnType(signature, context);
  context.write(";");
}

function printTSIndexSignature(
  signature: AST.TSIndexSignature,
  context: PrinterContext,
): void {
  context.write("[");
  if (signature.parameters) {
    context.writeNodeList(signature.parameters, ", ");
  }
  context.write("]");
  writeReturnType(signature, context);
  context.write(";");
}

function writeReturnType(
  node: {
    returnType?: AST.TSTypeAnnotation | null;
    typeAnnotation?: AST.TSTypeAnnotation | null;
  },
  context: PrinterContext,
  options?: { tsArrowType: true },
): void {
  let ret: AST.Node | null | undefined = node.returnType ?? node.typeAnnotation;
  if (options?.tsArrowType) {
    // TSFunctionType / TSConstructorType use `=>` syntax:
    // must unwrap the TSTypeAnnotation to get the raw type node
    ret = ret?.typeAnnotation;
  }
  if (ret) {
    context.writeNode(ret);
  }
}

function printTSTypeReference(
  reference: AST.TSTypeReference,
  context: PrinterContext,
): void {
  context.writeNode(reference.typeName);
  if (reference.typeArguments) {
    context.writeNode(reference.typeArguments);
  }
}

function printTSQualifiedName(
  name: AST.TSQualifiedName,
  context: PrinterContext,
): void {
  context.writeNode(name.left);
  context.write(".");
  context.writeNode(name.right);
}

function printJoinedTypes(
  joined: AST.TSUnionType | AST.TSIntersectionType,
  context: PrinterContext,
): void {
  context.writeNodeList(
    joined.types,
    joined.type === "TSUnionType" ? " | " : " & ",
  );
}

function printTSArrayType(
  array: AST.TSArrayType,
  context: PrinterContext,
): void {
  context.writeNode(array.elementType);
  context.write("[]");
}

function printTSTupleType(
  node: AST.TSTupleType,
  context: PrinterContext,
): void {
  context.write("[");
  context.writeNodeList(node.elementTypes, ", ");
  context.write("]");
}

function printTSNamedTupleMember(
  node: AST.TSNamedTupleMember,
  context: PrinterContext,
): void {
  context.writeNode(node.label);
  context.write(": ");
  context.writeNode(node.elementType);
}

function printTSTypeLiteral(
  literal: AST.TSTypeLiteral,
  context: PrinterContext,
): void {
  context.write("{ ");
  context.writeNodeList(literal.members, " ");
  context.write(" }");
}

function printTSTypeOperator(
  node: AST.TSTypeOperator,
  context: PrinterContext,
): void {
  context.write(node.operator + " ");
  if (node.typeAnnotation) {
    context.writeNode(node.typeAnnotation);
  }
}

function printTSTypePredicate(
  node: AST.TSTypePredicate,
  context: PrinterContext,
): void {
  if (node.asserts === true) {
    context.write("asserts ");
  }
  if (node.parameterName) {
    context.writeNode(node.parameterName);
  } else if (node.typeAnnotation) {
    context.writeNode(node.typeAnnotation);
  }
  if (node.asserts !== true || node.typeAnnotation) {
    context.write(" is ");
  }
  if (node.typeAnnotation) {
    context.writeNode(node.typeAnnotation.typeAnnotation);
  }
}

function printTSTypeQuery(
  node: AST.TSTypeQuery,
  context: PrinterContext,
): void {
  context.write("typeof ");
  context.writeNode(node.exprName);
}

function printTSMappedType(
  node: AST.TSMappedType,
  context: PrinterContext,
): void {
  context.write("{ ");
  if (node.readonly) {
    if (typeof node.readonly === "string") {
      context.write(node.readonly);
    }
    context.write("readonly ");
  }
  context.write("[");
  const legacyTp = node.typeParameter;
  const key = node.key ?? legacyTp?.name;
  const constraint = node.constraint ?? legacyTp?.constraint;

  if (key) {
    if (typeof key === "string") {
      context.write(key);
    } else {
      context.writeNode(key);
    }
  }
  if (constraint) {
    context.write(" in ");
    context.writeNode(constraint);
  }
  if (node.nameType) {
    context.write(" as ");
    context.writeNode(node.nameType);
  }
  context.write("]");
  if (node.optional) {
    if (typeof node.optional === "string") {
      context.write(node.optional);
    }
    context.write("?");
  }
  if (node.typeAnnotation) {
    context.write(": ");
    context.writeNode(node.typeAnnotation);
  }
  context.write(" }");
}

function printTSConditionalType(
  node: AST.TSConditionalType,
  context: PrinterContext,
): void {
  context.writeNode(node.checkType);
  context.write(" extends ");
  context.writeNode(node.extendsType);
  context.write(" ? ");
  context.writeNode(node.trueType);
  context.write(" : ");
  context.writeNode(node.falseType);
}

function printTSInferType(
  node: AST.TSInferType,
  context: PrinterContext,
): void {
  context.write("infer ");
  context.writeNode(node.typeParameter);
}

function printTSIndexedAccessType(
  node: AST.TSIndexedAccessType,
  context: PrinterContext,
): void {
  context.writeNode(node.objectType);
  context.write("[");
  context.writeNode(node.indexType);
  context.write("]");
}

function printTSOptionalType(
  node: AST.TSOptionalType,
  context: PrinterContext,
): void {
  context.writeNode(node.typeAnnotation);
  context.write("?");
}

function printTSRestType(node: AST.TSRestType, context: PrinterContext): void {
  context.write("...");
  context.writeNode(node.typeAnnotation);
}

function printTSThisType(_node: AST.TSThisType, context: PrinterContext): void {
  context.write("this");
}

function printTSLiteralType(
  literal: AST.TSLiteralType,
  context: PrinterContext,
): void {
  context.writeNode(literal.literal);
}

function printTSTemplateLiteralType(
  node: AST.TSTemplateLiteralType,
  context: PrinterContext,
): void {
  context.write("`");
  const { quasis, types } = node;
  for (let i = 0; i < types.length; i++) {
    context.write(quasis[i].value.raw);
    context.write("${");
    context.writeNode(types[i]);
    context.write("}");
  }
  context.write(quasis[quasis.length - 1].value.raw);
  context.write("`");
}

function printTSImportType(
  node: AST.TSImportType,
  context: PrinterContext,
): void {
  context.write("import(");
  context.writeNode(node.argument);
  context.write(")");
  if (node.qualifier) {
    context.write(".");
    context.writeNode(node.qualifier);
  }
}

function printTSImportEqualsDeclaration(
  node: AST.TSImportEqualsDeclaration,
  context: PrinterContext,
): void {
  context.write("import ");
  context.writeNode(node.id);
  context.write(" = ");
  context.writeNode(node.moduleReference);
  context.write(";");
}

function printTSExternalModuleReference(
  node: AST.TSExternalModuleReference,
  context: PrinterContext,
): void {
  context.write("require(");
  context.writeNode(node.expression);
  context.write(")");
}

function printTSEnumDeclaration(
  node: AST.TSEnumDeclaration,
  context: PrinterContext,
): void {
  if (node.declare === true) {
    context.write("declare ");
  }
  const isConst = node.const === true;
  if (isConst) {
    context.write("const ");
  }
  context.write("enum ");
  context.writeNode(node.id);
  context.write(" { ");
  context.writeNodeList(node.members, ", ");
  context.write(" }");
}

function printTSEnumMember(
  node: AST.TSEnumMember,
  context: PrinterContext,
): void {
  context.writeNode(node.id);
  if (node.initializer) {
    context.write(" = ");
    context.writeNode(node.initializer);
  }
}

function printTSModuleDeclaration(
  node: AST.TSModuleDeclaration,
  context: PrinterContext,
): void {
  if (node.declare === true) {
    context.write("declare ");
  }
  if (node.global === true) {
    context.write("global");
  } else {
    const kind =
      (node as AST.TSModuleDeclaration).kind ??
      (node.id && node.id.type === "Literal" ? "module" : "namespace");
    context.write(String(kind) + " ");
    context.writeNode(node.id);
  }
  let body = node.body as
    | AST.TSModuleDeclaration
    | AST.TSModuleBlock
    | undefined;
  while (body?.type === "TSModuleDeclaration") {
    context.write(".");
    context.writeNode(body.id);
    body = body.body;
  }
  if (body) {
    context.write(" ");
    context.writeNode(body);
  }
}

function printTSModuleBlock(
  node: AST.TSModuleBlock,
  context: PrinterContext,
): void {
  context.write("{\n");
  context.writeNodeListWithNewLineSep(node.body);
  context.write("\n}");
}

function printTSDeclareFunction(
  node: AST.TSDeclareFunction,
  context: PrinterContext,
): void {
  context.write("declare ");
  if (node.async === true) {
    context.write("async ");
  }
  context.write("function");
  if ((node.generator as boolean) === true) {
    context.write("*");
  }
  if (node.id) {
    context.write(" ");
    context.writeNode(node.id);
  }
  if (node.typeParameters) {
    context.writeNode(node.typeParameters);
  }
  context.write("(");
  context.writeNodeList(node.params, ", ");
  context.write(")");
  writeReturnType(node, context);
  context.write(";");
}

function printTSParameterProperty(
  node: AST.TSParameterProperty,
  context: PrinterContext,
): void {
  if (node.accessibility) {
    context.write(node.accessibility + " ");
  }
  if (node.readonly === true) {
    context.write("readonly ");
  }
  context.writeNode(node.parameter);
}

function printTSExportAssignment(
  node: AST.TSExportAssignment,
  context: PrinterContext,
): void {
  context.write("export = ");
  context.writeNode(node.expression);
  context.write(";");
}

function printTSNamespaceExportDeclaration(
  node: AST.TSNamespaceExportDeclaration,
  context: PrinterContext,
): void {
  context.write("export as namespace ");
  context.writeNode(node.id);
  context.write(";");
}

function printTSInstantiationExpression(
  node: AST.TSInstantiationExpression,
  context: PrinterContext,
): void {
  const needsParens = operandOfBinaryExprNeedsParens(
    node.expression,
    node,
    "left",
  );
  if (needsParens) {
    context.write("(");
    context.writeNode(node.expression);
    context.write(")");
  } else {
    context.writeNode(node.expression);
  }
  context.writeNode(node.typeArguments);
}

function printTSParenthesizedType(
  node: { typeAnnotation: AST.Node },
  context: PrinterContext,
): void {
  context.write("(");
  context.writeNode(node.typeAnnotation);
  context.write(")");
}

function printKeywordType(
  node: Extract<AST.Node, { type: `${string}Keyword` }>,
  context: PrinterContext,
): void {
  const keyword = node.type.slice(2, -"Keyword".length).toLowerCase();
  context.write(keyword);
}

function writeOptionalTypeAnnotation(
  node: { optional?: boolean; typeAnnotation?: AST.Node | null },
  context: PrinterContext,
): void {
  if (node.optional === true) {
    context.write("?");
  }
  if (node.typeAnnotation) {
    context.writeNode(node.typeAnnotation);
  }
}

export function writeComment(comment: Comment, context: PrinterContext): void {
  if (comment.type === "Line") {
    context.write("//" + comment.value + "\n");
  } else {
    context.write("/*" + comment.value + "*/");
    if (comment.value.includes("\n")) {
      context.write("\n");
    }
  }
}
