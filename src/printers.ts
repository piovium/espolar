import type { PrinterContext, Printers } from "./api.ts";
import type { AST } from "./types.ts";

export const defaultPrinters: Printers<unknown> = {
  Program: printProgram,
  Identifier: printIdentifier,
  PrivateIdentifier: printPrivateIdentifier,
  Literal: printLiteral,
  ExpressionStatement: printExpressionStatement,
  VariableDeclaration: printVariableDeclaration,
  VariableDeclarator: printVariableDeclarator,
  BlockStatement: printBlockStatement,
  ReturnStatement: printReturnStatement,
  FunctionDeclaration: printFunctionDeclaration,
  FunctionExpression: printFunctionExpression,
  ArrowFunctionExpression: printArrowFunctionExpression,
  BinaryExpression: printBinaryExpression,
  LogicalExpression: printBinaryExpression,
  AssignmentExpression: printBinaryExpression,
  CallExpression: printCallExpression,
  ChainExpression: printChainExpression,
  MemberExpression: printMemberExpression,
  ObjectExpression: printObjectExpression,
  Property: printProperty,
  ArrayExpression: printArrayExpression,
  SpreadElement: printSpreadElement,
  RestElement: printRestElement,
  TSAsExpression: printTypeCastExpression,
  TSSatisfiesExpression: printTypeCastExpression,
  TSNonNullExpression: printTSNonNullExpression,
  TSTypeAnnotation: printTSTypeAnnotation,
  TSTypeAliasDeclaration: printTSTypeAliasDeclaration,
  TSInterfaceDeclaration: printTSInterfaceDeclaration,
  // @ts-expect-error TSESTree do not have this entry
  // https://github.com/sveltejs/acorn-typescript/issues/7#issuecomment-3237280163
  TSExpressionWithTypeArguments: printTSExpressionWithTypeArguments,
  TSClassImplements: printTSExpressionWithTypeArguments,
  TSInterfaceHeritage: printTSExpressionWithTypeArguments,
  TSFunctionType: printTSFunctionType,
  TSMethodSignature: printTSMethodSignature,
  TSInterfaceBody: printTSInterfaceBody,
  TSPropertySignature: printTSPropertySignature,
  TSTypeParameterDeclaration: printTypeParameterDeclaration,
  TSTypeParameterInstantiation: printTypeParameterInstantiation,
  TSTypeParameter: printTSTypeParameter,
  TSTypeReference: printTSTypeReference,
  TSQualifiedName: printTSQualifiedName,
  TSUnionType: printJoinedTypes,
  TSIntersectionType: printJoinedTypes,
  TSArrayType: printTSArrayType,
  TSTypeLiteral: printTSTypeLiteral,
  TSLiteralType: printTSLiteralType,
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
};

function printProgram(
  program: AST.Program,
  context: PrinterContext<unknown>,
): void {
  context.writeNodeListWithSourceGaps(program.body, "\n");
}

function printIdentifier(
  identifier: AST.Identifier,
  context: PrinterContext<unknown>,
): void {
  context.write(String(identifier.name));
  writeOptionalTypeAnnotation(identifier, context);
}

function printPrivateIdentifier(
  identifier: AST.PrivateIdentifier,
  context: PrinterContext<unknown>,
): void {
  context.write("#");
  context.write(String(identifier.name));
}

function printLiteral(
  literal: AST.Literal,
  context: PrinterContext<unknown>,
): void {
  if (typeof literal.raw === "string") {
    context.write(literal.raw);
    return;
  }
  const literal2 = literal as AST.Literal;
  context.write(JSON.stringify(literal2.value));
}

function printExpressionStatement(
  statement: AST.ExpressionStatement,
  context: PrinterContext<unknown>,
): void {
  context.writeNode(statement.expression);
  context.write(";");
}

function printVariableDeclaration(
  declaration: AST.VariableDeclaration,
  context: PrinterContext<unknown>,
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
  context: PrinterContext<unknown>,
): void {
  context.writeNode(declarator.id);
  if (declarator.definite === true) {
    context.write("!");
  }
  if (declarator.init) {
    context.write(" = ");
    context.writeNode(declarator.init);
  }
}

function printBlockStatement(
  block: AST.BlockStatement,
  context: PrinterContext<unknown>,
): void {
  const body = block.body;
  context.write("{");
  if (body.length > 0) {
    context.write("\n");
    context.writeNodeListWithSourceGaps(body, "\n");
    context.write("\n");
  }
  context.write("}");
}

