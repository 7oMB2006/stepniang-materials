import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { classifyChanges, loadPolicy, readJson, validateRequest } from './policy.mjs';
import { changesBetween, commit, git, GitReader } from './git-reader.mjs';
import { checkRepository } from './check-repository.mjs';

export async function evaluatePr({ cwd, base, head, association, actor }) {
  commit(base); commit(head);
  if (git(cwd, ['rev-parse', 'HEAD']).toString().trim() !== base) throw new Error('Policy checkout is not the event base SHA');
  await checkRepository(cwd);
  const policy = await loadPolicy(cwd);
  const changes = changesBetween(cwd, base, head);
  const classification = classifyChanges(changes, association, policy.config);
  if (classification.kind === 'infrastructure') {
    return { kind: 'infrastructure', requiresHumanReview: true, candidateCodeExecuted: false };
  }
  const prefix = `requests/${classification.id}/`;
  if ((await new GitReader(cwd, base).list(prefix)).length) throw new Error('Request directory already exists on base');
  return { kind: 'request', ...await validateRequest(new GitReader(cwd, head), classification.id, policy, actor) };
}

async function main() {
  if (process.env.GITHUB_EVENT_NAME !== 'pull_request_target') throw new Error('Only pull_request_target is supported');
  const event = await readJson(process.env.GITHUB_EVENT_PATH, 2 * 1024 * 1024);
  const pr = event.pull_request;
  if (event.repository?.full_name !== '7oMB2006/stepniang-materials'
    || pr?.base?.repo?.full_name !== event.repository.full_name
    || !Number.isSafeInteger(event.number) || event.number < 1 || pr.number !== event.number) throw new Error('Unexpected PR event');
  const base = commit(pr.base.sha);
  const head = commit(pr.head?.sha);
  const cwd = fileURLToPath(new URL('../', import.meta.url));
  const remote = git(cwd, ['remote', 'get-url', 'origin']).toString().trim();
  if (remote !== 'https://github.com/7oMB2006/stepniang-materials'
    && remote !== 'https://github.com/7oMB2006/stepniang-materials.git') throw new Error('Unexpected origin');
  const ref = `refs/intake/${event.number}`;
  git(cwd, ['-c', 'protocol.file.allow=never', 'fetch', '--no-tags', '--depth=1', 'origin',
    `+refs/pull/${event.number}/head:${ref}`]);
  if (git(cwd, ['rev-parse', ref]).toString().trim() !== head) throw new Error('PR changed while fetching; rerun the check');
  console.log(JSON.stringify(await evaluatePr({ cwd, base, head, association: pr.author_association, actor: pr.user })));
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { await main(); }
  catch (error) { console.error(JSON.stringify({ error: error.message })); process.exitCode = 1; }
}
