import { describe, it, expect, vi } from 'vitest';
import {
  addToTotals,
  deleteSelection,
  getDeleteToast,
  splitSelection,
  type DeleteOperations,
  type DeleteTotals,
} from '../renderer/utils/deleteSelection';
import type { S3Object } from '../renderer/components/FileList';

const item = (key: string, isPrefix = false): S3Object => ({ key, size: 1, lastModified: undefined, isPrefix }) as S3Object;

describe('splitSelection', () => {
  it.each([
    [[], [], []],
    [['a.txt'], [], ['a.txt']],
    [['d/'], ['d/'], []],
    [['a.txt', 'd/', 'b.txt', 'e/'], ['d/', 'e/'], ['a.txt', 'b.txt']],
  ])('%j -> folders %j, files %j', (keys, folders, files) => {
    const sel = keys.map(k => item(k, k.endsWith('/')));
    const out = splitSelection(sel);
    expect(out.folders.map(f => f.key)).toEqual(folders);
    expect(out.files.map(f => f.key)).toEqual(files);
  });
});

describe('addToTotals', () => {
  const base: DeleteTotals = { deleted: 2, failed: 1, errors: ['x'] };
  it.each([
    [{ deletedCount: 3, failedCount: 0 }, { deleted: 5, failed: 1, errors: ['x'] }],
    [{ deletedCount: 0, failedCount: 2 }, { deleted: 2, failed: 3, errors: ['x'] }],
    [{ deletedCount: 1, failedCount: 1, error: 'boom' }, { deleted: 3, failed: 2, errors: ['x', 'boom'] }],
    [{ deletedCount: 0, failedCount: 0, error: '' }, { deleted: 2, failed: 1, errors: ['x'] }],
  ])('%j', (outcome, expected) => {
    expect(addToTotals(base, outcome)).toEqual(expected);
    expect(base.errors).toEqual(['x']);
  });
});

describe('getDeleteToast', () => {
  it.each([
    [
      { deleted: 2, failed: 1, errors: ['denied', 'other'] },
      { type: 'warning', title: 'Delete Failed', message: 'Deleted 2 item(s), 1 failed: denied', duration: 5000 },
    ],
    [
      { deleted: 0, failed: 3, errors: [] },
      { type: 'warning', title: 'Delete Failed', message: 'Deleted 0 item(s), 3 failed', duration: 5000 },
    ],
    [
      { deleted: 4, failed: 0, errors: [] },
      { type: 'success', title: 'Delete Complete', message: 'Deleted 4 item(s)', duration: 3000 },
    ],
    [
      { deleted: 0, failed: 0, errors: ['exploded'] },
      { type: 'error', title: 'Delete Error', message: 'exploded', duration: 5000 },
    ],
    [{ deleted: 0, failed: 0, errors: [] }, null],
  ])('%j', (totals, expected) => {
    expect(getDeleteToast(totals)).toEqual(expected);
  });
});

describe('deleteSelection', () => {
  function makeOps(): DeleteOperations & { calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      deletePrefix: vi.fn(async (_b: string, p: string) => {
        calls.push(`prefix:${p}`);
        return { success: true, deletedCount: 10, failedCount: 0 };
      }),
      deleteFile: vi.fn(async (_b: string, k: string) => {
        calls.push(`file:${k}`);
        return true;
      }),
      deleteFiles: vi.fn(async (_b: string, keys: string[]) => {
        calls.push(`files:${keys.join(',')}`);
        return { success: true, deletedCount: keys.length, failedCount: 0 };
      }),
    };
  }

  it('does nothing for an empty selection', async () => {
    const ops = makeOps();
    expect(await deleteSelection('b', [], ops)).toEqual({ deleted: 0, failed: 0, errors: [] });
    expect(ops.calls).toEqual([]);
  });

  it('uses the single-file call for exactly one file', async () => {
    const ops = makeOps();
    expect(await deleteSelection('b', [item('a.txt')], ops)).toEqual({ deleted: 1, failed: 0, errors: [] });
    expect(ops.calls).toEqual(['file:a.txt']);
  });

  it('counts a failed single-file delete', async () => {
    const ops = makeOps();
    vi.mocked(ops.deleteFile).mockResolvedValueOnce(false);
    expect(await deleteSelection('b', [item('a.txt')], ops)).toEqual({ deleted: 0, failed: 1, errors: [] });
  });

  it('uses the batch call for several files', async () => {
    const ops = makeOps();
    const out = await deleteSelection('b', [item('a'), item('b')], ops);
    expect(out).toEqual({ deleted: 2, failed: 0, errors: [] });
    expect(ops.calls).toEqual(['files:a,b']);
  });

  it('deletes folders before files and accumulates counts and errors', async () => {
    const ops = makeOps();
    vi.mocked(ops.deletePrefix)
      .mockResolvedValueOnce({ success: false, deletedCount: 1, failedCount: 2, error: 'denied' })
      .mockResolvedValueOnce({ success: true, deletedCount: 5, failedCount: 0 });
    vi.mocked(ops.deleteFiles).mockResolvedValueOnce({ success: false, deletedCount: 1, failedCount: 1 });
    const out = await deleteSelection('b', [item('x'), item('d1/', true), item('y'), item('d2/', true)], ops);
    expect(out).toEqual({ deleted: 7, failed: 3, errors: ['denied'] });
    expect(vi.mocked(ops.deletePrefix).mock.invocationCallOrder[1]).toBeLessThan(
      vi.mocked(ops.deleteFiles).mock.invocationCallOrder[0]
    );
    expect(vi.mocked(ops.deletePrefix).mock.calls.map(c => c[1])).toEqual(['d1/', 'd2/']);
  });
});
