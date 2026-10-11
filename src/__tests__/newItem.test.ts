import { describe, it, expect, vi } from 'vitest';
import { createNewItem, getNewItemToast, type NewItemKind } from '../renderer/utils/newItem';

describe('createNewItem', () => {
  it.each([
    ['file', 'createFile', 'createFolder'],
    ['folder', 'createFolder', 'createFile'],
  ] as const)('%s kind calls only %s', async (kind, used, unused) => {
    const ops = {
      createFile: vi.fn().mockResolvedValue({ success: true }),
      createFolder: vi.fn().mockResolvedValue({ success: true }),
    };
    const result = await createNewItem(ops, 'b', 'p/k', kind);
    expect(result).toEqual({ success: true });
    expect(ops[used]).toHaveBeenCalledWith('b', 'p/k');
    expect(ops[unused]).not.toHaveBeenCalled();
  });

  it('returns the failure result untouched', async () => {
    const ops = {
      createFile: vi.fn().mockResolvedValue({ success: false, error: 'nope' }),
      createFolder: vi.fn(),
    };
    expect(await createNewItem(ops, 'b', 'k', 'file')).toEqual({ success: false, error: 'nope' });
  });
});

describe('getNewItemToast', () => {
  it.each([
    ['file', 'a.txt', { success: true }, { type: 'success', title: 'File Created', message: 'a.txt', duration: 3000 }],
    ['folder', 'docs', { success: true }, { type: 'success', title: 'Folder Created', message: 'docs', duration: 3000 }],
    ['file', 'a.txt', { success: false, error: 'denied' }, { type: 'error', title: 'Creation Failed', message: 'denied', duration: 5000 }],
    ['folder', 'docs', { success: false }, { type: 'error', title: 'Creation Failed', message: 'Unknown error', duration: 5000 }],
    ['folder', 'docs', { success: false, error: '' }, { type: 'error', title: 'Creation Failed', message: 'Unknown error', duration: 5000 }],
  ] as [NewItemKind, string, { success: boolean; error?: string }, object][])(
    '%s %s %j',
    (kind, name, result, expected) => {
      expect(getNewItemToast(kind, name, result)).toEqual(expected);
    }
  );
});
