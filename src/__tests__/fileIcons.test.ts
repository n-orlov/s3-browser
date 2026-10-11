import { describe, it, expect } from 'vitest';
import {
  DEFAULT_FILE_ICON,
  getIconForExtension,
  getKeyExtension,
} from '../renderer/utils/fileIcons';

describe('getKeyExtension', () => {
  it.each([
    ['a/b/report.JSON', 'json'],
    ['archive.tar.gz', 'gz'],
    ['photo.PnG', 'png'],
    ['a.b/file', 'b/file'],
    ['README', 'readme'],
    ['trailingdot.', ''],
    ['', ''],
  ])('%j -> %j', (key, expected) => {
    expect(getKeyExtension(key)).toBe(expected);
  });
});

describe('getIconForExtension', () => {
  it.each([
    ['json', '📋'],
    ['yaml', '📋'],
    ['yml', '📋'],
    ['txt', '📄'],
    ['csv', '📊'],
    ['parquet', '📊'],
    ['png', '🖼️'],
    ['jpg', '🖼️'],
    ['jpeg', '🖼️'],
    ['gif', '🖼️'],
    ['webp', '🖼️'],
    ['pdf', '📕'],
    ['zip', '📦'],
    ['tar', '📦'],
    ['gz', '📦'],
  ])('%s -> %s', (ext, icon) => {
    expect(getIconForExtension(ext)).toBe(icon);
  });

  it.each(['', 'unknown', 'toString', 'constructor', '__proto__', 'JSON'])(
    'falls back to the default icon for %j',
    (ext) => {
      expect(getIconForExtension(ext)).toBe(DEFAULT_FILE_ICON);
    }
  );
});
