import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { loadPolicy, readJson, sha256 } from './policy.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export async function checkRepository(directory = root) {
  const policy = await loadPolicy(directory);
  const snapshot = await readJson(path.join(directory, 'validation/snapshot.json'));
  const expected = new Map([
    ['validation/submission-core.ts', 'src/submission-core.ts'],
    ['shared/profile.mjs', 'shared/profile.mjs'],
    ['shared/work-metadata.mjs', 'shared/work-metadata.mjs'],
    ['shared/meme-metadata.mjs', 'shared/meme-metadata.mjs'],
  ]);
  if (snapshot.version !== 1 || !Array.isArray(snapshot.files) || snapshot.files.length !== expected.size) throw new Error('Invalid protocol snapshot');
  for (const file of snapshot.files) {
    if (expected.get(file.target) !== file.source || !/^[a-f0-9]{64}$/.test(file.sha256)
      || sha256(await readFile(path.join(directory, file.target))) !== file.sha256) throw new Error('Protocol snapshot drift: resync and review all changed modules');
    expected.delete(file.target);
  }
  if (expected.size) throw new Error('Incomplete snapshot');
  return { intakeOpen: policy.config.open, authors: policy.authors.length, materials: policy.materials.length, protocolFiles: snapshot.files.length };
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { console.log(JSON.stringify(await checkRepository())); }
  catch (error) { console.error(JSON.stringify({ error: error.message })); process.exitCode = 1; }
}
