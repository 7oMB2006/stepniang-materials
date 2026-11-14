const socialHosts = new Map([
  ['github.com', 'github'], ['www.github.com', 'github'],
  ['bilibili.com', 'bilibili'], ['www.bilibili.com', 'bilibili'], ['space.bilibili.com', 'bilibili'],
  ['xiaohongshu.com', 'xiaohongshu'], ['www.xiaohongshu.com', 'xiaohongshu'],
  ['douyin.com', 'douyin'], ['www.douyin.com', 'douyin'],
  ['x.com', 'twitter'], ['www.x.com', 'twitter'], ['twitter.com', 'twitter'], ['www.twitter.com', 'twitter'],
]);

export function fields(record, allowed, context) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error(`${context} must be an object`);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new Error(`${context}.${key} is an unsupported field`);
  }
}

export function stringField(record, key, context, limit, multiline = false) {
  const value = record[key];
  if (value == null) return null;
  if (typeof value !== 'string') throw new Error(`${context}.${key} must be a string`);
  const result = value.trim();
  if ([...result].length > limit) throw new Error(`${context}.${key} exceeds ${limit} characters`);
  const controls = multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/;
  if (controls.test(value)) throw new Error(`${context}.${key} contains control characters`);
  return result || null;
}

export function prepareEmail(profile, context) {
  const email = stringField(profile, 'email', context, 254);
  if (!email) return null;
  const parts = email.split('@');
  const local = parts[0];
  const domain = parts[1];
  if (parts.length !== 2 || !local || local.length > 64
    || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)
    || local.startsWith('.') || local.endsWith('.') || local.includes('..')
    || !domain || !domain.includes('.')
    || !domain.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) {
    throw new Error(`${context}.email must be one bare email address without mailto or mail headers`);
  }
  return `${local}@${domain.toLowerCase()}`;
}

export function socialPlatform(url) {
  try {
    const parsed = new URL(url);
    return ['https:', 'http:'].includes(parsed.protocol) && !parsed.port
      ? socialHosts.get(parsed.hostname) ?? null : null;
  } catch { return null; }
}

export function prepareLinks(profile, context) {
  if (profile.links != null && !Array.isArray(profile.links)) throw new Error(`${context}.links must be an array`);
  const unique = new Map();
  for (const [index, link] of (profile.links ?? []).entries()) {
    const field = `${context}.links[${index}]`;
    fields(link, new Set(['label', 'url']), field);
    const label = stringField(link, 'label', field, 60);
    const input = stringField(link, 'url', field, 2048);
    let url;
    try {
      if (!input || !/^https?:\/\//i.test(input) || /\s|\\/.test(input)) throw new Error();
      url = new URL(input);
    } catch { throw new Error(`${field}.url must be an absolute HTTP(S) URL`); }
    if (!label || !['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
      throw new Error(`${field} requires a label and an HTTP(S) URL without credentials`);
    }
    const platform = socialPlatform(url.href);
    if (!unique.has(url.href)) unique.set(url.href, { label, url: url.href, platform });
  }
  const links = [...unique.values()];
  if (links.filter((link) => !link.platform).length > 2) {
    throw new Error(`${context}.links allows at most 2 other websites; recognized social platforms do not count`);
  }
  return links;
}
