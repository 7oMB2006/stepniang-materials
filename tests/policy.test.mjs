import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { classifyChanges, parseDiff, validatePolicy, validateRequest, validateImage, sha256, loadPolicy } from '../scripts/policy.mjs';
import { checkRepository } from '../scripts/check-repository.mjs';
import { actor, fixture, policy, requestId, materialId } from './fixtures.mjs';

const changes = (paths) => paths.map((path) => ({ status: 'A', path }));
const validChanges = changes([`requests/${requestId}/submission.json`, `requests/${requestId}/PR.md`]);
test('open intake uses the minimal registries and a complete protocol snapshot', async () => {
  assert.deepEqual(await checkRepository(), { intakeOpen: true, authors: 1, materials: 65, protocolFiles: 4 });
  const p = await loadPolicy(fileURLToPath(new URL('../', import.meta.url)));
  assert.deepEqual(p.authors, [{ id: '7omb', githubUserId: 220543171 }]);
  assert.equal(p.materials.filter((item) => !item.authorIds.length).length, 2);
  assert.ok(p.materials.every((item) => !item.id.startsWith('official-early:')));
  assert.ok(p.materials.every((item) => item.authorIds.length === 0 || item.authorIds.every((id) => id === '7omb')));
});
test('closed switch rejects new requests for owners too, before reading candidate content', async () => {
  assert.throws(() => classifyChanges(validChanges, 'OWNER', { open: false }), /closed/);
  const { reader } = await fixture();
  await assert.rejects(validateRequest(reader, requestId, policy(false), actor), /closed/);
  assert.equal(reader.reads, 0);
});
test('infrastructure is maintainer-led and never mixed into request PRs', () => {
  assert.equal(classifyChanges(changes(['README.md']), 'OWNER', { open: false }).kind, 'infrastructure');
  assert.throws(() => classifyChanges(changes(['README.md']), 'NONE', { open: false }), /maintainer/);
  assert.throws(() => classifyChanges([...validChanges, ...changes(['config/intake.json'])], 'OWNER', { open: true }), /mix/);
});
test('one fresh request permits only bounded, safe newly added paths', () => {
  assert.deepEqual(classifyChanges(validChanges, 'NONE', { open: true }), { kind: 'request', id: requestId });
  for (const input of [
    [], [{ status: 'M', path: validChanges[0].path }], [{ status: 'D', path: validChanges[0].path }],
    [...validChanges, ...changes(['requests/second/PR.md'])],
    changes(['requests/../PR.md']), changes(['requests/UPPER/PR.md']), changes(['requests/test/evil.js']),
    changes(['requests/test/submission.zip']), changes(['requests/.gitkeep']),
    [...validChanges, validChanges[0]], Array.from({ length: 52 }, () => validChanges[0]),
  ]) assert.throws(() => classifyChanges(input, 'NONE', { open: true }));
});
test('NUL-delimited parsing does not split filenames into shell or line commands', () => {
  assert.deepEqual(parseDiff(Buffer.from('A\0requests/test/PR.md\0')), [{ status: 'A', path: 'requests/test/PR.md' }]);
  assert.throws(() => parseDiff(Buffer.from('A\tbad\n')), /diff/);
  assert.throws(() => classifyChanges(parseDiff(Buffer.from('A\0requests/test/PR.md\n::error::bad\0')), 'NONE', { open: true }));
});
test('registry accepts numeric IDs and namespace-separated material IDs, rejects forged or unknown fields', () => {
  const p = policy();
  assert.equal(validatePolicy(p.config, p.authors, p.materials).authors.length, 2);
  assert.doesNotThrow(() => validatePolicy(p.config, p.authors, [{ id: `official-early:${materialId}`, authorIds: ['known'] }]));
  for (const authors of [
    [{ githubUserId: 42 }], [{ id: 123, githubUserId: 42 }], [{ id: 'known', githubUserId: '42' }],
    [{ id: 'known', githubUserId: 42, email: 'not-allowed@example.invalid' }], [p.authors[0], p.authors[0]],
  ]) assert.throws(() => validatePolicy(p.config, authors, []));
  assert.throws(() => validatePolicy(p.config, p.authors, [{ id: materialId, authorIds: ['missing'] }]));
  assert.throws(() => validatePolicy({ version: 1, open: 'false' }, [], []));
});
test('v1 and v2 requests validate images without turning sources into works', async () => {
  for (const meme of [false, true]) {
    const { reader, manifest } = await fixture('submission', { meme });
    const result = await validateRequest(reader, requestId, policy(), actor);
    assert.equal(manifest.version, meme ? 2 : 1);
    assert.equal(result.works, 1);
    assert.equal(result.attachments, meme ? 2 : 1);
    assert.equal(result.requiresHumanReview, true);
    assert.equal(result.bindingStatus, 'unverified');
  }
});
test('v3 profile-only and avatar-only changes need no new work', async () => {
  for (const avatar of [false, true]) {
    const { reader, manifest } = await fixture('profile-update', { avatar });
    const result = await validateRequest(reader, requestId, policy(), actor);
    assert.equal(manifest.version, 3);
    assert.equal(result.works, 0);
    assert.equal(result.attachments, avatar ? 1 : 0);
  }
});
test('v3 collaborator withdrawal is only an application and never mutates registry or deletes files', async () => {
  const { reader } = await fixture('withdrawal');
  const p = policy();
  const before = structuredClone(p);
  const result = await validateRequest(reader, requestId, p, actor);
  assert.equal(result.targets, 1);
  assert.equal(result.attachments, 0);
  assert.equal(result.requiresHumanReview, true);
  assert.deepEqual(p, before);
  assert.equal(reader.files.size, 2);
});
test('claim match does not substitute for numeric existing-author binding', async () => {
  const { reader } = await fixture('profile-update');
  for (const person of [{ ...actor, login: 'someone-else' }, { ...actor, id: 99 }, { ...actor, type: 'Bot' }]) {
    await assert.rejects(validateRequest(reader, requestId, policy(), person), /GitHub|human/);
  }
  const p = policy(); p.authors[0].githubUserId = null;
  await assert.rejects(validateRequest(reader, requestId, p, actor), /binding/);
  assert.equal((await validateRequest(reader, requestId, policy(), { ...actor, login: 'TEST-USER' })).requestKind, 'profile-update');
});
test('stale, foreign and duplicate withdrawal targets are rejected', async () => {
  for (const targets of [[], ['b'.repeat(64)], [materialId, materialId]]) {
    const { reader, manifest, rewrite } = await fixture('withdrawal');
    manifest.public.withdrawalIds = targets; rewrite();
    await assert.rejects(validateRequest(reader, requestId, policy(), actor));
  }
  const { reader } = await fixture('withdrawal');
  const p = policy(); p.materials[0].authorIds = ['other'];
  await assert.rejects(validateRequest(reader, requestId, p, actor), /撤下目标/);
});
test('strict schema rejects verification, role, version and mixed-request smuggling', async () => {
  for (const mutate of [
    (m) => { m.review.bindingStatus = 'verified'; },
    (m) => { m.public.author.profile.role = 'webmaster'; },
    (m) => { m.version = 1; },
    (m) => { m.public.author.avatarAction = 'remove'; m.public.author.updateProfile = false; },
    (m) => { m.public.withdrawalIds = [materialId]; },
    (m) => { m.public.author.changes = []; },
  ]) {
    const { reader, manifest, rewrite } = await fixture('profile-update');
    mutate(manifest); rewrite();
    await assert.rejects(validateRequest(reader, requestId, policy(), actor));
  }
});
test('missing, unreferenced, unsafe-mode and oversized entries fail before decoding', async () => {
  for (const modify of [
    ({ files, prefix }) => files.delete(prefix + 'PR.md'),
    ({ files, prefix }) => files.set(prefix + 'extra.js', Buffer.from('throw 1')),
    ({ reader, prefix }) => reader.overrides.set(prefix + 'submission.json', { mode: '120000' }),
    ({ reader, prefix }) => reader.overrides.set(prefix + 'submission.json', { mode: '100755' }),
    ({ reader, prefix }) => reader.overrides.set(prefix + 'submission.json', { size: 1024 * 1024 + 1 }),
    ({ files, prefix }) => files.set(prefix + 'PR.md', Buffer.alloc(0)),
  ]) {
    const f = await fixture(); modify(f);
    await assert.rejects(validateRequest(f.reader, requestId, policy(), actor));
  }
  const f = await fixture();
  f.files.delete(f.prefix + f.attachment.path);
  await assert.rejects(validateRequest(f.reader, requestId, policy(), actor));
});
test('file bytes, real signatures, hashes and full image decode are checked', async () => {
  const f = await fixture();
  for (const attachment of [
    { ...f.attachment, sha256: 'f'.repeat(64) },
    { ...f.attachment, bytes: f.png.length + 1 },
    { ...f.attachment, width: 9 },
    { ...f.attachment, path: f.attachment.path.replace('.png', '.webp') },
  ]) await assert.rejects(validateImage(f.png, attachment));
  const corrupt = f.png.subarray(0, 32);
  await assert.rejects(validateImage(corrupt, { ...f.attachment, bytes: corrupt.length, sha256: sha256(corrupt) }));
});
test('EXIF orientation is decoded consistently with browser-oriented image dimensions', async () => {
  const bytes = await sharp({ create: { width: 2, height: 3, channels: 3, background: '#236787' } })
    .withMetadata({ orientation: 6 }).jpeg().toBuffer();
  await assert.doesNotReject(validateImage(bytes, { path: 'files/test.jpg', width: 3, height: 2, bytes: bytes.length, sha256: sha256(bytes) }));
});
