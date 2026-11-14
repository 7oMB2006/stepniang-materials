import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluatePr } from '../scripts/check-pr.mjs';
import { git, GitReader } from '../scripts/git-reader.mjs';
import { actor, fixture, policy, requestId } from './fixtures.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
async function gitFixture(t, open) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'stepniang-intake-'));
  t.after(() => {
    const target = path.resolve(cwd);
    if (path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith('stepniang-intake-')) {
      throw new Error('Refusing cleanup outside the exact fixture parent and prefix');
    }
    return rm(target, { recursive: true, force: true, maxRetries: 3 });
  });
  for (const name of ['config', 'registry', 'validation', 'shared', '.gitattributes']) {
    await cp(path.join(root, name), path.join(cwd, name), { recursive: true });
  }
  const p = policy(open);
  await writeFile(path.join(cwd, 'config/intake.json'), JSON.stringify(p.config));
  await writeFile(path.join(cwd, 'registry/authors.json'), JSON.stringify(p.authors));
  await writeFile(path.join(cwd, 'registry/materials.json'), JSON.stringify(p.materials));
  git(cwd, ['init', '-b', 'main']);
  git(cwd, ['config', 'user.name', 'Synthetic test fixture']);
  git(cwd, ['config', 'user.email', 'fixture@example.invalid']);
  git(cwd, ['config', 'core.autocrlf', 'false']);
  git(cwd, ['add', '--', '.']);
  git(cwd, ['-c', 'core.hooksPath=', 'commit', '-m', 'Synthetic base']);
  const base = git(cwd, ['rev-parse', 'HEAD']).toString().trim();
  const f = await fixture('profile-update');
  for (const [name, bytes] of f.files) {
    const target = path.join(cwd, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  git(cwd, ['add', '--', 'requests']);
  git(cwd, ['-c', 'core.hooksPath=', 'commit', '-m', 'Synthetic request']);
  const head = git(cwd, ['rev-parse', 'HEAD']).toString().trim();
  git(cwd, ['switch', '--detach', base]);
  return { cwd, base, head, association: 'NONE', actor };
}

test('real Git blob reading validates a PR without checking out head files', async (t) => {
  const f = await gitFixture(t, true);
  const result = await evaluatePr(f);
  assert.equal(result.requestKind, 'profile-update');
  assert.equal(result.works, 0);
  assert.equal(git(f.cwd, ['rev-parse', 'HEAD']).toString().trim(), f.base);
  await assert.rejects(readFile(path.join(f.cwd, 'requests', requestId, 'submission.json')), /ENOENT/);
});
test('a PR cannot open intake by changing its own config alongside request data', async (t) => {
  const f = await gitFixture(t, false);
  git(f.cwd, ['switch', '--detach', f.head]);
  await writeFile(path.join(f.cwd, 'config/intake.json'), JSON.stringify({ version: 1, open: true }));
  git(f.cwd, ['add', '--', 'config/intake.json']);
  git(f.cwd, ['-c', 'core.hooksPath=', 'commit', '-m', 'Synthetic attempted bypass']);
  f.head = git(f.cwd, ['rev-parse', 'HEAD']).toString().trim();
  git(f.cwd, ['switch', '--detach', f.base]);
  await assert.rejects(evaluatePr({ ...f, association: 'OWNER' }), /mix/);
});
test('closed gate rejects a real PR even though its payload is otherwise valid', async (t) => {
  const f = await gitFixture(t, false);
  await assert.rejects(evaluatePr(f), /closed/);
});
test('candidate symlinks are rejected without following targets', async (t) => {
  const f = await gitFixture(t, true);
  git(f.cwd, ['switch', '--detach', f.head]);
  const oid = git(f.cwd, ['rev-parse', `${f.head}:requests/${requestId}/PR.md`]).toString().trim();
  git(f.cwd, ['update-index', '--cacheinfo', `120000,${oid},requests/${requestId}/PR.md`]);
  const tree = git(f.cwd, ['write-tree']).toString().trim();
  f.head = git(f.cwd, ['-c', 'commit.gpgsign=false', 'commit-tree', tree, '-p', f.head, '-m', 'Synthetic symlink mode']).toString().trim();
  // Keep the fixture worktree on its original ordinary files on both Windows and Linux.
  git(f.cwd, ['read-tree', 'HEAD']);
  git(f.cwd, ['switch', '--detach', f.base]);
  await assert.rejects(evaluatePr(f), /mode/);
});
test('a request cannot extend an existing merged directory, even with all-new paths', async (t) => {
  const f = await gitFixture(t, true);
  git(f.cwd, ['switch', '--detach', f.head]);
  f.base = f.head;
  const extra = path.join(f.cwd, 'requests', requestId, 'files', '22345678-1234-4123-8123-123456789abc.png');
  await mkdir(path.dirname(extra), { recursive: true }); await writeFile(extra, 'synthetic');
  git(f.cwd, ['add', '--', 'requests']);
  git(f.cwd, ['-c', 'core.hooksPath=', 'commit', '-m', 'Synthetic existing-directory append']);
  f.head = git(f.cwd, ['rev-parse', 'HEAD']).toString().trim();
  git(f.cwd, ['switch', '--detach', f.base]);
  await assert.rejects(evaluatePr(f), /already exists/);
});
test('GitReader rejects unvalidated refs and checkout must remain on trusted base', async (t) => {
  const f = await gitFixture(t, true);
  assert.throws(() => new GitReader(f.cwd, 'HEAD'), /SHA/);
  await assert.rejects(new GitReader(f.cwd, f.head).list('../'));
  git(f.cwd, ['switch', '--detach', f.head]);
  await assert.rejects(evaluatePr(f), /base SHA/);
});
test('maintainer infrastructure PRs are classified without executing candidate scripts', async (t) => {
  const f = await gitFixture(t, false);
  git(f.cwd, ['switch', '--detach', f.base]);
  await mkdir(path.join(f.cwd, 'scripts'), { recursive: true });
  await writeFile(path.join(f.cwd, 'scripts', 'candidate.mjs'), 'throw new Error("must never execute")');
  git(f.cwd, ['add', '--', 'scripts']);
  git(f.cwd, ['-c', 'core.hooksPath=', 'commit', '-m', 'Synthetic infrastructure candidate']);
  f.head = git(f.cwd, ['rev-parse', 'HEAD']).toString().trim();
  git(f.cwd, ['switch', '--detach', f.base]);
  const result = await evaluatePr({ ...f, association: 'OWNER' });
  assert.deepEqual(result, { kind: 'infrastructure', requiresHumanReview: true, candidateCodeExecuted: false });
  await assert.rejects(readFile(path.join(f.cwd, 'scripts', 'candidate.mjs')), /ENOENT/);
});
