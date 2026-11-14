import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { fields } from '../shared/profile.mjs';
import { LIMITS, readManifest, workAttachments } from '../validation/submission-core.ts';

export const REQUEST_PATH = /^requests\/([a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)\/(submission\.json|PR\.md|files\/[a-f0-9-]{36}\.(?:png|jpg|webp))$/;
const AUTHOR_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MATERIAL_ID = /^(?:official-early:)?[a-f0-9]{64}$/;
const trustedAssociations = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export async function readJson(file, maxBytes = LIMITS.jsonBytes) {
  const bytes = await readFile(file);
  if (bytes.length > maxBytes) throw new Error('Policy JSON is too large');
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

export function validatePolicy(config, authors, materials) {
  fields(config, new Set(['version', 'open']), 'intake');
  if (config.version !== 1 || typeof config.open !== 'boolean') throw new Error('Invalid intake switch');
  if (!Array.isArray(authors) || authors.length > 10000 || !Array.isArray(materials) || materials.length > 100000) throw new Error('Invalid registry');
  const authorIds = new Set();
  for (const author of authors) {
    fields(author, new Set(['id', 'githubUserId']), 'registry author');
    if (typeof author.id !== 'string' || !AUTHOR_ID.test(author.id) || authorIds.has(author.id)
      || !(author.githubUserId === null || Number.isSafeInteger(author.githubUserId) && author.githubUserId > 0)) throw new Error('Invalid author or GitHub numeric binding');
    authorIds.add(author.id);
  }
  const materialIds = new Set();
  for (const material of materials) {
    fields(material, new Set(['id', 'authorIds']), 'registry material');
    if (typeof material.id !== 'string' || !MATERIAL_ID.test(material.id) || materialIds.has(material.id) || !Array.isArray(material.authorIds)
      || material.authorIds.length > 30 || new Set(material.authorIds).size !== material.authorIds.length
      || material.authorIds.some((id) => !authorIds.has(id))) throw new Error('Invalid material or credit reference');
    materialIds.add(material.id);
  }
  return { config, authors, materials };
}

export async function loadPolicy(root) {
  return validatePolicy(
    await readJson(path.join(root, 'config/intake.json')),
    await readJson(path.join(root, 'registry/authors.json'), 4 * LIMITS.jsonBytes),
    await readJson(path.join(root, 'registry/materials.json'), 16 * LIMITS.jsonBytes),
  );
}

export function classifyChanges(changes, association, config) {
  if (!Array.isArray(changes) || !changes.length || changes.length > 512) throw new Error('Empty or excessive PR change set');
  const requestChanges = changes.filter((change) => change.path === 'requests' || change.path.startsWith('requests/'));
  if (!requestChanges.length) {
    if (!trustedAssociations.has(association)) throw new Error('Infrastructure changes need a maintainer-led PR');
    return { kind: 'infrastructure' };
  }
  if (requestChanges.length !== changes.length) throw new Error('Do not mix requests and infrastructure changes');
  if (!config.open) throw new Error('投稿暂未开放：request intake is closed');
  if (changes.length > LIMITS.files * 2 + 3) throw new Error('Too many request files');
  const requestIds = new Set();
  const paths = new Set();
  for (const change of changes) {
    const match = REQUEST_PATH.exec(change.path);
    if (change.status !== 'A' || !match || paths.has(change.path)) throw new Error('Only new, safe request files are allowed');
    requestIds.add(match[1]); paths.add(change.path);
  }
  if (requestIds.size !== 1) throw new Error('One request directory per PR');
  return { kind: 'request', id: [...requestIds][0] };
}

export function parseDiff(bytes) {
  const parts = new TextDecoder('utf-8', { fatal: true }).decode(bytes).split('\0');
  if (parts.pop() !== '' || parts.length % 2) throw new Error('Invalid NUL-delimited Git diff');
  return Array.from({ length: parts.length / 2 }, (_, i) => ({ status: parts[i * 2], path: parts[i * 2 + 1] }));
}

export function attachmentsFor(draft) {
  return [
    ...draft.works.flatMap(workAttachments),
    ...(draft.requestKind !== 'withdrawal' && (draft.mode === 'new' || draft.updateAuthor)
      && draft.avatarAction === 'replace' && draft.avatar ? [draft.avatar] : []),
  ];
}

function signature(bytes) {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n)) return 'png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpg';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  throw new Error('Attachment is not a supported image');
}

