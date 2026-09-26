import { describe, expect, it } from 'vitest';
import { Solar } from 'lunar-typescript';
import { calculate, calendar, najia, palace } from '../src/calculation';
import { emptyCase, emptyLine, parseCase, serializeCase, type Yao } from '../src/model';
import { hexagramName } from '../src/hexagrams';
import { parse } from 'yaml';

const yaos = (bits: string): Yao[] => [...bits].map(b => b === '1' ? '阳' : '阴');
const lines = (bits: string) => yaos(bits).map(primaryYao => ({ ...emptyLine(), primaryYao }));
const referenceDate = '2026-09-26T15:44:46';

describe('自动排盘', () => {
  it('逐项复现参考图的乾二爻动：历法、六亲、纳甲、六神与神煞', () => {
    const input = lines('111111'); input[4].moving = true;
    const r = calculate(referenceDate, input);
    expect(r.pillars).toBe('丙午年 丁酉月 癸卯日 庚申时');
    expect(r.voidBranches).toBe('年空：寅卯 / 月空：辰巳 / 日空：辰巳 / 时空：子丑');
    expect(r.primaryName).toBe('乾为天'); expect(r.changedName).toBe('天火同人');
    expect(r.chartInfo).toEqual({ primaryPalace: '乾宫 · 1（六冲）', changedPalace: '离宫 · 8（归魂）',
      longevity: '长生－申  帝旺－子  墓－辰  绝－巳', spirits: '驿马－巳  桃花－子  禄神－子  天乙－卯巳' });
    expect(r.lines.map(l => l.spirit)).toEqual(['白虎', '腾蛇', '勾陈', '朱雀', '青龙', '玄武']);
    expect(r.lines.map(l => l.primaryRelative + l.primaryBranch)).toEqual(['父母壬戌', '兄弟壬申', '官鬼壬午', '父母甲辰', '妻财甲寅', '子孙甲子']);
    expect(r.lines.map(l => l.changedRelative + l.changedBranch)).toEqual(['父母壬戌', '兄弟壬申', '官鬼壬午', '子孙己亥', '父母己丑', '妻财己卯']);
    expect(r.lines.map(l => l.role)).toEqual(['世', '', '', '应', '', '']);
    expect(r.lines.map(l => l.changedRole)).toEqual(['应', '', '', '世', '', '']);
    expect(r.lines.map(l => l.changedYao)).toEqual(yaos('111101'));
    expect(input[0].spirit).toBe(''); // Never mutate saved records while previewing.
  });

  it('64卦八宫归属与宫序对照独立表', () => {
    const sequences: Record<string, string[]> = {
      乾: ['乾为天', '天风姤', '天山遁', '天地否', '风地观', '山地剥', '火地晋', '火天大有'],
      坎: ['坎为水', '水泽节', '水雷屯', '水火既济', '泽火革', '雷火丰', '地火明夷', '地水师'],
      艮: ['艮为山', '山火贲', '山天大畜', '山泽损', '火泽睽', '天泽履', '风泽中孚', '风山渐'],
      震: ['震为雷', '雷地豫', '雷水解', '雷风恒', '地风升', '水风井', '泽风大过', '泽雷随'],
      巽: ['巽为风', '风天小畜', '风火家人', '风雷益', '天雷无妄', '火雷噬嗑', '山雷颐', '山风蛊'],
      离: ['离为火', '火山旅', '火风鼎', '火水未济', '山水蒙', '风水涣', '天水讼', '天火同人'],
      坤: ['坤为地', '地雷复', '地泽临', '地天泰', '雷天大壮', '泽天夬', '水天需', '水地比'],
      兑: ['兑为泽', '泽水困', '泽地萃', '泽山咸', '水山蹇', '地山谦', '雷山小过', '雷泽归妹'],
    };
    for (let n = 0; n < 64; n++) {
      const y = yaos(n.toString(2).padStart(6, '0')); const p = palace(y);
      expect(sequences[p.name][p.index - 1]).toBe(hexagramName(y));
      expect(p.shi).toBe([6, 1, 2, 3, 4, 5, 4, 3][p.index - 1]);
    }
  });

  it.each([
    ['111', '壬戌 壬申 壬午 甲辰 甲寅 甲子'], ['000', '癸酉 癸亥 癸丑 乙卯 乙巳 乙未'],
    ['010', '戊子 戊戌 戊申 戊午 戊辰 戊寅'], ['101', '己巳 己未 己酉 己亥 己丑 己卯'],
    ['001', '庚戌 庚申 庚午 庚辰 庚寅 庚子'], ['110', '辛卯 辛巳 辛未 辛酉 辛亥 辛丑'],
    ['100', '丙寅 丙子 丙戌 丙申 丙午 丙辰'], ['011', '丁未 丁酉 丁亥 丁丑 丁卯 丁巳'],
  ])('八纯卦纳甲 %s', (bits, expected) => expect(najia(yaos(bits + bits)).join(' ')).toBe(expected));

  it('乾宫姤卦缺妻财，伏于二爻；已有六亲不重复伏出', () => {
    const r = calculate(referenceDate, lines('111110'));
    expect(r.lines.map(l => l.hidden)).toEqual(['', '', '', '', '妻财甲寅', '']);
  });

  it('保存普通Markdown后重读可由时间和阴阳完整复算，并保留复盘', () => {
    const original = { ...emptyCase(), date: referenceDate, judgment: '事前判断', feedback: '实际结果', review: '复盘内容', ...calculate(referenceDate, lines('101010')) };
    const text = serializeCase(original);
    expect(text).toContain('gua-calculation: "beijing-jie-zi-v1"');
    expect(text).toContain('十二长生');
    const loaded = parseCase(text, 'fixture.md', parse)!;
    expect(calculate(loaded.date, loaded.lines)).toEqual(calculate(original.date, original.lines));
    expect(loaded.review).toBe(original.review);
  });
});

describe('历法边界', () => {
  it('子初23点换日，午夜不重复换日', () => {
    expect(calendar('2026-09-26T22:59:59').day).toBe('癸卯');
    expect(calendar('2026-09-26T23:00:00').day).toBe('甲辰');
    expect(calendar('2026-09-27T00:00:00').day).toBe('甲辰');
    expect(calendar('2026-09-26T23:00:00').pillars).toContain('甲子时');
  });
  it('以立春精确时刻同时换年与月', () => {
    const lichun = Solar.fromYmd(2026, 2, 5).getLunar().getJieQiTable()['立春'];
    const at = lichun.toYmdHms().replace(' ', 'T');
    const before = new Date(Date.parse(at + '+08:00') - 1000 + 8 * 3600000).toISOString().slice(0, 19);
    expect(calendar(before).pillars).toMatch(/^乙巳年 己丑月/);
    expect(calendar(at).pillars).toMatch(/^丙午年 庚寅月/);
  });
  it.each(['', '2026-02-29T12:00', '2100-02-29T12:00', '2026-13-01T12:00', '2026-01-01T24:00', '1899-12-31T12:00'])('拒绝无效日期 %s', date => expect(() => calendar(date)).toThrow());
  it('接受闰日与秒数', () => expect(calendar('2024-02-29T12:59:59').pillars).toContain('年'));
  it('不猜测缺失爻位', () => expect(() => calculate(referenceDate, [emptyLine(), ...lines('11111')])).toThrow());
});
