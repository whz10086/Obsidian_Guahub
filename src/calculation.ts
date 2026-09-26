import { Solar, LunarUtil } from 'lunar-typescript';
import { deriveChart, hexagramName } from './hexagrams';
import type { CaseData, LineData, Yao } from './model';

// 屏幕顺序为上爻至初爻；纳甲表为初爻至上爻。
const TRIGRAMS = [
  ['111', '乾', '金', '甲子甲寅甲辰壬午壬申壬戌'],
  ['011', '兑', '金', '丁巳丁卯丁丑丁亥丁酉丁未'],
  ['101', '离', '火', '己卯己丑己亥己酉己未己巳'],
  ['001', '震', '木', '庚子庚寅庚辰庚午庚申庚戌'],
  ['110', '巽', '木', '辛丑辛亥辛酉辛未辛巳辛卯'],
  ['010', '坎', '水', '戊寅戊辰戊午戊申戊戌戊子'],
  ['100', '艮', '土', '丙辰丙午丙申丙戌丙子丙寅'],
  ['000', '坤', '土', '乙未乙巳乙卯癸丑癸亥癸酉'],
];
const STEMS = '甲乙丙丁戊己庚辛壬癸';
const BRANCHES = '子丑寅卯辰巳午未申酉戌亥';
const SPIRITS = ['青龙', '朱雀', '勾陈', '腾蛇', '白虎', '玄武'];
export const CALCULATION_RULE = '北京时间 UTC+8 · 立春换年 · 节气换月 · 23点换日';

export interface ChartInfo {
  primaryPalace: string;
  changedPalace: string;
  longevity: string;
  spirits: string;
}

export function fiveElement(char: string): string {
  if ('甲乙寅卯'.includes(char) && char) return '木';
  if ('丙丁巳午'.includes(char) && char) return '火';
  if ('戊己辰戌丑未'.includes(char) && char) return '土';
  if ('庚辛申酉'.includes(char) && char) return '金';
  if ('壬癸子亥'.includes(char) && char) return '水';
  return '';
}

export function relative(palaceElement: string, branch: string): string {
  const cycle = '木火土金水';
  const delta = (cycle.indexOf(fiveElement(branch)) - cycle.indexOf(palaceElement) + 5) % 5;
  return ['兄弟', '子孙', '妻财', '官鬼', '父母'][delta];
}

// 京房八宫：本宫、初至五世、游魂（四爻复变）、归魂（内卦复原）。
export function palace(yaos: readonly Yao[]): { name: string; element: string; index: number; shi: number; label: string; bits: string } {
  const bits = yaos.map(y => y === '阳' ? '1' : '0').join('');
  for (const [tri, name, element] of TRIGRAMS) {
    const current = [...tri + tri];
    for (let stage = 0; stage < 8; stage++) {
      if (stage >= 1 && stage <= 5) current[6 - stage] = current[6 - stage] === '1' ? '0' : '1';
      if (stage === 6) current[2] = current[2] === '1' ? '0' : '1';
      if (stage === 7) current.splice(3, 3, ...tri);
      if (current.join('') === bits) {
        const fullName = hexagramName(yaos);
        const attributes: string[] = [];
        if (stage === 0 || ['天雷无妄', '雷天大壮'].includes(fullName)) attributes.push('六冲');
        if (['天地否', '地天泰', '地雷复', '雷地豫', '山火贲', '火山旅', '水泽节', '泽水困'].includes(fullName)) attributes.push('六合');
        if (stage === 6) attributes.push('游魂');
        if (stage === 7) attributes.push('归魂');
        return { name, element, index: stage + 1, shi: [6, 1, 2, 3, 4, 5, 4, 3][stage],
          label: `${name}宫 · ${stage + 1}${attributes.length ? `（${attributes.join('、')}）` : ''}`, bits: tri + tri };
      }
    }
  }
  throw new Error('请完整填写六爻阴阳。');
}

export function najia(yaos: readonly Yao[]): string[] {
  const bits = yaos.map(y => y === '阳' ? '1' : '0').join('');
  const upper = TRIGRAMS.find(t => t[0] === bits.slice(0, 3))!;
  const lower = TRIGRAMS.find(t => t[0] === bits.slice(3))!;
  return [...lower[3].match(/../g)!.slice(0, 3), ...upper[3].match(/../g)!.slice(3)].reverse();
}

