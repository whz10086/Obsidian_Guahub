import { describe, expect, it } from 'vitest';
import { emptyCase, type Yao } from '../src/model';
import { deriveChart, hexagramName } from '../src/hexagrams';

const fromBits = (bits: string): Yao[] => [...bits].map(bit => bit === '1' ? '阳' : '阴');

describe('卦象识别与变爻', () => {
  it.each([
    ['111111', '乾为天'], ['000000', '坤为地'], ['011011', '兑为泽'],
    ['101101', '离为火'], ['001001', '震为雷'], ['110110', '巽为风'],
    ['010010', '坎为水'], ['100100', '艮为山'],
    ['111101', '天火同人'], ['000001', '地雷复'], ['011111', '泽天夬'],
    ['111000', '天地否'], ['000111', '地天泰'],
    ['010001', '水雷屯'], ['100010', '山水蒙'],
    ['010101', '水火既济'], ['101010', '火水未济'],
  ])('上到下 %s 对应 %s', (bits, name) => {
    expect(hexagramName(fromBits(bits))).toBe(name);
  });

  it('六十四种卦画均有不同卦名，缺爻时不猜测', () => {
    const names = Array.from({ length: 64 }, (_, i) => hexagramName(fromBits(i.toString(2).padStart(6, '0'))));
    expect(names.every(Boolean)).toBe(true);
    expect(new Set(names).size).toBe(64);
    expect(hexagramName(['阳', '阳', '阳', '', '阳', '阳'])).toBe('');
    expect(hexagramName(['阳'])).toBe('');
  });

  it('乾卦二爻动得到天火同人，初爻和上爻不会被颠倒', () => {
    const record = emptyCase();
    record.lines.forEach(line => { line.primaryYao = '阳'; });
    record.lines[4].moving = true;
    record.lines[4].primaryBranch = '甲寅';
    const chart = deriveChart(record.lines);
    expect(chart.primaryName).toBe('乾为天');
    expect(chart.changedName).toBe('天火同人');
    expect(chart.lines.map(line => line.changedYao)).toEqual(['阳', '阳', '阳', '阳', '阴', '阳']);
    expect(chart.lines[4].primaryBranch).toBe('甲寅');
    expect(record.lines[4].changedYao).toBe('');
  });

  it('阴动变阳、阳动变阴、静爻不变、未填仍为空', () => {
    const record = emptyCase();
    record.lines[0].primaryYao = '阴'; record.lines[0].moving = true;
    record.lines[1].primaryYao = '阳'; record.lines[1].moving = true;
    record.lines[2].primaryYao = '阴';
    record.lines[3].primaryYao = '阳';
    record.lines[4].moving = true;
    expect(deriveChart(record.lines).lines.map(line => line.changedYao)).toEqual(['阳', '阴', '阴', '阳', '', '']);
  });
});
