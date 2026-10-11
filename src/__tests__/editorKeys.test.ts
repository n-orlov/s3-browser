import { describe, it, expect } from 'vitest';
import { getEditorKeyAction } from '../renderer/utils/editorKeys';

describe('getEditorKeyAction', () => {
  it.each([
    { key: 's', ctrlKey: true, metaKey: false, hasChanges: true, expected: 'save' },
    { key: 's', ctrlKey: false, metaKey: true, hasChanges: true, expected: 'save' },
    { key: 's', ctrlKey: true, metaKey: false, hasChanges: false, expected: 'save' },
    { key: 's', ctrlKey: false, metaKey: false, hasChanges: true, expected: null },
    { key: 'S', ctrlKey: true, metaKey: false, hasChanges: true, expected: null },
    { key: 'a', ctrlKey: true, metaKey: false, hasChanges: true, expected: null },
    { key: 'Escape', ctrlKey: false, metaKey: false, hasChanges: false, expected: 'close' },
    { key: 'Escape', ctrlKey: false, metaKey: false, hasChanges: true, expected: null },
    { key: 'Enter', ctrlKey: false, metaKey: false, hasChanges: false, expected: null },
  ])(
    'key $key ctrl=$ctrlKey meta=$metaKey hasChanges=$hasChanges -> $expected',
    ({ expected, hasChanges, ...input }) => {
      expect(getEditorKeyAction(input, hasChanges)).toBe(expected);
    }
  );
});
