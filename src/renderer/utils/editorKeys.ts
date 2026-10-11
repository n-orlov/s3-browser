export type EditorKeyAction = 'save' | 'close' | null;

export interface EditorKeyInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
}

/**
 * Maps a keydown in the text editor overlay to an action.
 * Ctrl/Cmd+S saves; Escape closes only when there are no unsaved changes.
 */
export function getEditorKeyAction(
  { key, ctrlKey, metaKey }: EditorKeyInput,
  hasChanges: boolean
): EditorKeyAction {
  if ((ctrlKey || metaKey) && key === 's') return 'save';
  if (key === 'Escape' && !hasChanges) return 'close';
  return null;
}