function printReturnStatement(
  statement: AST.ReturnStatement,
  context: PrinterContext<unknown>,
): void {
  context.write("return");
  if (statement.argument) {
    context.write(" ");
    context.writeNode(statement.argument);
  }
  context.write(";");
}

function printFunctionDeclaration(
  node: AST.FunctionDeclaration,
  context: PrinterContext<unknown>,
): void {
  printFunction(node, context, true);
}

function printFunctionExpression(
  node: AST.FunctionExpression,
  context: PrinterContext<unknown>,
): void {
  printFunction(node, context, true);
}

function printFunction(
  fn: AST.FunctionDeclaration | AST.FunctionExpression,
  context: PrinterContext<unknown>,
  includeFunctionKeyword: boolean,
): void {
  if (fn.async === true) {
    context.write("async ");
  }
  if (includeFunctionKeyword) {
    context.write("function");
    if (fn.generator === true) {
      context.write("*");
    }
    if (fn.id) {
      context.write(" ");
      context.writeNode(fn.id);
    }
  }
  if (fn.typeParameters) {
    context.writeNode(fn.typeParameters);
  }
  context.write("(");
  context.writeNodeList(fn.params, ", ");
  context.write(")");
  if (fn.returnType) {
    context.writeNode(fn.returnType);
  }
  if (fn.body) {
    context.write(" ");
    context.writeNode(fn.body);
  }
}

function printArrowFunctionExpression(
  fn: AST.ArrowFunctionExpression,
  context: PrinterContext<unknown>,
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
  if (fn.returnType) {
    context.writeNode(fn.returnType);
  }
  context.write(" => ");
  context.writeNode(fn.body);
}

function printBinaryExpression(
  expression:
    | AST.AssignmentExpression
    | AST.LogicalExpression
    | AST.BinaryExpression,
  context: PrinterContext<unknown>,
): void {
  context.writeNode(expression.left);
  context.write(" ");
  context.write(String(expression.operator));
  context.write(" ");
  context.writeNode(expression.right);
}

function printCallExpression(
  expression: AST.CallExpression,
  context: PrinterContext<unknown>,
): void {
  context.writeNode(expression.callee);
  if (expression.typeArguments) {
    context.writeNode(expression.typeArguments);
  }
  context.write(expression.optional === true ? "?.(" : "(");
  context.writeNodeList(expression.arguments, ", ");
  context.write(")");
}

function printChainExpression(
  expression: AST.ChainExpression,
  context: PrinterContext<unknown>,
): void {
  context.writeNode(expression.expression);
}

function printMemberExpression(
  expression: AST.MemberExpression,
  context: PrinterContext<unknown>,
): void {
  context.writeNode(expression.object);
  if (expression.computed === true) {
    context.write(expression.optional === true ? "?.[" : "[");
    context.writeNode(expression.property);
    context.write("]");
    return;
  }

  context.write(expression.optional === true ? "?." : ".");
  context.writeNode(expression.property);
}

function printObjectExpression(
  object: AST.ObjectExpression,
  context: PrinterContext<unknown>,
): void {
  context.write("{ ");
  context.writeNodeList(object.properties, ", ");
  context.write(" }");
}

function printProperty(
  property: AST.Property,
  context: PrinterContext<unknown>,
): void {
  if (property.shorthand === true) {
    context.writeNode(property.key);
    return;
  }

  if (property.computed === true) {
    context.write("[");
    context.writeNode(property.key);
    context.write("]");
  } else {
    context.writeNode(property.key);
  }
  context.write(": ");
  context.writeNode(property.value);
}

function printArrayExpression(
  array: AST.ArrayExpression,
  context: PrinterContext<unknown>,
): void {
  context.write("[");
  context.writeNodeList(array.elements as (AST.Node | null)[], ", ");
  context.write("]");
}

function printSpreadElement(
  spread: AST.SpreadElement,
  context: PrinterContext<unknown>,
): void {
  context.write("...");
  context.writeNode(spread.argument);
}

function printRestElement(
  rest: AST.RestElement,
  context: PrinterContext<unknown>,
): void {
  context.write("...");
  context.writeNode(rest.argument);
  writeOptionalTypeAnnotation(rest, context);
}

