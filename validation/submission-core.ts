import { fields, prepareEmail, prepareLinks, stringField } from '../shared/profile.mjs';
import { workDate } from '../shared/work-metadata.mjs';
import { prepareMemeCaption } from '../shared/meme-metadata.mjs';

export const DEFAULT_LICENSE = 'CC BY-NC-SA 4.0';
export const LIMITS = { files: 24, fileBytes: 20 * 1024 * 1024, totalBytes: 100 * 1024 * 1024, jsonBytes: 1024 * 1024 };
export const CREATION_METHODS = ['手绘', 'AI 辅助', 'AI 生成', '混合', '其他'] as const;
export const WORK_CATEGORIES = ['设定图', '插画', '表情包'] as const;
export const PROFILE_KEYS = ['name', 'tagline', 'bio', 'email', 'links'] as const;
export const REQUEST_KINDS = ['submission', 'profile-update', 'withdrawal'] as const;
export type RequestKind = typeof REQUEST_KINDS[number];
export type RequestMaterial = { id: string; authorIds: readonly string[] };
export const REQUEST_LABELS: Record<RequestKind, string> = {
  submission: '投稿作品', 'profile-update': '修改作者资料', withdrawal: '申请撤下作品',
};
export type Profile = { name: string; tagline: string; bio: string; email: string; links: { label: string; url: string }[] };
export type Attachment = { id: string; path: string; name: string; bytes: number; width: number; height: number; sha256: string };
export type MemeAddon = { attachment: Attachment | null; title: string; description: string; credit: string; url: string };
export type Work = { attachment: Attachment; title: string; category: string; tags: string; license: string; source: string; creationMethod: string; note: string; credits: string[]; createdDate: string; meme: MemeAddon | null };
export type Draft = {
  requestKind: RequestKind; withdrawalIds: string[]; withdrawalReason: string;
  mode: 'existing' | 'new'; authorId: string; githubLogin: string; updateAuthor: boolean;
  profile: Profile; baseline: Profile | null; avatar: Attachment | null; avatarAction: 'keep' | 'replace' | 'remove';
  works: Work[];
};
export type Issue = { step: number; workId?: string; message: string };
export const emptyProfile = (): Profile => ({ name: '', tagline: '', bio: '', email: '', links: [] });
export const emptyMeme = (): MemeAddon => ({ attachment: null, title: '', description: '', credit: '', url: '' });
export const workAttachments = (work: Work): Attachment[] => [
  work.attachment, ...(work.meme?.attachment ? [work.meme.attachment] : []),
];
function normalizeMeme(value: unknown) {
  fields(value, new Set(['attachment', 'title', 'description', 'credit', 'url']), '梗图附加信息');
  const meme = value as MemeAddon;
  if (!meme.attachment) throw new Error('请添加梗来源图片，或关闭梗图附加信息');
  return { attachment: { ...readAttachment(meme.attachment) },
    ...prepareMemeCaption({ title: meme.title, description: meme.description, credit: meme.credit, url: meme.url }) };
}
export const emptyDraft = (): Draft => ({
  requestKind: 'submission', withdrawalIds: [], withdrawalReason: '',
  mode: 'existing', authorId: '', githubLogin: '', updateAuthor: false, profile: emptyProfile(),
  baseline: null, avatar: null, avatarAction: 'keep', works: [],
});
export function profileFrom(author: { name: string; tagline: string | null; bio: string | null; email: string | null; links: { label: string; url: string }[] }): Profile {
  return { name: author.name, tagline: author.tagline ?? '', bio: author.bio ?? '', email: author.email ?? '',
    links: author.links.map(({ label, url }) => ({ label, url })) };
}
export function normalizeProfile(profile: Profile): Profile {
  fields(profile, new Set(PROFILE_KEYS), '作者资料');
  const record = profile as unknown as Record<string, unknown>;
  const name = stringField(record, 'name', '作者资料', 80);
  if (!name) throw new Error('请填写作者名称');
  if (profile.links.length > 20) throw new Error('链接总数不能超过 20 个');
  return { name, tagline: stringField(record, 'tagline', '作者资料', 160) ?? '',
    bio: stringField(record, 'bio', '作者资料', 2000, true) ?? '', email: prepareEmail(record, '作者资料') ?? '',
    links: prepareLinks(record, '作者资料').map(({ label, url }) => ({ label, url })) };
}
export function githubLogin(value: string): string {
  let login = value.trim().replace(/^@/, '');
  if (/^https?:\/\//i.test(login)) {
    const url = new URL(login);
    if (!['github.com', 'www.github.com'].includes(url.hostname) || url.port || url.username || url.password
      || url.search || url.hash || !/^\/[^/]+\/?$/.test(url.pathname)) throw new Error('请填写 GitHub 用户名或个人主页地址');
    login = url.pathname.replaceAll('/', '');
  }
  if (!/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i.test(login) || login.includes('--')) {
    throw new Error('请填写有效的 GitHub 用户名');
  }
  return login;
}
export function parseTags(input: string): string[] {
  const tags = [...new Set(input.split(/[,，\n]/).map((tag) => tag.trim()).filter(Boolean))];
  if (tags.length > 10 || tags.some((tag) => [...tag].length > 20 || /[\u0000-\u001f\u007f]/.test(tag))) {
    throw new Error('标签最多 10 个，每个最多 20 字');
  }
  return tags;
}
function bounded(value: string, label: string, max: number, required = false, multiline = false): string {
  const result = stringField({ value }, 'value', label, max, multiline) ?? '';
  if (required && !result) throw new Error(`请填写${label}`);
  return result;
}
function sourceUrl(value: string): string {
  const text = bounded(value, '来源链接', 2048);
  if (!text) return '';
  try {
    const url = new URL(text);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || /\s|\\/.test(text)) throw new Error();
    return url.href;
  } catch { throw new Error('来源链接须为完整的 HTTP(S) 地址，不含账号密码'); }
}
export function profileChanges(before: Profile | null, after: Profile) {
  if (!before) return [];
  const baseline = normalizeProfile(before);
  const proposed = normalizeProfile(after);
  return PROFILE_KEYS.filter((key) => JSON.stringify(baseline[key]) !== JSON.stringify(proposed[key]))
    .map((field) => ({ field, before: baseline[field], after: proposed[field] }));
}
export function validateDraft(draft: Draft, authorIds: string[], materials: readonly RequestMaterial[] = []): Issue[] {
  const issues: Issue[] = [];
  const test = (step: number, action: () => void, workId?: string) => {
    try { action(); } catch (error) { issues.push({ step, workId, message: error instanceof Error ? error.message : '资料无效' }); }
  };
  test(0, () => { githubLogin(draft.githubLogin); });
  test(0, () => {
    if (!REQUEST_KINDS.includes(draft.requestKind)) throw new Error('申请类型无效');
    if (draft.requestKind !== 'submission' && draft.mode !== 'existing') throw new Error('修改与撤下申请须选择已有作者');
    if (draft.mode === 'existing' && (!authorIds.includes(draft.authorId) || !draft.baseline)) throw new Error('请选择有效的站内作者');
    if (draft.mode === 'new' || draft.updateAuthor) normalizeProfile(draft.profile);
    if (draft.avatarAction === 'replace' && !draft.avatar) throw new Error('请重新选择头像');
  });
  test(1, () => {
    if (draft.requestKind !== 'submission' && draft.works.length) throw new Error('此类申请不能附带新作品');
    if (draft.requestKind === 'profile-update') {
      if (!draft.updateAuthor) throw new Error('资料修改申请必须包含作者资料变更');
      if (!profileChanges(draft.baseline, draft.profile).length && draft.avatarAction === 'keep') throw new Error('作者资料尚无实际变更');
    }
    if (draft.requestKind === 'withdrawal') {
      if (draft.updateAuthor || draft.avatarAction !== 'keep' || draft.avatar) throw new Error('撤下申请不能同时修改作者资料或头像');
      if (!draft.withdrawalIds.length || draft.withdrawalIds.length > 100 || new Set(draft.withdrawalIds).size !== draft.withdrawalIds.length) {
        throw new Error('请选择 1 至 100 件不重复的撤下作品');
      }
      for (const id of draft.withdrawalIds) {
        const item = materials.find((material) => material.id === id);
        if (!item || !item.authorIds.includes(draft.authorId)) throw new Error('撤下目标须为当前清单中有本次作者署名的作品，请重新核对');
      }
      bounded(draft.withdrawalReason, '撤下理由', 2000, false, true);
    } else if (draft.withdrawalIds.length || draft.withdrawalReason) throw new Error('非撤下申请不能附带撤下目标或理由');
  });
  if (draft.requestKind === 'submission' && !draft.works.length) issues.push({ step: 1, message: '请至少添加一件作品' });
  if (draft.works.length > LIMITS.files) issues.push({ step: 1, message: `每包最多 ${LIMITS.files} 件作品` });
  const total = draft.works.flatMap(workAttachments).reduce((sum, attachment) => sum + attachment.bytes, 0)
    + ((draft.mode === 'new' || draft.updateAuthor) && draft.avatarAction === 'replace' ? draft.avatar?.bytes ?? 0 : 0);
  if (total > LIMITS.totalBytes) issues.push({ step: 1, message: '附件总大小不能超过 100 MiB' });
  const usedPaths = new Set<string>();
  const usedIds = new Set<string>();
  const claimAttachment = (attachment: Attachment) => {
    readAttachment(attachment);
    if (usedPaths.has(attachment.path) || usedIds.has(attachment.id)) throw new Error('附件不能被作品、梗来源或头像重复引用');
    usedPaths.add(attachment.path); usedIds.add(attachment.id);
  };
  for (const work of draft.works) {
    const id = work.attachment.id;
    test(1, () => { workAttachments(work).forEach(claimAttachment); }, id);
    test(1, () => {
      if (work.meme != null) {
        const meme = normalizeMeme(work.meme);
        if (meme.attachment.sha256 === work.attachment.sha256) throw new Error('梗来源图片不能与作品本身相同');
      }
    }, id);
    test(1, () => { bounded(work.title, '作品标题', 80, true); }, id);
    test(1, () => { if (!(WORK_CATEGORIES as readonly string[]).includes(work.category)) throw new Error('请选择作品分类'); }, id);
    test(1, () => { parseTags(work.tags); }, id);
    test(1, () => { workDate(work.createdDate); }, id);
    test(1, () => { bounded(work.license, '使用许可', 200, true); }, id);
    test(1, () => { sourceUrl(work.source); bounded(work.note, '审核备注', 2000, false, true); }, id);
    test(1, () => { if (!(CREATION_METHODS as readonly string[]).includes(work.creationMethod)) throw new Error('请选择创作方式（仅供审核，不作为投稿门槛）'); }, id);
    test(1, () => {
      if (!work.credits.includes('@self') || new Set(work.credits).size !== work.credits.length
        || work.credits.some((credit) => credit !== '@self' && (!authorIds.includes(credit)
          || (draft.mode === 'existing' && credit === draft.authorId)))) throw new Error('作品署名须包含当前作者，且不能重复或引用未知作者');
    }, id);
  }
  if ((draft.mode === 'new' || draft.updateAuthor) && draft.avatarAction === 'replace' && draft.avatar) {
    test(0, () => claimAttachment(draft.avatar!));
  }
  return issues;
}
export function makeManifest(draft: Draft, authorIds: string[], materials: readonly RequestMaterial[] = []) {
  const issues = validateDraft(draft, authorIds, materials);
  if (issues.length) throw new Error(issues[0].message);
  const editing = draft.mode === 'new' || draft.updateAuthor;
  const profile = normalizeProfile(editing ? draft.profile : draft.baseline!);
  return {
    format: 'stepniang-submission', version: draft.requestKind !== 'submission' ? 3 : draft.works.some((work) => work.meme) ? 2 : 1,
    ...(draft.requestKind !== 'submission' ? { requestKind: draft.requestKind } : {}),
    exportedAt: new Date().toISOString(),
    public: {
      ...(draft.requestKind !== 'submission' ? { withdrawalIds: [...draft.withdrawalIds] } : {}),
      author: { mode: draft.mode, id: draft.mode === 'existing' ? draft.authorId : null,
        updateProfile: draft.mode === 'existing' && draft.updateAuthor,
        profile: draft.mode === 'new' || draft.updateAuthor ? profile : null,
        baseline: draft.mode === 'existing' ? normalizeProfile(draft.baseline!) : null,
        changes: draft.mode === 'existing' && draft.updateAuthor ? profileChanges(draft.baseline, profile) : [],
        avatarAction: editing ? draft.avatarAction : 'keep',
        avatar: editing && draft.avatarAction === 'replace' && draft.avatar ? { ...draft.avatar } : null },
      works: draft.works.map((work) => ({
        attachment: { ...work.attachment }, title: work.title.trim(), category: work.category, tags: parseTags(work.tags),
        license: work.license.trim(), source: sourceUrl(work.source), credits: [...work.credits],
        createdDate: workDate(work.createdDate),
        ...(work.meme ? { meme: normalizeMeme(work.meme) } : {}),
      })),
    },
    review: {
      ...(draft.requestKind !== 'submission' ? { withdrawalReason: draft.withdrawalReason.trim() } : {}),
      githubLoginClaim: githubLogin(draft.githubLogin), bindingStatus: 'unverified',
      works: draft.works.map((work) => ({ id: work.attachment.id, creationMethod: work.creationMethod, note: work.note.trim() })),
    },
  };
}

