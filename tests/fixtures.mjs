import sharp from 'sharp';
import { emptyDraft, emptyMeme, DEFAULT_LICENSE, makeManifest } from '../validation/submission-core.ts';
import { sha256 } from '../scripts/policy.mjs';

export const actor = { login: 'test-user', id: 42, type: 'User' };
export const materialId = 'a'.repeat(64);
export const policy = (open = true) => ({
  config: { version: 1, open },
  authors: [{ id: 'known', githubUserId: 42 }, { id: 'other', githubUserId: 43 }],
  materials: [{ id: materialId, authorIds: ['known', 'other'] }],
});
export const requestId = 'test-request';

export class MemoryReader {
  constructor(files) { this.files = files; this.overrides = new Map(); this.reads = 0; }
  async list(prefix) {
    return [...this.files].filter(([file]) => file.startsWith(prefix)).map(([file, bytes]) =>
      ({ path: file, mode: '100644', size: bytes.length, ...this.overrides.get(file) }));
  }
  async read(entry) { this.reads++; return this.files.get(entry.path); }
}

export async function fixture(kind = 'submission', { existing = false, meme = false, avatar = false } = {}) {
  const draft = emptyDraft();
  const png = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#256890' } }).png().toBuffer();
  const attachment = {
    id: '12345678-1234-4123-8123-123456789abc', path: 'files/12345678-1234-4123-8123-123456789abc.png',
    name: 'synthetic.png', bytes: png.length, width: 3, height: 2, sha256: sha256(png),
  };
  Object.assign(draft, { requestKind: kind, mode: existing || kind !== 'submission' ? 'existing' : 'new',
    githubLogin: actor.login, profile: { name: 'Synthetic fixture', tagline: '', bio: '', email: '', links: [] } });
  if (draft.mode === 'existing') {
    draft.authorId = 'known'; draft.baseline = structuredClone(draft.profile);
  }
  const blobs = new Map();
  if (kind === 'submission') {
    draft.works = [{ attachment, title: 'Synthetic fixture', category: '插画', tags: '', license: DEFAULT_LICENSE,
      source: '', creationMethod: '混合', note: 'Synthetic fixture, not a real submission', credits: ['@self'], createdDate: '', meme: null }];
    blobs.set(attachment.path, png);
    if (meme) {
      const source = await sharp({ create: { width: 2, height: 3, channels: 3, background: '#975373' } }).png().toBuffer();
      const a = { ...attachment, id: '22345678-1234-4123-8123-123456789abc',
        path: 'files/22345678-1234-4123-8123-123456789abc.png', name: 'source.png',
        bytes: source.length, width: 2, height: 3, sha256: sha256(source) };
      draft.works[0].meme = { ...emptyMeme(), attachment: a, description: 'Synthetic source' };
      blobs.set(a.path, source);
    }
  } else if (kind === 'profile-update') {
    draft.updateAuthor = true;
    if (!avatar) draft.profile.bio = 'Proposed synthetic biography';
  } else {
    draft.withdrawalIds = [materialId];
    draft.withdrawalReason = 'Synthetic request only';
  }
  if (avatar) {
    draft.avatarAction = 'replace'; draft.avatar = attachment;
    blobs.set(attachment.path, png);
  }
  const p = policy();
  const manifest = makeManifest(draft, p.authors.map((a) => a.id), p.materials);
  const prefix = `requests/${requestId}/`;
  const files = new Map([[prefix + 'submission.json', Buffer.from(JSON.stringify(manifest))],
    [prefix + 'PR.md', Buffer.from('Synthetic test fixture. Not a real request.')]]);
  for (const [name, bytes] of blobs) files.set(prefix + name, bytes);
  const reader = new MemoryReader(files);
  const rewrite = () => files.set(prefix + 'submission.json', Buffer.from(JSON.stringify(manifest)));
  return { draft, manifest, files, reader, rewrite, prefix, attachment, png };
}
