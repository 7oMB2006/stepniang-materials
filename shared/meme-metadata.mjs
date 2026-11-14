import { fields, stringField } from './profile.mjs';

export function prepareMemeCaption(value) {
  fields(value, new Set(['title', 'description', 'credit', 'url']), '梗来源');
  const title = stringField(value, 'title', '梗来源', 100);
  const description = stringField(value, 'description', '梗来源', 1000, true);
  const credit = stringField(value, 'credit', '梗来源', 1000);
  const input = stringField(value, 'url', '梗来源', 2048);
  let url = null;
  if (input) {
    try {
      const parsed = new URL(input);
      if (!/^https:\/\//i.test(input) || parsed.protocol !== 'https:' || parsed.username || parsed.password
        || /[\s\\]/.test(input)) throw new Error();
      url = parsed.href;
    } catch { throw new Error('梗来源链接须为完整的 HTTPS 地址，不含账号密码'); }
  }
  return { title, description, credit, url };
}
