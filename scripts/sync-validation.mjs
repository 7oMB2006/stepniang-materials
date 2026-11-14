import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const sources = [
  ['src/submission-core.ts', 'validation/submission-core.ts'],
  ['shared/profile.mjs', 'shared/profile.mjs'],
  ['shared/work-metadata.mjs', 'shared/work-metadata.mjs'],
  ['shared/meme-metadata.mjs', 'shared/meme-metadata.mjs'],
];
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--from') throw new Error('Usage: node scripts/sync-validation.mjs --from <site-root>');
const sourceRoot = path.resolve(args[1]);
if (sourceRoot === path.resolve(root)) throw new Error('The source must be the separate site workspace');
const files = [];
for (const [source, target] of sources) {
  const input = path.join(sourceRoot, source);
  const output = path.join(root, target);
  const bytes = Buffer.from(new TextDecoder('utf-8', { fatal: true }).decode(await readFile(input)).replace(/\r\n/g, '\n'));
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, bytes);
  files.push({ source, target, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await writeFile(path.join(root, 'validation/snapshot.json'), `${JSON.stringify({ version: 1, files }, null, 2)}\n`);
console.log('Copied only the four allowlisted protocol modules; review changes before committing.');
