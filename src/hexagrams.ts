import type { LineData, Yao } from './model';

// 卦画编码按屏幕顺序：上爻到初爻，阳为 1、阴为 0。
// 下表行=下卦、列=上卦；据《周易》六十四卦速查表核对：
// https://zh.wikisource.org/zh-hans/周易#六十四卦速查表
const TRIGRAMS = [
  { bits: '111', name: '乾', image: '天' },
  { bits: '011', name: '兑', image: '泽' },
  { bits: '101', name: '离', image: '火' },
  { bits: '001', name: '震', image: '雷' },
  { bits: '110', name: '巽', image: '风' },
  { bits: '010', name: '坎', image: '水' },
  { bits: '100', name: '艮', image: '山' },
  { bits: '000', name: '坤', image: '地' },
] as const;

const NAMES = [
  ['乾', '夬', '大有', '大壮', '小畜', '需', '大畜', '泰'],
  ['履', '兑', '睽', '归妹', '中孚', '节', '损', '临'],
  ['同人', '革', '离', '丰', '家人', '既济', '贲', '明夷'],
  ['无妄', '随', '噬嗑', '震', '益', '屯', '颐', '复'],
  ['姤', '大过', '鼎', '恒', '巽', '井', '蛊', '升'],
  ['讼', '困', '未济', '解', '涣', '坎', '蒙', '师'],
  ['遁', '咸', '旅', '小过', '渐', '蹇', '艮', '谦'],
  ['否', '萃', '晋', '豫', '观', '比', '剥', '坤'],
] as const;

export function hexagramName(yaos: readonly Yao[]): string {
  if (yaos.length !== 6 || yaos.some(yao => yao !== '阳' && yao !== '阴')) return '';
  const bits = yaos.map(yao => yao === '阳' ? '1' : '0').join('');
  const upper = TRIGRAMS.findIndex(trigram => trigram.bits === bits.slice(0, 3));
  const lower = TRIGRAMS.findIndex(trigram => trigram.bits === bits.slice(3));
  if (upper === lower) return `${TRIGRAMS[upper].name}为${TRIGRAMS[upper].image}`;
  return `${TRIGRAMS[upper].image}${TRIGRAMS[lower].image}${NAMES[lower][upper]}`;
}

export function deriveChart(lines: readonly LineData[]): {
  lines: LineData[]; primaryName: string; changedName: string;
} {
  const next = lines.map(line => ({
    ...line,
    changedYao: (line.primaryYao === '' ? '' : line.moving
      ? (line.primaryYao === '阳' ? '阴' : '阳') : line.primaryYao) as Yao,
  }));
  return {
    lines: next,
    primaryName: hexagramName(next.map(line => line.primaryYao)),
    changedName: hexagramName(next.map(line => line.changedYao)),
  };
}
