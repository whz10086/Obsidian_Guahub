// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { emptyCase, parseCase, serializeCase } from '../src/model';
import { deriveChart } from '../src/hexagrams';
import { createLinePicker } from '../src/line-picker';

describe('六爻点选录入', () => {
  beforeEach(() => { document.body.replaceChildren(); });
  const buttons = () => Array.from(document.querySelectorAll<HTMLButtonElement>('.gua-line-toggle'));
  const moving = () => Array.from(document.querySelectorAll<HTMLButtonElement>('.gua-move-toggle'));

  it('点击二爻动重现截图，并把结果完整写入 Markdown', () => {
    const record = emptyCase();
    record.question = '点选示例';
    record.lines.forEach(line => { line.primaryYao = '阳'; });
    Object.assign(record, deriveChart(record.lines));
    createLinePicker(document.body, record.lines, (primary, changed) => {
      record.primaryName = primary; record.changedName = changed;
    });
    expect(buttons()).toHaveLength(6);
    expect(buttons()[0].getAttribute('aria-label')).toContain('上爻');
    expect(buttons()[5].getAttribute('aria-label')).toContain('初爻');
    moving()[4].click();
    expect(document.querySelector('.gua-entry-summary')?.textContent).toBe('乾为天 之 天火同人');
    expect(moving()[4].getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('.gua-entry-counter')?.textContent).toBe('1 动爻');
    const saved = parseCase(serializeCase(record), 'test.md', parseYaml)!;
    expect(saved.changedName).toBe('天火同人');
    expect(saved.lines[4]).toMatchObject({ primaryYao: '阳', moving: true, changedYao: '阴' });
    moving()[4].click();
    expect(record.changedName).toBe('乾为天');
    expect(document.querySelector('.gua-entry-summary')?.textContent).toContain('静卦');
  });

  it('阴阳切换、阴爻发动和重置都更新同一份草稿，保留手填资料', () => {
    const record = emptyCase();
    record.lines.forEach(line => { line.primaryYao = '阳'; });
    Object.assign(record, deriveChart(record.lines));
    const initialLine = record.lines[0];
    initialLine.spirit = '白虎'; initialLine.primaryBranch = '壬戌';
    createLinePicker(document.body, record.lines, vi.fn());
    buttons()[0].click();
    expect(buttons()[0].classList.contains('is-yin')).toBe(true);
    expect(initialLine.primaryYao).toBe('阴');
    moving()[0].click();
    expect(initialLine.changedYao).toBe('阳');
    document.querySelector<HTMLButtonElement>('.gua-entry-footer button')!.click();
    expect(record.lines.every(line => line.primaryYao === '阳' && line.changedYao === '阳' && !line.moving)).toBe(true);
    expect(record.lines[0]).toBe(initialLine);
    expect(initialLine.spirit).toBe('白虎');
    expect(initialLine.primaryBranch).toBe('壬戌');
  });

  it('打开旧记录不改变其空爻或手填变爻，不触发更新', () => {
    const record = emptyCase();
    record.lines[1].changedYao = '阴';
    const previous = structuredClone(record.lines);
    const onChange = vi.fn();
    createLinePicker(document.body, record.lines, onChange);
    expect(record.lines).toEqual(previous);
    expect(onChange).not.toHaveBeenCalled();
    expect(buttons()[0].getAttribute('aria-label')).toContain('未填');
    buttons()[0].click();
    expect(record.lines[0].primaryYao).toBe('阳');
  });
});
