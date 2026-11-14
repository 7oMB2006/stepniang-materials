export function workDate(value, label = '创作日期', partial = true) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !(partial ? /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/ : /^\d{4}-\d{2}-\d{2}$/).test(value)) {
    throw new Error(`${label}须为${partial ? ' YYYY、YYYY-MM 或 YYYY-MM-DD' : ' YYYY-MM-DD'}`);
  }
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || (month !== undefined && (month < 1 || month > 12))
    || (day !== undefined && (day < 1 || day > days[month - 1]))) {
    throw new Error(`${label}不是有效的日历日期`);
  }
  return value;
}

export function workTimeline(entry = {}) {
  const updatedAt = entry.updatedAt ?? null;
  if (updatedAt !== null && (typeof updatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(updatedAt)
    || !Number.isFinite(Date.parse(updatedAt)) || new Date(updatedAt).toISOString() !== updatedAt)) {
    throw new Error('资料更新时间须为有效的 UTC 时间戳');
  }
  return {
    createdDate: workDate(entry.createdDate),
    addedDate: workDate(entry.addedDate, '收录日期', false),
    updatedAt,
  };
}

export function formatWorkDate(value) {
  if (!value) return '';
  try { workDate(value); } catch { return value; }
  return value.split('-').map((part, index) => `${index ? Number(part) : part}${['年', '月', '日'][index]}`).join('');
}

export function compareWorkDates(left, right) {
  // Unknown dates sort last. Partial dates retain their declared precision.
  return (right ?? '').localeCompare(left ?? '');
}