function object(value: unknown, allowed: string[], label: string): Record<string, unknown> {
  fields(value, new Set(allowed), label);
  return value as Record<string, unknown>;
}
function string(value: unknown, label: string, limit = 2048): string {
  if (typeof value !== 'string' || value.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new Error(`${label} 格式无效`);
  return value;
}
function array(value: unknown, limit: number): unknown[] {
  if (!Array.isArray(value) || value.length > limit) throw new Error('投稿包数组格式或数量无效');
  return value;
}
function readProfile(value: unknown): Profile {
  const p = object(value, [...PROFILE_KEYS], '作者资料');
  const profile = {
    name: string(p.name, '名称', 160), tagline: string(p.tagline, '一句话介绍', 320),
    bio: string(p.bio, '简介', 4000), email: string(p.email, '邮箱', 254),
    links: array(p.links, 20).map((value) => {
      const link = object(value, ['label', 'url'], '链接');
      return { label: string(link.label, '链接名称', 120), url: string(link.url, '网址') };
    }),
  };
  return normalizeProfile(profile);
}
export function readAttachment(value: unknown): Attachment {
  const a = object(value, ['id', 'path', 'name', 'bytes', 'width', 'height', 'sha256'], '附件');
  if (typeof a.id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(a.id)
    || typeof a.path !== 'string' || !new RegExp(`^files/${a.id}\\.(png|jpg|webp)$`).test(a.path)
    || typeof a.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(a.sha256)
    || !Number.isSafeInteger(a.bytes) || (a.bytes as number) < 1 || (a.bytes as number) > LIMITS.fileBytes
    || ![a.width, a.height].every((n) => Number.isSafeInteger(n) && (n as number) > 0 && (n as number) <= 16384)
    || (a.width as number) * (a.height as number) > 64 * 1024 * 1024) throw new Error('附件尺寸、路径或校验信息无效');
  const name = string(a.name, '文件名', 240);
  if (!name || /[\\/\u0000-\u001f\u007f]/.test(name) || name === '.' || name === '..') throw new Error('附件文件名无效');
  return a as Attachment;
}
export function readManifest(value: unknown, authorIds: string[], materials: readonly RequestMaterial[] = []): Draft {
  const m = object(value, ['format', 'version', 'requestKind', 'exportedAt', 'public', 'review'], '申请包');
  if (m.format !== 'stepniang-submission' || ![1, 2, 3].includes(m.version as number) || !Number.isFinite(Date.parse(string(m.exportedAt, '导出时间', 40)))) throw new Error('不支持的申请包版本');
  const modern = m.version === 3;
  if (modern ? !['profile-update', 'withdrawal'].includes(m.requestKind as string) : Object.hasOwn(m, 'requestKind')) throw new Error('申请类型与版本不一致');
  const requestKind = modern ? m.requestKind as RequestKind : 'submission';
  const pub = object(m.public, ['author', 'works', ...(modern ? ['withdrawalIds'] : [])], '公开资料');
  const a = object(pub.author, ['mode', 'id', 'updateProfile', 'profile', 'baseline', 'changes', 'avatarAction', 'avatar'], '作者');
  const review = object(m.review, ['githubLoginClaim', 'bindingStatus', 'works', ...(modern ? ['withdrawalReason'] : [])], '审核资料');
  if (!['existing', 'new'].includes(a.mode as string) || typeof a.updateProfile !== 'boolean'
    || !['keep', 'replace', 'remove'].includes(a.avatarAction as string) || review.bindingStatus !== 'unverified') throw new Error('作者或绑定状态无效');
  const baseline = a.baseline === null ? null : readProfile(a.baseline);
  const profile = a.profile === null ? baseline : readProfile(a.profile);
  if (!profile || (a.mode === 'new' && (a.id !== null || baseline !== null || a.updateProfile))
    || (a.mode === 'existing' && (!baseline || typeof a.id !== 'string'))
    || (a.mode === 'existing' && (a.updateProfile ? a.profile === null : a.profile !== null))
    || (a.mode === 'existing' && !a.updateProfile && (a.avatarAction !== 'keep' || a.avatar !== null))
    || (a.avatarAction === 'replace' ? a.avatar === null : a.avatar !== null)) throw new Error('作者资料与修改状态不一致');
  const expectedChanges = a.mode === 'existing' && a.updateProfile ? profileChanges(baseline, profile) : [];
  if (JSON.stringify(a.changes) !== JSON.stringify(expectedChanges)) throw new Error('作者变更记录不一致');
  const reviewWorks = array(review.works, LIMITS.files).map((entry) => object(entry, ['id', 'creationMethod', 'note'], '作品审核资料'));
  const usedReview = new Set<string>();
  const usedFiles = new Set<string>();
  const works = array(pub.works, LIMITS.files).map((entry): Work => {
    const w = object(entry, ['attachment', 'title', 'category', 'tags', 'license', 'source', 'credits', 'createdDate', 'characterVersion',
      ...(m.version === 2 ? ['meme'] : [])], '作品');
    // Accept the retired field from earlier v1 exports without carrying it forward.
    if (w.characterVersion != null) bounded(string(w.characterVersion, '旧包版本标签', 80), '旧包版本标签', 40);
    const attachment = readAttachment(w.attachment);
    if (usedFiles.has(attachment.path)) throw new Error('投稿包包含重复附件引用');
    usedFiles.add(attachment.path);
    const matching = reviewWorks.filter((r) => r.id === attachment.id);
    if (matching.length !== 1) throw new Error('作品缺少审核资料或重复');
    usedReview.add(attachment.id);
    const meme = w.meme == null ? null : normalizeMeme(w.meme);
    return { attachment, title: string(w.title, '标题', 160), category: string(w.category, '分类', 20),
      tags: array(w.tags, 10).map((tag) => {
        const text = string(tag, '标签', 40);
        if (/[,，\n]/.test(text)) throw new Error('标签不能含分隔符');
        return text;
      }).join(', '),
      license: string(w.license, '许可', 400), source: string(w.source, '来源'),
      createdDate: workDate(w.createdDate) ?? '',
      meme: meme ? { attachment: meme.attachment, title: meme.title ?? '', description: meme.description ?? '',
        credit: meme.credit ?? '', url: meme.url ?? '' } : null,
      credits: array(w.credits, 30).map((credit) => string(credit, '署名', 64)),
      creationMethod: string(matching[0].creationMethod, '创作方式', 30), note: string(matching[0].note, '审核备注', 4000) };
  });
  if (usedReview.size !== reviewWorks.length) throw new Error('投稿包含无对应作品的审核资料');
  const avatar = a.avatar === null ? null : readAttachment(a.avatar);
  if (avatar && usedFiles.has(avatar.path)) throw new Error('头像不能引用作品附件');
  const draft: Draft = {
    requestKind,
    withdrawalIds: modern ? array(pub.withdrawalIds, 100).map((id) => string(id, '作品 ID', 128)) : [],
    withdrawalReason: modern ? string(review.withdrawalReason, '撤下理由', 4000) : '',
    mode: a.mode as Draft['mode'], authorId: a.mode === 'existing' ? string(a.id, '作者 ID', 64) : '',
    githubLogin: githubLogin(string(review.githubLoginClaim, 'GitHub 账号', 200)), updateAuthor: a.updateProfile,
    profile, baseline, avatarAction: a.avatarAction as Draft['avatarAction'], avatar, works };
  const issues = validateDraft(draft, authorIds, materials);
  if (issues.length) throw new Error(issues[0].message);
  return draft;
}
