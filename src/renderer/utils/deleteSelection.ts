import type { S3Object } from '../components/FileList';
import type { DeleteFilesResult, DeletePrefixResult } from '../hooks/useFileOperations';

export interface DeleteTotals {
  deleted: number;
  failed: number;
  errors: string[];
}

export interface DeleteToast {
  type: 'success' | 'warning' | 'error';
  title: string;
  message: string;
  duration: number;
}

export interface DeleteOperations {
  deletePrefix: (bucket: string, prefix: string) => Promise<DeletePrefixResult>;
  deleteFile: (bucket: string, key: string) => Promise<boolean>;
  deleteFiles: (bucket: string, keys: string[]) => Promise<DeleteFilesResult>;
}

/** Splits a selection into folders (prefixes) and plain files, preserving order. */
export function splitSelection(selection: S3Object[]): { folders: S3Object[]; files: S3Object[] } {
  return {
    folders: selection.filter(item => item.isPrefix),
    files: selection.filter(item => !item.isPrefix),
  };
}

/** Folds the outcome of one operation into the running totals. */
export function addToTotals(
  totals: DeleteTotals,
  outcome: { deletedCount: number; failedCount: number; error?: string }
): DeleteTotals {
  return {
    deleted: totals.deleted + outcome.deletedCount,
    failed: totals.failed + outcome.failedCount,
    errors: outcome.error ? [...totals.errors, outcome.error] : totals.errors,
  };
}

/** The toast reporting a delete run, or null when nothing happened and nothing failed. */
export function getDeleteToast({ deleted, failed, errors }: DeleteTotals): DeleteToast | null {
  if (failed > 0) {
    const detail = errors.length > 0 ? `: ${errors[0]}` : '';
    return {
      type: 'warning',
      title: 'Delete Failed',
      message: `Deleted ${deleted} item(s), ${failed} failed${detail}`,
      duration: 5000,
    };
  }
  if (deleted > 0) {
    return { type: 'success', title: 'Delete Complete', message: `Deleted ${deleted} item(s)`, duration: 3000 };
  }
  if (errors.length > 0) {
    // Both counters zero but an error occurred (e.g. exception during the operation)
    return { type: 'error', title: 'Delete Error', message: errors[0], duration: 5000 };
  }
  return null;
}

async function deleteFilesOf(
  bucket: string,
  files: S3Object[],
  ops: DeleteOperations
): Promise<{ deletedCount: number; failedCount: number }> {
  if (files.length === 1) {
    const success = await ops.deleteFile(bucket, files[0].key);
    return { deletedCount: success ? 1 : 0, failedCount: success ? 0 : 1 };
  }
  if (files.length > 1) {
    return ops.deleteFiles(
      bucket,
      files.map(f => f.key)
    );
  }
  return { deletedCount: 0, failedCount: 0 };
}

/** Deletes folders first (they contain nested objects), then files, and returns the totals. */
export async function deleteSelection(
  bucket: string,
  selection: S3Object[],
  ops: DeleteOperations
): Promise<DeleteTotals> {
  const { folders, files } = splitSelection(selection);
  let totals: DeleteTotals = { deleted: 0, failed: 0, errors: [] };
  for (const folder of folders) {
    totals = addToTotals(totals, await ops.deletePrefix(bucket, folder.key));
  }
  return addToTotals(totals, await deleteFilesOf(bucket, files, ops));
}
