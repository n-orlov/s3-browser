/**
 * Pure helpers for the JSON tree viewer (extracted from JsonTreeNode).
 */

export type JsonEntries = Array<[string, unknown]>;

/** True when the node name contains the (case-insensitive) search term. */
export function isNameMatch(name: string, searchTerm: string): boolean {
  return Boolean(searchTerm) && name.toLowerCase().includes(searchTerm.toLowerCase());
}

/** CSS class of a key span, with the match highlight when applicable. */
export function getKeyClassName(nameMatches: boolean): string {
  return `json-key ${nameMatches ? 'json-match' : ''}`;
}

/** Child entries of an object/array node; array indices are stringified. */
export function getNodeEntries(value: object): JsonEntries {
  if (Array.isArray(value)) {
    return value.map((v, i) => [String(i), v] as [string, unknown]);
  }
  return Object.entries(value as Record<string, unknown>);
}

/** Opening and closing bracket for an array or object node. */
export function getBrackets(isArray: boolean): { open: string; close: string } {
  return isArray ? { open: '[', close: ']' } : { open: '{', close: '}' };
}

/** Summary shown next to a collapsed node. */
export function getCollapsedHint(isArray: boolean, count: number): string {
  return isArray ? `${count} items` : `${count} keys`;
}

/** Display name of a child: array indices are wrapped in brackets. */
export function getChildName(key: string, parentIsArray: boolean): string {
  return parentIsArray ? `[${key}]` : key;
}

/** Whether a key press toggles a collapsible node. */
export function isToggleKey(key: string): boolean {
  return key === 'Enter' || key === ' ';
}

/** Left padding in pixels for a node at the given depth. */
export function getIndentPx(level: number): number {
  return level * 16;
}

/** Whether a node starts expanded: requested by default, or on a search hit. */
export function shouldStartExpanded(
  defaultExpanded: boolean,
  matchesSearch: boolean
): boolean {
  return defaultExpanded || matchesSearch;
}
