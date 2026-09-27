import type { ChartInfo } from './calculation';
export type Yao = '' | '阳' | '阴';
export type CaseStatus = '待反馈' | '已反馈';

export interface LineData {
  spirit: string;
  hidden: string;
  primaryRelative: string;
  primaryBranch: string;
  primaryYao: Yao;
  role: string;
  moving: boolean;
  changedRelative: string;
  changedBranch: string;
  changedYao: Yao;
  changedRole: string;
}

export interface CaseData {
  id: string;
  path: string;
  sourceContent: string;
  question: string;
  date: string;
  status: CaseStatus;
  tags: string[];
  method: string;
  pillars: string;
  voidBranches: string;
  primaryName: string;
  changedName: string;
  lines: LineData[];
  judgment: string;
  feedback: string;
  review: string;
  learningNotes: string;
  chartInfo?: ChartInfo;
}

export const LINE_NAMES = ['上爻', '五爻', '四爻', '三爻', '二爻', '初爻'] as const;

export function emptyLine(): LineData {
  return {
    spirit: '', hidden: '', primaryRelative: '', primaryBranch: '',
    primaryYao: '', role: '', moving: false, changedRelative: '',
    changedBranch: '', changedYao: '', changedRole: '',
  };
}

export function emptyCase(now: Date = new Date()): CaseData {
  const local = new Date(now.getTime() + 8 * 60 * 60_000)
    .toISOString().slice(0, 16);
  return {
    id: globalThis.crypto.randomUUID(), path: '', sourceContent: '', question: '', date: local,
    status: '待反馈', tags: [], method: '', pillars: '', voidBranches: '',
    primaryName: '', changedName: '', lines: LINE_NAMES.map(() => emptyLine()),
    judgment: '', feedback: '', review: '', learningNotes: '',
  };
}

function yamlValue(value: string | string[]): string {
  return JSON.stringify(value);
}

function oneLine(value: string): string {
  return value.replace(/\r?\n/g, ' ').trim();
}

function cell(value: string): string {
  return oneLine(value).replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
}

