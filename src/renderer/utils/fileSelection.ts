import type { S3Object } from '../components/FileList';

export interface ClickModifiers {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

export interface ClickSelectionInput {
  item: S3Object;
  index: number;
  /** Index of the last plain/ctrl-clicked row, or -1 when there is none */
  lastClickedIndex: number;
  displayedItems: S3Object[];
  selectedFiles: S3Object[];
  isShift: boolean;
  isCtrlOrCmd: boolean;
}

export interface ClickSelection {
  selectedFiles: S3Object[];
  primary: S3Object | null;
  /** New anchor index, or null when the anchor must stay as it was */
  lastClickedIndex: number | null;
}

/** Ctrl on most platforms, Cmd on macOS. */
export function isCtrlOrCmdPressed(isMac: boolean, event: ClickModifiers): boolean {
  return isMac ? event.metaKey : event.ctrlKey;
}

/** Items of `range` that are not already in `existing`, appended to `existing`. */
export function mergeSelections(existing: S3Object[], range: S3Object[]): S3Object[] {
  const existingKeys = new Set(existing.map((f) => f.key));
  return [...existing, ...range.filter((r) => !existingKeys.has(r.key))];
}

/** The rows between two indexes, inclusive, in either direction. */
export function sliceRange(items: S3Object[], from: number, to: number): S3Object[] {
  return items.slice(Math.min(from, to), Math.max(from, to) + 1);
}

function shiftSelection(input: ClickSelectionInput): ClickSelection {
  const { item, index, lastClickedIndex, displayedItems, selectedFiles, isCtrlOrCmd } = input;
  const range = sliceRange(displayedItems, lastClickedIndex, index);
  return {
    selectedFiles: isCtrlOrCmd ? mergeSelections(selectedFiles, range) : range,
    primary: item,
    lastClickedIndex: null,
  };
}

function toggleSelection(input: ClickSelectionInput): ClickSelection {
  const { item, index, selectedFiles } = input;
  if (!selectedFiles.some((f) => f.key === item.key)) {
    return { selectedFiles: [...selectedFiles, item], primary: item, lastClickedIndex: index };
  }
  const remaining = selectedFiles.filter((f) => f.key !== item.key);
  return {
    selectedFiles: remaining,
    primary: remaining.length > 0 ? remaining[remaining.length - 1] : null,
    lastClickedIndex: index,
  };
}

/**
 * Selection resulting from a click on a row:
 * shift = range from the anchor (with ctrl/cmd: added to the selection),
 * ctrl/cmd = toggle the row, plain = select only the row.
 */
export function computeClickSelection(input: ClickSelectionInput): ClickSelection {
  if (input.isShift && input.lastClickedIndex >= 0) return shiftSelection(input);
  if (input.isCtrlOrCmd) return toggleSelection(input);
  return { selectedFiles: [input.item], primary: input.item, lastClickedIndex: input.index };
}