function printTypeCastExpression(
  expression: AST.TSSatisfiesExpression | AST.TSAsExpression,
  context: PrinterContext<unknown>,
): void {
  context.writeNode(expression.expression);
  context.write(
    expression.type === "TSSatisfiesExpression" ? " satisfies " : " as ",
  );
  context.writeNode(expression.typeAnnotation);
}

function printTSNonNullExpression(
  expression: AST.TSNonNullExpression,
  context: PrinterContext<unknown>,
): void {
  context.writeNode(expression.expression);
  context.write("!");
}

function printTSTypeAnnotation(
  annotation: AST.TSTypeAnnotation,
  context: PrinterContext<unknown>,
): void {
  context.write(": ");
  context.writeNode(annotation.typeAnnotation);
}

function printTSTypeAliasDeclaration(
  alias: AST.TSTypeAliasDeclaration,
  context: PrinterContext<unknown>,
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
  context: PrinterContext<unknown>,
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
  context: PrinterContext<unknown>,
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
  context: PrinterContext<unknown>,
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
  context: PrinterContext<unknown>,
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
  context: PrinterContext<unknown>,
): void {
  context.write("<");
  context.writeNodeList(declaration.params, ", ");
  context.write(">");
}

function printTypeParameterInstantiation(
  instantiation: AST.TSTypeParameterInstantiation,
  context: PrinterContext<unknown>,
): void {
  context.write("<");
  context.writeNodeList(instantiation.params, ", ");
  context.write(">");
}

function printTSTypeParameter(
  parameter: AST.TSTypeParameter,
  context: PrinterContext<unknown>,
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
  context: PrinterContext<unknown>,
): void {
  if (type.typeParameters) {
    context.writeNode(type.typeParameters);
  } else if (type.typeAnnotation) {
    context.writeNode(type.typeAnnotation.typeAnnotation);
  }
  context.write("(");
  if (type.params) {
    context.writeNodeList(type.params, ", ");
  } else if (type.parameters) {
    context.writeNodeList(type.parameters, ", ");
  }
  context.write(")");
  if (type.returnType) {
    context.writeNode(type.returnType);
  }
}

function printTSMethodSignature(
  signature: AST.TSMethodSignature,
  context: PrinterContext<unknown>,
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
  } else if (signature.typeAnnotation) {
    context.writeNode(signature.typeAnnotation.typeAnnotation);
  }
  context.write("(");
  if (signature.params) {
    context.writeNodeList(signature.params, ", ");
  } else if (signature.parameters) {
    context.writeNodeList(signature.parameters, ", ");
  }
  context.write(")");
  if (signature.typeAnnotation) {
    context.writeNode(signature.typeAnnotation);
  }
  context.write(";");
}

function printTSTypeReference(
  reference: AST.TSTypeReference,
  context: PrinterContext<unknown>,
): void {
  context.writeNode(reference.typeName);
  if (reference.typeArguments) {
    context.writeNode(reference.typeArguments);
  }
}

function printTSQualifiedName(
  name: AST.TSQualifiedName,
  context: PrinterContext<unknown>,
): void {
  context.writeNode(name.left);
  context.write(".");
  context.writeNode(name.right);
}

function printJoinedTypes(
  joined: AST.TSUnionType | AST.TSIntersectionType,
  context: PrinterContext<unknown>,
): void {
  context.writeNodeList(
    joined.types,
    joined.type === "TSUnionType" ? " | " : " & ",
  );
}

function printTSArrayType(
  array: AST.TSArrayType,
  context: PrinterContext<unknown>,
): void {
  context.writeNode(array.elementType);
  context.write("[]");
}

function printTSTypeLiteral(
  literal: AST.TSTypeLiteral,
  context: PrinterContext<unknown>,
): void {
  context.write("{ ");
  context.writeNodeList(literal.members, " ");
  context.write(" }");
}

function printTSLiteralType(
  literal: AST.TSLiteralType,
  context: PrinterContext<unknown>,
): void {
  context.writeNode(literal.literal);
}

function printKeywordType(
  node: Extract<AST.Node, { type: `${string}Keyword` }>,
  context: PrinterContext<unknown>,
): void {
  const keyword = node.type.slice(2, -"Keyword".length).toLowerCase();
  context.write(keyword);
}

function writeOptionalTypeAnnotation(
  node: { optional?: boolean; typeAnnotation?: AST.Node },
  context: PrinterContext<unknown>,
): void {
  if (node.optional === true) {
    context.write("?");
  }
  if (node.typeAnnotation) {
    context.writeNode(node.typeAnnotation);
  }
}
