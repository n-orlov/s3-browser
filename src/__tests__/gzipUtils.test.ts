import { isGzipFile, getBaseExtension, compressGzip, decompressGzip, tryDecompressGzip } from '../main/services/gzipUtils';
import * as zlib from 'zlib';
import { promisify } from 'util';

const gzipAsync = promisify(zlib.gzip);

describe('gzipUtils', () => {
  describe('isGzipFile', () => {
    it('returns true for .gz files', () => {
      expect(isGzipFile('file.gz')).toBe(true);
      expect(isGzipFile('file.json.gz')).toBe(true);
      expect(isGzipFile('path/to/file.csv.gz')).toBe(true);
      expect(isGzipFile('FILE.GZ')).toBe(true);
      expect(isGzipFile('data.YAML.GZ')).toBe(true);
    });

    it('returns false for non-.gz files', () => {
      expect(isGzipFile('file.json')).toBe(false);
      expect(isGzipFile('file.csv')).toBe(false);
      expect(isGzipFile('file.txt')).toBe(false);
      expect(isGzipFile('file')).toBe(false);
      expect(isGzipFile('file.gzip')).toBe(false);
      expect(isGzipFile('gzfile')).toBe(false);
    });
  });

  describe('getBaseExtension', () => {
    it('returns extension before .gz for gzipped files', () => {
      expect(getBaseExtension('file.json.gz')).toBe('json');
      expect(getBaseExtension('file.csv.gz')).toBe('csv');
      expect(getBaseExtension('file.yaml.gz')).toBe('yaml');
      expect(getBaseExtension('file.yml.gz')).toBe('yml');
      expect(getBaseExtension('file.txt.gz')).toBe('txt');
      expect(getBaseExtension('path/to/data.JSON.GZ')).toBe('json');
    });

    it('returns extension for non-gzipped files', () => {
      expect(getBaseExtension('file.json')).toBe('json');
      expect(getBaseExtension('file.csv')).toBe('csv');
      expect(getBaseExtension('file.yaml')).toBe('yaml');
      expect(getBaseExtension('file.txt')).toBe('txt');
      expect(getBaseExtension('path/to/data.parquet')).toBe('parquet');
    });

    it('handles edge cases', () => {
      expect(getBaseExtension('file')).toBe('file');
      expect(getBaseExtension('.gz')).toBe('');
      expect(getBaseExtension('file.gz')).toBe('file');
      expect(getBaseExtension('')).toBe('');
    });
  });

  describe('compressGzip', () => {
    it('compresses string content to gzip buffer', async () => {
      const content = 'Hello, World!';
      const compressed = await compressGzip(content);

      expect(Buffer.isBuffer(compressed)).toBe(true);
      expect(compressed.length).toBeGreaterThan(0);

      // Verify it's valid gzip by decompressing
      const decompressed = zlib.gunzipSync(compressed);
      expect(decompressed.toString('utf-8')).toBe(content);
    });

    it('compresses JSON content correctly', async () => {
      const jsonContent = JSON.stringify({ name: 'test', value: 123 });
      const compressed = await compressGzip(jsonContent);

      const decompressed = zlib.gunzipSync(compressed);
      expect(decompressed.toString('utf-8')).toBe(jsonContent);
    });

    it('compresses empty string', async () => {
      const compressed = await compressGzip('');
      const decompressed = zlib.gunzipSync(compressed);
      expect(decompressed.toString('utf-8')).toBe('');
    });

    it('handles unicode content', async () => {
      const content = 'Hello, 世界! 🌍';
      const compressed = await compressGzip(content);

      const decompressed = zlib.gunzipSync(compressed);
      expect(decompressed.toString('utf-8')).toBe(content);
    });

    it('handles large content', async () => {
      const content = 'x'.repeat(100000);
      const compressed = await compressGzip(content);

      // Compressed should be smaller than original for repetitive data
      expect(compressed.length).toBeLessThan(content.length);

      const decompressed = zlib.gunzipSync(compressed);
      expect(decompressed.toString('utf-8')).toBe(content);
    });
  });

  describe('decompressGzip', () => {
    it('decompresses gzip buffer to string', async () => {
      const originalContent = 'Hello, World!';
      const compressed = await gzipAsync(Buffer.from(originalContent, 'utf-8'));

      const decompressed = await decompressGzip(compressed);
      expect(decompressed).toBe(originalContent);
    });

    it('decompresses JSON content correctly', async () => {
      const jsonContent = JSON.stringify({ key: 'value', number: 42 });
      const compressed = await gzipAsync(Buffer.from(jsonContent, 'utf-8'));

      const decompressed = await decompressGzip(compressed);
      expect(decompressed).toBe(jsonContent);
      expect(JSON.parse(decompressed)).toEqual({ key: 'value', number: 42 });
    });

    it('handles unicode content', async () => {
      const content = 'Привет, мир! 🎉';
      const compressed = await gzipAsync(Buffer.from(content, 'utf-8'));

      const decompressed = await decompressGzip(compressed);
      expect(decompressed).toBe(content);
    });

    it('throws on invalid gzip data', async () => {
      const invalidData = Buffer.from('not gzip data');

      await expect(decompressGzip(invalidData)).rejects.toThrow();
    });

    it('throws on truncated gzip data', async () => {
      const validCompressed = await gzipAsync(Buffer.from('test'));
      const truncated = validCompressed.slice(0, 5);

      await expect(decompressGzip(truncated)).rejects.toThrow();
    });
  });

  describe('tryDecompressGzip', () => {
    it('decompresses valid gzip data', async () => {
      const content = 'Hello, World!';
      const compressed = await gzipAsync(Buffer.from(content, 'utf-8'));

      const result = await tryDecompressGzip(compressed);
      expect(result).toBe(content);
    });

    it('returns original buffer as string for invalid gzip data', async () => {
      const invalidData = Buffer.from('plain text content');

      const result = await tryDecompressGzip(invalidData);
      expect(result).toBe('plain text content');
    });

    it('handles empty buffer', async () => {
      const emptyBuffer = Buffer.from('');
      const result = await tryDecompressGzip(emptyBuffer);
      expect(result).toBe('');
    });
  });

  describe('round-trip compression', () => {
    it('compresses and decompresses back to original', async () => {
      const testCases = [
        'Simple text',
        '{"json": "data", "number": 123}',
        'Line 1\nLine 2\nLine 3',
        'Special chars: <>&"\' \t\n',
        'Unicode: 你好世界 🚀',
        '', // empty string
      ];

      for (const original of testCases) {
        const compressed = await compressGzip(original);
        const decompressed = await decompressGzip(compressed);
        expect(decompressed).toBe(original);
      }
    });

    it('handles CSV content', async () => {
      const csvContent = 'header1,header2,header3\nvalue1,value2,value3\n"quoted,value","another",123';

      const compressed = await compressGzip(csvContent);
      const decompressed = await decompressGzip(compressed);

      expect(decompressed).toBe(csvContent);
    });

    it('handles YAML content', async () => {
      const yamlContent = `
name: test
version: 1.0
items:
  - item1
  - item2
enabled: true
`;

      const compressed = await compressGzip(yamlContent);
      const decompressed = await decompressGzip(compressed);

      expect(decompressed).toBe(yamlContent);
    });
  });
});