function parseCells(row: string): string[] {
  const out: string[] = [];
  let current = '';
  const trimmed = row.trim().replace(/^\|/, '').replace(/\|$/, '');
  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (char === '\\' && i + 1 < trimmed.length && (trimmed[i + 1] === '|' || trimmed[i + 1] === '\\')) {
      current += trimmed[++i];
    } else if (char === '|') {
      out.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  out.push(current.trim());
  return out;
}

function section(body: string, start: string, next?: string): string {
  const key = start === '听课思路与感悟' ? 'learning' : start === '当时判断' ? 'judgment' : start === '实际反馈' ? 'feedback' : 'review';
  const open = `<!-- gua-casebook:${key}:start -->`;
  const close = `<!-- gua-casebook:${key}:end -->`;
  const markerStart = body.indexOf(open);
  const markerEnd = body.indexOf(close, markerStart + open.length);
  if (markerStart >= 0 && markerEnd >= 0) return body.slice(markerStart + open.length, markerEnd).trim();
  // Read the first draft of the file format if it already exists in a Vault.
  const from = body.indexOf(`## ${start}\n`);
  if (from < 0) return '';
  const contentStart = from + start.length + 4;
  const end = next ? body.indexOf(`\n## ${next}\n`, contentStart) : -1;
  return body.slice(contentStart, end < 0 ? undefined : end).trim();
}

export function serializeCase(record: CaseData): string {
  const knownKeys = new Set(['gua-casebook', 'gua-id', 'gua-date', 'gua-status',
    'gua-method', 'gua-pillars', 'gua-void', 'gua-calculation', 'tags']);
  const oldFrontmatter = record.sourceContent.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? '';
  const extraFrontmatter: string[] = [];
  let keep = false;
  for (const line of oldFrontmatter.split('\n')) {
    const key = line.match(/^([a-zA-Z0-9_-]+):(?:\s|$)/)?.[1];
    if (key) keep = !knownKeys.has(key);
    if (keep) extraFrontmatter.push(line);
  }
  const endMarker = '<!-- gua-casebook:document:end -->';
  const endIndex = record.sourceContent.indexOf(endMarker);
  const additionalNotes = endIndex < 0 ? '' : record.sourceContent.slice(endIndex + endMarker.length);
  const frontmatter = [
    '---',
    'gua-casebook: true',
    `gua-id: ${yamlValue(record.id)}`,
    `gua-date: ${yamlValue(record.date)}`,
    `gua-status: ${yamlValue(record.status)}`,
    `gua-method: ${yamlValue(oneLine(record.method))}`,
    `gua-pillars: ${yamlValue(oneLine(record.pillars))}`,
    `gua-void: ${yamlValue(oneLine(record.voidBranches))}`,
    ...(record.chartInfo ? ['gua-calculation: "beijing-jie-zi-v1"'] : []),
    `tags: ${yamlValue(['卦例', ...record.tags.map(oneLine).filter(Boolean)])}`,
    ...extraFrontmatter,
    '---',
  ];
  const header = '| 爻位 | 六神 | 伏神 | 本卦六亲 | 本卦干支 | 本卦爻 | 世应 | 动爻 | 变卦六亲 | 变卦干支 | 变卦爻 | 变卦世应 |';
  const separator = '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |';
  const rows = LINE_NAMES.map((name, i) => {
    const line = record.lines[i] ?? emptyLine();
    const values = [name, line.spirit, line.hidden, line.primaryRelative,
      line.primaryBranch, line.primaryYao, line.role, line.moving ? '动' : '',
      line.changedRelative, line.changedBranch, line.changedYao, line.changedRole];
    return `| ${values.map(cell).join(' | ')} |`;
  });
  return [
    ...frontmatter,
    '',
    `# ${oneLine(record.question)}`,
    '',
    '## 卦盘',
    '',
    `**本卦：** ${oneLine(record.primaryName)}`,
    `**变卦：** ${oneLine(record.changedName)}`,
    ...(record.chartInfo ? ['', `四柱：${record.pillars}`, `旬空：${record.voidBranches}`,
      `本卦：${record.chartInfo.primaryPalace}；变卦：${record.chartInfo.changedPalace}`,
      `十二长生（日干五行）：${record.chartInfo.longevity}`, `神煞：${record.chartInfo.spirits}`,
      '排盘规则：北京时间 UTC+8；立春换年，节气换月，23点换日。'] : []),
    '',
    header,
    separator,
    ...rows,
    '',
    '## 当时判断',
    '',
    '<!-- gua-casebook:judgment:start -->',
    record.judgment.trim(),
    '<!-- gua-casebook:judgment:end -->',
    '',
    '## 实际反馈',
    '',
    '<!-- gua-casebook:feedback:start -->',
    record.feedback.trim(),
    '<!-- gua-casebook:feedback:end -->',
    '',
    '## 复盘',
    '',
    '<!-- gua-casebook:review:start -->',
    record.review.trim(),
    '<!-- gua-casebook:review:end -->',
    '',
    '## 听课思路与感悟',
    '',
    '<!-- gua-casebook:learning:start -->',
    (record.learningNotes ?? '').trim(),
    '<!-- gua-casebook:learning:end -->',
    endMarker,
    additionalNotes.trim() ? additionalNotes.trimStart() : '',
    '',
  ].join('\n');
}

export function parseCase(content: string, path: string,
  parseFrontmatter: (yaml: string) => unknown): CaseData | null {
  const normalized = content.replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return null;
  let value: unknown;
  try { value = parseFrontmatter(match[1]); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const fields = value as Record<string, unknown>;
  if (fields['gua-casebook'] !== true || typeof fields['gua-id'] !== 'string') return null;
  const body = normalized.slice(match[0].length);
  const question = body.match(/^# (.*)$/m)?.[1]?.trim() ?? '';
  const primaryName = body.match(/^\*\*本卦：\*\* (.*)$/m)?.[1]?.trim() ?? '';
  const changedName = body.match(/^\*\*变卦：\*\* (.*)$/m)?.[1]?.trim() ?? '';
  const lines = LINE_NAMES.map(() => emptyLine());
  for (const row of body.split('\n')) {
    if (!row.startsWith('|')) continue;
    const values = parseCells(row);
    const index = LINE_NAMES.findIndex(name => name === values[0]);
    if (index < 0) continue;
    lines[index] = {
      spirit: values[1] ?? '', hidden: values[2] ?? '',
      primaryRelative: values[3] ?? '', primaryBranch: values[4] ?? '',
      primaryYao: values[5] === '阴' || values[5] === '阳' ? values[5] : '', role: values[6] ?? '',
      moving: values[7] === '动', changedRelative: values[8] ?? '',
      changedBranch: values[9] ?? '', changedYao: values[10] === '阴' || values[10] === '阳' ? values[10] : '',
      changedRole: values[11] ?? '',
    };
  }
  const stringField = (key: string): string => typeof fields[key] === 'string' ? fields[key] as string : '';
  const tags = fields.tags;
  return {
    id: stringField('gua-id'), path, sourceContent: content, question, date: stringField('gua-date'),
    status: fields['gua-status'] === '已反馈' ? '已反馈' : '待反馈',
    tags: Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === 'string' && tag !== '卦例') : [],
    method: stringField('gua-method'), pillars: stringField('gua-pillars'),
    voidBranches: stringField('gua-void'), primaryName, changedName, lines,
    judgment: section(body, '当时判断', '实际反馈'),
    feedback: section(body, '实际反馈', '复盘'),
    review: section(body, '复盘', '听课思路与感悟'),
    learningNotes: section(body, '听课思路与感悟'),
  };
}

export function safeFileStem(question: string): string {
  return oneLine(question).replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/[. ]+$/g, '').slice(0, 36) || '未命名卦例';
}