export function calendar(date: string): { pillars: string; voidBranches: string; day: string } {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(date);
  if (!match) throw new Error('请填写完整的起卦日期和时间。');
  const [year, month, day, hour, minute, second] = match.slice(1).map(v => Number(v || 0));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59) {
    throw new Error('请填写有效时间（支持 1900—2100 年）。');
  }
  // Direct civil components avoid device timezone / daylight-saving conversions.
  const lunar = Solar.fromYmdHms(year, month, day, hour, minute, second).getLunar();
  const pillars = [lunar.getYearInGanZhiExact(), lunar.getMonthInGanZhiExact(), lunar.getDayInGanZhiExact(), lunar.getTimeInGanZhi()];
  return {
    pillars: pillars.map((p, i) => p + '年月日时'[i]).join(' '),
    voidBranches: pillars.map((p, i) => `${'年月日时'[i]}空：${LunarUtil.getXunKong(p)}`).join(' / '),
    day: pillars[2],
  };
}

export function calculate(date: string, input: readonly LineData[]): Pick<CaseData, 'lines' | 'primaryName' | 'changedName' | 'pillars' | 'voidBranches'> & { chartInfo: ChartInfo } {
  if (input.length !== 6 || input.some(line => !['阴', '阳'].includes(line.primaryYao))) throw new Error('请完整填写六爻阴阳。');
  const { day, pillars, voidBranches } = calendar(date);
  const chart = deriveChart(input);
  const main = palace(chart.lines.map(l => l.primaryYao));
  const changed = palace(chart.lines.map(l => l.changedYao));
  const branches = najia(chart.lines.map(l => l.primaryYao));
  const changedBranches = najia(chart.lines.map(l => l.changedYao));
  const pureBranches = najia([...main.bits].map(b => b === '1' ? '阳' : '阴'));
  const present = new Set(branches.map(b => relative(main.element, b[1])));
  const start = [0, 0, 1, 1, 2, 3, 4, 4, 5, 5][STEMS.indexOf(day[0])];
  const role = (shi: number, line: number): string => line === shi ? '世' : line === (shi + 2) % 6 + 1 ? '应' : '';
  chart.lines.forEach((line, i) => {
    line.spirit = SPIRITS[(start + 5 - i) % 6];
    line.primaryBranch = branches[i];
    line.primaryRelative = relative(main.element, branches[i][1]);
    line.changedBranch = changedBranches[i];
    // 变卦六亲仍以本卦宫五行为基准。
    line.changedRelative = relative(main.element, changedBranches[i][1]);
    line.role = role(main.shi, 6 - i);
    line.changedRole = role(changed.shi, 6 - i);
    const hiddenRelative = relative(main.element, pureBranches[i][1]);
    line.hidden = present.has(hiddenRelative) ? '' : hiddenRelative + pureBranches[i];
  });
  const stem = STEMS.indexOf(day[0]);
  const group = ['申子辰', '寅午戌', '亥卯未', '巳酉丑'].findIndex(g => g.includes(day[1]));
  // 六爻五行长生不分阴阳逆行，水土同长生申；这里展示日干五行。
  const lifeStart: Record<string, number> = { 木: 11, 火: 2, 土: 8, 金: 5, 水: 8 };
  const life = lifeStart[fiveElement(day[0])];
  return { ...chart, pillars, voidBranches, chartInfo: {
    primaryPalace: main.label, changedPalace: changed.label,
    longevity: [0, 4, 8, 9].map((offset, i) => `${['长生', '帝旺', '墓', '绝'][i]}－${BRANCHES[(life + offset) % 12]}`).join('  '),
    spirits: `驿马－${'寅申巳亥'[group]}  桃花－${'酉卯子午'[group]}  禄神－${'寅卯巳午巳午申酉亥子'[stem]}  天乙－${['丑未', '子申', '亥酉', '亥酉', '丑未', '子申', '寅午', '寅午', '卯巳', '卯巳'][stem]}`,
  } };
}