export async function validateImage(bytes, attachment) {
  if (bytes.length !== attachment.bytes || sha256(bytes) !== attachment.sha256
    || !attachment.path.endsWith(`.${signature(bytes)}`)) throw new Error('Attachment bytes, signature or checksum mismatch');
  const decoder = sharp(bytes, { limitInputPixels: 64 * 1024 * 1024, failOn: 'warning' });
  const metadata = await decoder.metadata();
  if (!['png', 'jpeg', 'webp'].includes(metadata.format) || metadata.width > 16384 || metadata.height > 16384) throw new Error('Unsupported image dimensions or format');
  const { info } = await decoder.autoOrient().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== attachment.width || info.height !== attachment.height) throw new Error('Decoded image dimensions mismatch');
}

export async function validateRequest(reader, id, policy, actor) {
  if (!policy.config.open) throw new Error('投稿暂未开放：request intake is closed');
  const prefix = `requests/${id}/`;
  const entries = await reader.list(prefix);
  if (entries.length < 2 || entries.length > LIMITS.files * 2 + 3) throw new Error('Invalid request file count');
  const byPath = new Map();
  let total = 0;
  for (const entry of entries) {
    const match = REQUEST_PATH.exec(entry.path);
    const limit = entry.path.startsWith(`${prefix}files/`) ? LIMITS.fileBytes : LIMITS.jsonBytes;
    if (!match || match[1] !== id || entry.mode !== '100644' || byPath.has(entry.path)
      || !Number.isSafeInteger(entry.size) || entry.size < 1 || entry.size > limit) throw new Error('Unsafe request entry, mode or size');
    total += entry.size;
    if (total > LIMITS.totalBytes + 2 * LIMITS.jsonBytes) throw new Error('Request exceeds total byte limit');
    byPath.set(entry.path, entry);
  }
  const manifestEntry = byPath.get(`${prefix}submission.json`);
  if (!manifestEntry || !byPath.has(`${prefix}PR.md`)) throw new Error('Missing submission.json or PR.md');
  const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await reader.read(manifestEntry)));
  const draft = readManifest(manifest, policy.authors.map((author) => author.id), policy.materials);
  if (!actor || typeof actor.login !== 'string' || !Number.isSafeInteger(actor.id) || actor.id < 1
    || actor.type !== 'User' || draft.githubLogin.toLowerCase() !== actor.login.toLowerCase()) throw new Error('GitHub claim does not match the human PR author');
  if (draft.mode === 'existing' && policy.authors.find((author) => author.id === draft.authorId)?.githubUserId !== actor.id) {
    throw new Error('Existing author requires a maintainer-verified numeric GitHub binding');
  }
  const attachments = attachmentsFor(draft);
  const expected = new Set([`${prefix}submission.json`, `${prefix}PR.md`, ...attachments.map((a) => prefix + a.path)]);
  if (expected.size !== entries.length || entries.some((entry) => !expected.has(entry.path))) throw new Error('Unexpected or unreferenced files');
  for (const attachment of attachments) {
    const entry = byPath.get(prefix + attachment.path);
    if (!entry || entry.size !== attachment.bytes) throw new Error('Missing attachment or declared size mismatch');
    await validateImage(await reader.read(entry), attachment);
  }
  return { requestKind: draft.requestKind, works: draft.works.length, targets: draft.withdrawalIds.length,
    attachments: attachments.length, bindingStatus: 'unverified', requiresHumanReview: true };
}
