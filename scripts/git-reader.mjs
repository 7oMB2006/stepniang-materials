import { execFileSync } from 'node:child_process';
import { parseDiff } from './policy.mjs';

export function git(cwd, args, maxBuffer = 2 * 1024 * 1024) {
  return execFileSync('git', ['--no-replace-objects', ...args], {
    cwd, maxBuffer, timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
}
export function commit(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{40}$/.test(value)) throw new Error('Invalid Git commit SHA');
  return value;
}
export class GitReader {
  constructor(cwd, ref) { this.cwd = cwd; this.ref = commit(ref); }
  async list(prefix) {
    if (typeof prefix !== 'string' || !/^requests\/[a-z0-9-]+\/$/.test(prefix)) throw new Error('Invalid request prefix');
    const listing = new TextDecoder('utf-8', { fatal: true }).decode(git(this.cwd,
      ['ls-tree', '-r', '-l', '-z', '--full-tree', this.ref, '--', prefix]));
    return listing.split('\0').filter(Boolean).map((row) => {
      const match = /^(\d{6}) (blob|commit) ([a-f0-9]{40}) +(\d+|-)\t([\s\S]+)$/.exec(row);
      if (!match) throw new Error('Invalid Git tree entry');
      return { mode: match[1], oid: match[3], size: Number(match[4]), path: match[5] };
    });
  }
  async read(entry) {
    commit(entry.oid);
    const bytes = git(this.cwd, ['cat-file', 'blob', entry.oid], entry.size + 1);
    if (bytes.length !== entry.size) throw new Error('Git blob size mismatch');
    return bytes;
  }
}
export function changesBetween(cwd, base, head) {
  return parseDiff(git(cwd, ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-status', '-z',
    commit(base), commit(head), '--']));
}
