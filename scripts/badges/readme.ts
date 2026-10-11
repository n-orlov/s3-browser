// `npm run badges:readme`: rewrites the marker-delimited badge block at the top of README.md from the badge list in
// readmeBlock.ts and package.json. Everything outside the markers is left byte for byte as it was.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readmeBadgeBlock, replaceBadgeBlock } from './readmeBlock.ts';

try {
  const root = process.cwd();
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as unknown;
  const file = path.join(root, 'README.md');
  writeFileSync(file, replaceBadgeBlock(readFileSync(file, 'utf8'), readmeBadgeBlock(pkg)));
  console.log('badges: README.md badge block updated');
} catch (error) {
  console.error(`badges: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
