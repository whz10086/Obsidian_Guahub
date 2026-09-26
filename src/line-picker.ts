import { LINE_NAMES, type LineData } from './model';
import { deriveChart, hexagramName } from './hexagrams';

/** 只操作编辑框内的草稿；自动排盘和保存由上层统一处理。 */
export function createLinePicker(parent: HTMLElement, lines: LineData[],
  onChange: (primaryName: string, changedName: string) => void): void {
  if (lines.length !== 6) throw new Error('六爻录入需要六个爻位。');
  const doc = parent.ownerDocument;
  const make = (tag: string, className: string, text = '') => {
    const el = doc.createElement(tag);
    el.className = className;
    el.textContent = text;
    return el;
  };
  const root = make('section', 'gua-quick-input');
  parent.appendChild(root);
  const heading = make('div', 'gua-entry-heading');
  root.appendChild(heading);
  heading.appendChild(make('span', 'gua-entry-mode', '手动点选'));
  const summary = make('span', 'gua-entry-summary');
  summary.setAttribute('aria-live', 'polite');
  heading.appendChild(summary);
  const counter = make('span', 'gua-entry-counter');
  heading.appendChild(counter);
  root.appendChild(make('p', 'gua-entry-help', '点击爻线切换阴阳，点击“动”标记动爻。'));
  const board = make('div', 'gua-yao-picker');
  board.setAttribute('aria-label', '六爻点选，从上爻到初爻');
  root.appendChild(board);
  const controls = lines.map((line, index) => {
    const row = make('div', 'gua-pick-row');
    board.appendChild(row);
    row.appendChild(make('span', 'gua-pick-label', LINE_NAMES[index]));
    const yao = make('button', 'gua-line-toggle') as HTMLButtonElement;
    yao.type = 'button';
    const stroke = make('span', 'gua-line-stroke');
    stroke.setAttribute('aria-hidden', 'true');
    yao.appendChild(stroke);
    row.appendChild(yao);
    const moving = make('button', 'gua-move-toggle', '动') as HTMLButtonElement;
    moving.type = 'button';
    row.appendChild(moving);
    yao.addEventListener('click', () => {
      line.primaryYao = line.primaryYao === '阳' ? '阴' : '阳';
      updateChart();
    });
    moving.addEventListener('click', () => {
      line.moving = !line.moving;
      updateChart();
    });
    return { row, yao, stroke, moving };
  });
  const footer = make('div', 'gua-entry-footer');
  root.appendChild(footer);
  const reset = make('button', 'gua-button', '重置卦象') as HTMLButtonElement;
  reset.type = 'button';
  reset.title = '将六爻设为阳爻，并清除动爻';
  footer.appendChild(reset);
  reset.addEventListener('click', () => {
    for (const line of lines) { line.primaryYao = '阳'; line.moving = false; }
    updateChart();
  });
  footer.appendChild(make('span', 'gua-muted', '卦名与变爻随点选更新'));

  function refresh(): void {
    const primary = hexagramName(lines.map(line => line.primaryYao));
    const changed = hexagramName(lines.map(line => line.changedYao));
    const movingCount = lines.filter(line => line.moving).length;
    summary.textContent = primary && changed
      ? (movingCount ? `${primary} 之 ${changed}` : `${primary} · 静卦`) : '尚有未填爻位';
    counter.textContent = `${movingCount} 动爻`;
    controls.forEach(({ row, yao, stroke, moving }, index) => {
      const line = lines[index];
      row.classList.toggle('is-moving', line.moving);
      yao.classList.toggle('is-yang', line.primaryYao === '阳');
      yao.classList.toggle('is-yin', line.primaryYao === '阴');
      yao.classList.toggle('is-unset', line.primaryYao === '');
      stroke.textContent = line.primaryYao ? '' : '未填 · 点击设为阳爻';
      yao.setAttribute('aria-label', `${LINE_NAMES[index]}：${line.primaryYao ? `${line.primaryYao}爻` : '未填'}，点击切换阴阳`);
      moving.setAttribute('aria-label', `${LINE_NAMES[index]}动爻`);
      moving.setAttribute('aria-pressed', String(line.moving));
      moving.title = line.moving ? '取消动爻' : '设为动爻';
    });
  }

  function updateChart(): void {
    const chart = deriveChart(lines);
    chart.lines.forEach((line, index) => Object.assign(lines[index], line));
    refresh();
    onChange(chart.primaryName, chart.changedName);
  }

  // 打开已有记录只显示原值，避免用户未操作就改变旧卦盘。
  refresh();
}
