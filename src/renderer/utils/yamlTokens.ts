/**
 * Pure helpers for YAML syntax-highlight tokenizing of a value portion.
 */

export type TokenType =
  | 'key' | 'string' | 'number' | 'boolean' | 'null' | 'comment'
  | 'anchor' | 'alias' | 'tag' | 'literal' | 'default';

export interface Token {
  type: TokenType;
  value: string;
}

/**
 * Find the start of an inline comment (not inside quotes)
 */
export function findCommentStart(text: string): number {
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const prevChar = i > 0 ? text[i - 1] : '';

    if (char === '"' && !inSingleQuote && prevChar !== '\\') {
      inDoubleQuote = !inDoubleQuote;
    } else if (char === "'" && !inDoubleQuote && prevChar !== '\\') {
      inSingleQuote = !inSingleQuote;
    } else if (char === '#' && !inSingleQuote && !inDoubleQuote) {
      // Make sure there's a space before # or it's at start
      if (i === 0 || /\s/.test(prevChar)) {
        return i;
      }
    }
  }

  return -1;
}

/**
 * Split an already-trimmed value into its content and trailing inline comment.
 */
export function splitInlineComment(trimmed: string): { content: string; comment: string } {
  const commentIdx = findCommentStart(trimmed);
  if (commentIdx < 0) {
    return { content: trimmed, comment: '' };
  }
  return { content: trimmed.substring(0, commentIdx).trim(), comment: trimmed.substring(commentIdx) };
}

/**
 * Tokens for a trailing inline comment: a separating space and the comment, or none.
 */
export function commentTokens(comment: string): Token[] {
  return comment
    ? [{ type: 'default', value: ' ' }, { type: 'comment', value: comment }]
    : [];
}

/**
 * Classify a plain scalar (already stripped of any comment, anchor, alias or tag).
 */
export function classifyScalar(value: string): TokenType {
  if (/^[|>][+-]?\d*$/.test(value)) return 'literal';
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return 'string';
  }
  if (/^(true|false|yes|no|on|off)$/i.test(value)) return 'boolean';
  if (/^(null|~)$/i.test(value)) return 'null';
  if (/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(value) ||
      /^0x[0-9a-fA-F]+$/.test(value) ||
      /^0o[0-7]+$/.test(value)) {
    return 'number';
  }
  return 'string';
}

interface PrefixedKind {
  prefix: string;
  pattern: RegExp;
  type: TokenType;
  /** Whether a space token separates the leading token from the rest. */
  separated: boolean;
}

const PREFIXED_KINDS: PrefixedKind[] = [
  { prefix: '&', pattern: /^(&[\w-]+)(.*)$/, type: 'anchor', separated: false },
  { prefix: '*', pattern: /^(\*[\w-]+)(.*)$/, type: 'alias', separated: false },
  { prefix: '!', pattern: /^(![\w!/<>.-]*)\s*(.*)$/, type: 'tag', separated: true },
];

/**
 * Tokenize a value that begins with an anchor (&), alias (*) or tag (!).
 * Returns null when the value does not start with a well-formed one.
 * `recurse` tokenizes the remainder of the value.
 */
export function tokenizePrefixed(
  content: string,
  comment: string,
  recurse: (rest: string) => Token[],
): Token[] | null {
  for (const kind of PREFIXED_KINDS) {
    if (!content.startsWith(kind.prefix)) continue;
    const match = content.match(kind.pattern);
    if (!match) continue;
    const tokens: Token[] = [{ type: kind.type, value: match[1] }];
    if (match[2]) {
      if (kind.separated) tokens.push({ type: 'default', value: ' ' });
      tokens.push(...recurse(match[2]));
    }
    tokens.push(...commentTokens(comment));
    return tokens;
  }
  return null;
}
