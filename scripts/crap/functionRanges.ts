// ESLint rule used only by the CRAP CLI. It reports every function with the facts the CLI needs
// to join ESLint's `complexity` messages to v8 coverage: where ESLint's complexity message points
// (the function "head"), where the body starts (v8 ranges start there) and a stable qualified name.
import type { Rule, SourceCode } from 'eslint';
import type { Node } from 'estree';

export interface FunctionFacts {
  /** Qualified name, e.g. `FileList.handleClick` or `<anonymous>`. */
  name: string;
  /** 1-based line / 0-based column where ESLint's complexity message for this function starts. */
  headLine: number;
  headColumn: number;
  /** 1-based line / 0-based column of the function body start (v8 coverage ranges start here). */
  bodyLine: number;
  bodyColumn: number;
}

type FunctionNode = Extract<Node, { type: 'FunctionDeclaration' | 'FunctionExpression' | 'ArrowFunctionExpression' }>;
type WithParent = Node & { parent?: WithParent };

function keyName(key: Node, sourceText: (node: Node) => string): string {
  if (key.type === 'Identifier') return key.name;
  if (key.type === 'Literal') return String(key.value);
  return `[${sourceText(key)}]`;
}

function callbackName(call: Extract<Node, { type: 'CallExpression' }> & WithParent, node: FunctionNode, sourceText: (node: Node) => string) {
  // `const handler = useCallback(() => ..., [])` is named `handler`; other callbacks `useEffect()`.
  if (!(call.arguments as Node[]).includes(node)) return undefined;
  const holder = call.parent;
  if (holder?.type === 'VariableDeclarator' && holder.id.type === 'Identifier') return holder.id.name;
  return call.callee.type === 'Super' ? undefined : `${sourceText(call.callee)}()`;
}

function nameFromParent(node: FunctionNode, parent: WithParent, sourceText: (node: Node) => string): string | undefined {
  switch (parent.type) {
    case 'VariableDeclarator':
      return parent.id.type === 'Identifier' ? parent.id.name : undefined;
    case 'Property':
    case 'MethodDefinition':
    case 'PropertyDefinition':
      return parent.value === node ? keyName(parent.key, sourceText) : undefined;
    case 'AssignmentExpression':
      return parent.right === node ? sourceText(parent.left) : undefined;
    case 'CallExpression':
      return callbackName(parent, node, sourceText);
    default:
      return undefined;
  }
}

function ownName(node: FunctionNode, sourceText: (node: Node) => string): string | undefined {
  if (node.type !== 'ArrowFunctionExpression' && node.id) return node.id.name;
  const parent = (node as WithParent).parent;
  return parent ? nameFromParent(node, parent, sourceText) : undefined;
}

function isFunction(node: Node): node is FunctionNode {
  return node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression';
}

function qualifiedName(node: FunctionNode, sourceText: (node: Node) => string): string {
  const parts: string[] = [ownName(node, sourceText) ?? '<anonymous>'];
  for (let up = (node as WithParent).parent; up; up = up.parent) {
    if (isFunction(up)) {
      parts.unshift(ownName(up, sourceText) ?? '<anonymous>');
    } else if ((up.type === 'ClassDeclaration' || up.type === 'ClassExpression') && up.id) {
      parts.unshift(up.id.name);
    }
  }
  return parts.join('.');
}

/**
 * Where ESLint's `complexity` message points: at the start of the enclosing method, property or
 * class field, else at an arrow function's `=>`, else at the start of the function.
 */
function headStart(node: FunctionNode, sourceCode: SourceCode) {
  const parent = (node as WithParent).parent;
  if (parent && (parent.type === 'Property' || parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition') && parent.value === node) {
    return parent.loc!.start;
  }
  if (node.type === 'ArrowFunctionExpression') {
    const arrow = sourceCode.getTokenBefore(node.body, { filter: (token) => token.value === '=>' });
    return (arrow ?? node).loc!.start;
  }
  return node.loc!.start;
}

export const functionRanges: Rule.RuleModule = {
  meta: { type: 'problem', schema: [], messages: {} },
  create(context) {
    const sourceCode = context.sourceCode;
    const sourceText = (node: Node) => sourceCode.getText(node);
    const visit = (node: Rule.Node) => {
      if (!isFunction(node)) return;
      const head = headStart(node, sourceCode);
      const body = node.body.loc!.start;
      const facts: FunctionFacts = {
        name: qualifiedName(node, sourceText),
        headLine: head.line,
        headColumn: head.column,
        bodyLine: body.line,
        bodyColumn: body.column,
      };
      context.report({ node, message: JSON.stringify(facts) });
    };
    return { FunctionDeclaration: visit, FunctionExpression: visit, ArrowFunctionExpression: visit };
  },
};
