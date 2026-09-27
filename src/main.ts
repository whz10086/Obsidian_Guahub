import {
  App, ItemView, MarkdownRenderer, Modal, Notice, Plugin, PluginSettingTab,
  Setting, TFile, TFolder, WorkspaceLeaf, normalizePath, parseYaml,
} from 'obsidian';
import {
  CaseData, CaseStatus, LINE_NAMES, Yao, emptyCase,
  parseCase, safeFileStem, serializeCase,
} from './model';
import { deriveChart } from './hexagrams';
import { createLinePicker } from './line-picker';
import { calculate, fiveElement, CALCULATION_RULE } from './calculation';

const VIEW_TYPE = 'gua-casebook-view';

interface CasebookSettings {
  folder: string;
  appearance: 'paper' | 'theme';
  fiveElementColors: boolean;
}

const DEFAULT_SETTINGS: CasebookSettings = {
  folder: '玄/六爻/个人卦例',
  appearance: 'paper',
  fiveElementColors: true,
};

function validFolder(input: string): string {
  const raw = input.trim().replace(/\\/g, '/');
  if (!raw || raw.startsWith('/') || /^[a-z]:/i.test(raw) || raw.split('/').includes('..')) {
    throw new Error('请填写库内的相对文件夹路径，不能使用上级目录。');
  }
  const normalized = normalizePath(raw);
  if (!normalized || normalized === '.' || normalized === '.obsidian' || normalized.startsWith('.obsidian/')) {
    throw new Error('请选择普通笔记文件夹。');
  }
  return normalized;
}

function button(parent: HTMLElement, text: string, onClick: () => void, primary = false): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = primary ? 'gua-button gua-button--primary' : 'gua-button';
  el.textContent = text;
  el.addEventListener('click', onClick);
  parent.appendChild(el);
  return el;
}

function element(parent: HTMLElement, tag: string, className?: string, text?: string): HTMLElement {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  parent.appendChild(el);
  return el;
}

function colored(parent: HTMLElement, text: string, enabled: boolean): void {
  const classes: Record<string, string> = { 木: 'wood', 火: 'fire', 土: 'earth', 金: 'metal', 水: 'water' };
  for (const char of text) element(parent, 'span', enabled && fiveElement(char) ? `gua-element-${classes[fiveElement(char)]}` : undefined, char);
}

function renderCalendar(parent: HTMLElement, record: CaseData, colors: boolean): void {
  const card = element(parent, 'section', 'gua-card gua-calendar');
  colored(element(card, 'div', 'gua-pillars'), record.pillars, colors);
  const voids = element(card, 'div', 'gua-voids');
  record.voidBranches.split(' / ').forEach((value, i) => element(voids, 'span', i === 2 ? 'gua-day-void' : undefined, value));
  if (record.chartInfo) {
    const life = element(card, 'div', 'gua-calendar-extra');
    element(life, 'span', 'gua-muted', '十二：');
    colored(life, record.chartInfo.longevity, colors);
    life.title = '日干五行的长生、帝旺、墓、绝；水土同长生申';
    const spirits = element(card, 'div', 'gua-calendar-extra');
    element(spirits, 'span', 'gua-muted', '神煞：');
    colored(spirits, record.chartInfo.spirits, colors);
  }
}

export default class GuaCasebookPlugin extends Plugin {
  settings: CasebookSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.registerView(VIEW_TYPE, leaf => new CasebookView(leaf, this));
    this.addRibbonIcon('book-open', '打开卦例档案', () => { void this.openCasebook(); });
    this.addCommand({ id: 'open-casebook', name: '打开卦例档案', callback: () => { void this.openCasebook(); } });
    this.addCommand({ id: 'new-case', name: '新建卦例', callback: () => {
      void this.openCasebook().then(() => new CaseEditorModal(this.app, this, emptyCase(), () => this.refreshViews()).open());
    } });
    this.addSettingTab(new CasebookSettingTab(this.app, this));
  }

  async openCasebook(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    const leaf = existing ?? this.app.workspace.getLeaf('tab');
    if (!existing) await leaf.setViewState({ type: VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  async refreshViews(selectedId?: string): Promise<void> {
    const views = this.app.workspace.getLeavesOfType(VIEW_TYPE)
      .map(leaf => leaf.view)
      .filter((view): view is CasebookView => view instanceof CasebookView);
    await Promise.all(views.map(view => view.refresh(selectedId)));
  }

  async listCases(): Promise<CaseData[]> {
    const folder = validFolder(this.settings.folder);
    const files = this.app.vault.getMarkdownFiles()
      .filter(file => file.path.startsWith(`${folder}/`));
    const records = await Promise.all(files.map(async file => {
      try { return parseCase(await this.app.vault.cachedRead(file), file.path, parseYaml); }
      catch { return null; }
    }));
    return records.filter((record): record is CaseData => record !== null)
      .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  }

  private async ensureFolder(folder: string): Promise<void> {
    const parts = folder.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const path = parts.slice(0, i).join('/');
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (existing && !(existing instanceof TFolder)) throw new Error(`路径已被文件占用：${path}`);
      if (!existing) await this.app.vault.createFolder(path);
    }
  }

  async saveCase(record: CaseData): Promise<void> {
    record.question = record.question.trim();
    if (!record.question) throw new Error('请填写占问。');
    Object.assign(record, calculate(record.date, record.lines));
    const content = serializeCase(record);
    if (record.path) {
      const existing = this.app.vault.getAbstractFileByPath(record.path);
      if (!(existing instanceof TFile)) throw new Error('原卦例文件已不存在，请重新打开卦例库。');
      await this.app.vault.process(existing, current => {
        if (current !== record.sourceContent) {
          throw new Error('这条卦例已在别处修改。请复制未保存的内容，关闭编辑框后重新打开，再合并修改。');
        }
        return content;
      });
    } else {
      const folder = validFolder(this.settings.folder);
      await this.ensureFolder(folder);
      const date = record.date.slice(0, 10) || '未定日期';
      const name = `${date}-${safeFileStem(record.question)}-${record.id.slice(0, 8)}.md`;
      const file = await this.app.vault.create(`${folder}/${name}`, content);
      record.path = file.path;
    }
    record.sourceContent = content;
    await this.refreshViews(record.id);
  }

  async trashCase(record: CaseData): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(record.path);
    if (!(file instanceof TFile)) throw new Error('找不到这条卦例的文件。');
    await this.app.fileManager.trashFile(file);
    await this.refreshViews();
  }
}

class CasebookSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: GuaCasebookPlugin) { super(app, plugin); }

  display(): void {
    this.containerEl.empty();
    new Setting(this.containerEl)
      .setName('卦例文件夹')
      .setDesc('库内相对路径。新卦例会保存在这里；已有卦例不会移动。')
      .addText(text => text.setPlaceholder(DEFAULT_SETTINGS.folder).setValue(this.plugin.settings.folder)
        .onChange(async value => {
          try {
            const folder = validFolder(value);
            this.plugin.settings.folder = folder;
            await this.plugin.saveData(this.plugin.settings);
            await this.plugin.refreshViews();
          } catch { /* Keep the prior valid folder until the path is complete. */ }
        }));
    new Setting(this.containerEl)
      .setName('外观')
      .setDesc('轻纸感会随明暗模式调整；跟随主题使用 Obsidian 的界面颜色。')
      .addDropdown(dropdown => dropdown.addOption('paper', '轻纸感').addOption('theme', '跟随主题')
        .setValue(this.plugin.settings.appearance)
        .onChange(async value => {
          this.plugin.settings.appearance = value === 'theme' ? 'theme' : 'paper';
          await this.plugin.saveData(this.plugin.settings);
          await this.plugin.refreshViews();
        }));
    new Setting(this.containerEl)
      .setName('五行文字色')
      .setDesc('自动按五行为天干、地支与六神着色；关闭后保留动爻和世应标记。')
      .addToggle(toggle => toggle.setValue(this.plugin.settings.fiveElementColors).onChange(async value => {
        this.plugin.settings.fiveElementColors = value;
        await this.plugin.saveData(this.plugin.settings);
        await this.plugin.refreshViews();
      }));
  }
}

class CasebookView extends ItemView {
  private records: CaseData[] = [];
  private selectedId = '';
  private query = '';
  private statusFilter: '全部' | CaseStatus = '全部';
  private detailOpen = false;
  private root!: HTMLElement;
  private listEl!: HTMLElement;
  private detailEl!: HTMLElement;
  private countEl!: HTMLElement;
  private refreshTimer: number | undefined;

  constructor(leaf: WorkspaceLeaf, private plugin: GuaCasebookPlugin) { super(leaf); }
  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return '卦例档案'; }
  getIcon(): string { return 'book-open'; }

  async onOpen(): Promise<void> {
    this.registerEvent(this.app.vault.on('create', file => this.scheduleRefresh(file.path)));
    this.registerEvent(this.app.vault.on('modify', file => this.scheduleRefresh(file.path)));
    this.registerEvent(this.app.vault.on('delete', file => this.scheduleRefresh(file.path)));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      this.scheduleRefresh(file.path);
      this.scheduleRefresh(oldPath);
    }));
    await this.refresh();
  }

  async onClose(): Promise<void> {
    if (this.refreshTimer !== undefined) window.clearTimeout(this.refreshTimer);
  }

  private scheduleRefresh(path: string): void {
    let folder: string;
    try { folder = validFolder(this.plugin.settings.folder); } catch { return; }
    if (!path.startsWith(`${folder}/`)) return;
    if (this.refreshTimer !== undefined) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => { void this.refresh(); }, 180);
  }

  async refresh(selectedId?: string): Promise<void> {
    try { this.records = await this.plugin.listCases(); }
    catch (error) {
      new Notice(error instanceof Error ? error.message : '读取卦例失败。');
      this.records = [];
    }
    if (selectedId) this.selectedId = selectedId;
    if (!this.records.some(record => record.id === this.selectedId)) this.selectedId = this.records[0]?.id ?? '';
    this.render();
  }

  private render(): void {
    this.contentEl.empty();
    this.root = element(this.contentEl, 'div', 'gua-casebook');
    if (this.plugin.settings.appearance === 'theme') this.root.classList.add('is-theme-native');
    if (this.detailOpen) this.root.classList.add('is-detail-open');
    const header = element(this.root, 'div', 'gua-header');
    element(header, 'h1', undefined, '卦例档案');
    this.countEl = element(header, 'span', 'gua-muted');
    const toolbar = element(this.root, 'div', 'gua-toolbar');
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'gua-search';
    search.placeholder = '检索占问、卦名、标签、判断与反馈';
    search.setAttribute('aria-label', '检索卦例');
    search.value = this.query;
    search.addEventListener('input', () => { this.query = search.value; this.renderPanels(); });
    toolbar.appendChild(search);
    const filter = document.createElement('select');
    filter.setAttribute('aria-label', '按反馈状态筛选');
    for (const value of ['全部', '待反馈', '已反馈'] as const) {
      const option = document.createElement('option'); option.value = value; option.textContent = value;
      filter.appendChild(option);
    }
    filter.value = this.statusFilter;
    filter.addEventListener('change', () => { this.statusFilter = filter.value as typeof this.statusFilter; this.renderPanels(); });
    toolbar.appendChild(filter);
    button(toolbar, '新建卦例', () => new CaseEditorModal(this.app, this.plugin, emptyCase(), () => this.refresh()).open(), true);
    const layout = element(this.root, 'div', 'gua-layout');
    this.listEl = element(layout, 'div', 'gua-list');
    this.detailEl = element(layout, 'div', 'gua-detail');
    this.renderPanels();
  }

  private filteredRecords(): CaseData[] {
    const words = this.query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    return this.records.filter(record => {
      if (this.statusFilter !== '全部' && record.status !== this.statusFilter) return false;
      const text = [record.question, record.primaryName, record.changedName, record.date,
        record.tags.join(' '), record.judgment, record.feedback, record.review, record.learningNotes].join(' ').toLocaleLowerCase();
      return words.every(word => text.includes(word));
    });
  }

  private renderPanels(): void {
    const filtered = this.filteredRecords();
    this.countEl.textContent = `${filtered.length} / ${this.records.length} 例`;
    if (!filtered.some(record => record.id === this.selectedId)) this.selectedId = filtered[0]?.id ?? '';
    if (!this.selectedId) {
      this.detailOpen = false;
      this.root.classList.remove('is-detail-open');
    }
    this.listEl.empty();
    this.detailEl.empty();
    if (filtered.length === 0) {
      element(this.listEl, 'div', 'gua-empty', this.records.length === 0 ? '还没有卦例。点击“新建卦例”开始记录。' : '没有匹配的卦例。');
      element(this.detailEl, 'div', 'gua-empty', '选择一条卦例查看详情。');
      return;
    }
    for (const record of filtered) {
      const item = element(this.listEl, 'button', 'gua-list-item') as HTMLButtonElement;
      item.type = 'button';
      if (record.id === this.selectedId) item.classList.add('is-active');
      item.setAttribute('aria-selected', record.id === this.selectedId ? 'true' : 'false');
      element(item, 'div', 'gua-list-title', record.question || '未命名占问');
      element(item, 'div', 'gua-list-summary', `${record.primaryName || '未填本卦'} → ${record.changedName || '未填变卦'}`);
      const meta = element(item, 'div', 'gua-meta');
      element(meta, 'span', 'gua-date', record.date.replace('T', ' '));
      element(meta, 'span', `gua-status${record.status === '已反馈' ? ' is-complete' : ''}`, record.status);
      item.addEventListener('click', () => {
        this.selectedId = record.id;
        this.detailOpen = true;
        this.root.classList.add('is-detail-open');
        this.renderPanels();
      });
    }
    const selected = filtered.find(record => record.id === this.selectedId);
    if (selected) this.renderDetail(selected);
  }

  private renderDetail(record: CaseData): void {
    try { record = { ...record, ...calculate(record.date, record.lines) }; }
    catch { element(this.detailEl, 'p', 'gua-muted', '此旧卦例的时间或六爻不完整，暂显示原有记录；编辑补齐后可自动排盘。'); }
    const back = element(this.detailEl, 'button', 'gua-back', '← 返回列表') as HTMLButtonElement;
    back.type = 'button';
    back.addEventListener('click', () => {
      this.detailOpen = false;
      this.root.classList.remove('is-detail-open');
    });
    element(this.detailEl, 'h2', 'gua-detail-title', record.question);
    const meta = element(this.detailEl, 'div', 'gua-meta');
    element(meta, 'time', 'gua-date', record.date.replace('T', ' '));
    element(meta, 'span', `gua-status${record.status === '已反馈' ? ' is-complete' : ''}`, record.status);
    if (record.method) element(meta, 'span', undefined, `起卦：${record.method}`);

    if (record.tags.length) {
      const tags = element(this.detailEl, 'div', 'gua-tags');
      for (const tag of record.tags) element(tags, 'span', 'gua-tag', tag);
    }
    const actions = element(this.detailEl, 'div', 'gua-detail-actions');
    button(actions, '编辑', () => new CaseEditorModal(this.app, this.plugin, record, () => this.refresh(record.id)).open(), true);
    button(actions, '打开笔记', () => {
      const file = this.app.vault.getAbstractFileByPath(record.path);
      if (file instanceof TFile) void this.app.workspace.getLeaf('tab').openFile(file);
    });
    button(actions, '移到回收站', () => new DeleteConfirmModal(this.app, record.question, async () => {
      await this.plugin.trashCase(record);
      new Notice('卦例已移到回收站。');
    }).open());
    renderCalendar(this.detailEl, record, this.plugin.settings.fiveElementColors);
    renderHex(this.detailEl, record, this.plugin.settings.fiveElementColors);
    element(this.detailEl, 'p', 'gua-rule gua-muted', CALCULATION_RULE);
    this.renderTextSection(record, '当时判断', record.judgment);
    this.renderTextSection(record, '实际反馈', record.feedback);
    this.renderTextSection(record, '复盘', record.review);
    this.renderTextSection(record, '听课思路与感悟', record.learningNotes || '');
  }

  private renderTextSection(record: CaseData, heading: string, content: string): void {
    const card = element(this.detailEl, 'section', 'gua-card');
    element(card, 'h3', undefined, heading);
    if (!content.trim()) {
      element(card, 'p', 'gua-muted', '尚未填写');
      return;
    }
    const body = element(card, 'div', 'gua-prose');
    void MarkdownRenderer.render(this.app, content, body, record.path, this);
  }
}

function renderHex(parent: HTMLElement, record: CaseData, colors: boolean): void {
    const card = element(parent, 'section', 'gua-card');
    element(card, 'h3', undefined, '卦盘');
    const hex = element(card, 'div', 'gua-hex');
    const titles = element(hex, 'div', 'gua-hex-title');
    element(titles, 'span', undefined, '六神');
    const mainTitle = element(titles, 'span', undefined, record.primaryName || '本卦');
    if (record.chartInfo) element(mainTitle, 'small', 'gua-palace', record.chartInfo.primaryPalace);
    element(titles, 'span', undefined, '动');
    const changedTitle = element(titles, 'span', undefined, record.changedName || '变卦');
    if (record.chartInfo) element(changedTitle, 'small', 'gua-palace', record.chartInfo.changedPalace);
    for (let i = 0; i < LINE_NAMES.length; i++) {
      const line = record.lines[i];
      const row = element(hex, 'div', `gua-hex-row${line.moving ? ' is-moving' : ''}`);
      row.setAttribute('aria-label', LINE_NAMES[i]);
      const spirit = element(row, 'span', 'gua-hex-spirit', line.spirit || LINE_NAMES[i]);
      const spiritColor: Record<string, string> = { 青龙: 'wood', 朱雀: 'fire', 勾陈: 'earth', 腾蛇: 'earth', 白虎: 'metal', 玄武: 'water' };
      if (colors && spiritColor[line.spirit]) spirit.classList.add(`gua-element-${spiritColor[line.spirit]}`);
      renderHexPart(row, colors, line.primaryRelative, line.primaryBranch, line.primaryYao, line.role, line.hidden);
      element(row, 'span', 'gua-hex-moving', line.moving ? (line.primaryYao === '阳' ? '○' : line.primaryYao === '阴' ? '×' : '动') : '');
      renderHexPart(row, colors, line.changedRelative, line.changedBranch, line.changedYao, line.changedRole);
    }
  }

function renderHexPart(parent: HTMLElement, colors: boolean, relative: string, branch: string, yao: Yao, role: string, hidden = ''): void {
    const part = element(parent, 'div', parent.children.length === 1 ? 'gua-hex-primary' : 'gua-hex-changed');
    element(part, 'span', 'gua-hex-relative', relative || '—');
    const branchEl = element(part, 'span', 'gua-hex-branch');
    colored(branchEl, branch || '—', colors);
    const symbol = element(part, 'span', `gua-yao ${yao === '阴' ? 'is-yin' : yao === '阳' ? 'is-yang' : 'is-unset'}`, yao ? undefined : '—');
    symbol.setAttribute('role', 'img');
    symbol.setAttribute('aria-label', yao === '阴' ? '阴爻' : yao === '阳' ? '阳爻' : '爻位未填');
    if (role) element(part, 'span', 'gua-hex-role', role);
    if (hidden) element(part, 'span', 'gua-hex-hidden', `伏：${hidden}`);
  }


class DeleteConfirmModal extends Modal {
  constructor(app: App, private question: string, private deleteCase: () => Promise<void>) { super(app); }
  onOpen(): void {
    this.contentEl.empty();
    element(this.contentEl, 'h2', undefined, '移到回收站');
    element(this.contentEl, 'p', undefined, `确定移除“${this.question}”？可在 Obsidian 回收站恢复。`);
    const actions = element(this.contentEl, 'div', 'gua-detail-actions');
    button(actions, '取消', () => this.close());
    button(actions, '移到回收站', () => {
      void this.deleteCase().then(() => this.close()).catch(error =>
        new Notice(error instanceof Error ? error.message : '移除失败。'));
    }, true);
  }
}

class CaseEditorModal extends Modal {
  constructor(app: App, private plugin: GuaCasebookPlugin, private original: CaseData,
    private afterSave: () => void | Promise<void>) { super(app); }

  onOpen(): void {
    this.contentEl.empty();
    this.modalEl.addClass('gua-case-editor');
    this.contentEl.addClass('gua-casebook', 'gua-editor-modal');
    this.contentEl.toggleClass('is-theme-native', this.plugin.settings.appearance === 'theme');
    const record: CaseData = { ...this.original, tags: [...this.original.tags], lines: this.original.lines.map(line => ({ ...line })) };
    if (!record.path) {
      // 新建界面明确显示六个阳爻，供用户逐爻点选；已有记录保留原值。
      record.lines.forEach(line => { line.primaryYao = '阳'; line.moving = false; });
      Object.assign(record, deriveChart(record.lines));
      record.method = record.method || '手动点选';
    }
    element(this.contentEl, 'h2', undefined, record.path ? '编辑卦例' : '新建卦例');
    const form = element(this.contentEl, 'form', 'gua-form') as HTMLFormElement;
    const question = this.input(form, '占问 *', record.question, 'text', '用一句话说明所占之事');
    const date = this.input(form, '起卦时间', record.date, 'datetime-local');
    date.required = true;
    date.min = '1900-01-01T00:00';
    date.max = '2100-12-31T23:59:59';
    date.step = '1';
    element(form, 'p', 'gua-rule gua-muted', CALCULATION_RULE);
    const picker = element(form, 'div');
    const preview = element(form, 'div', 'gua-auto-preview');
    const recompute = (): boolean => {
      preview.replaceChildren();
      record.date = date.value;
      try {
        const calculated = calculate(record.date, record.lines);
        // Keep picker line identities, so every later click uses the latest draft.
        calculated.lines.forEach((line, i) => Object.assign(record.lines[i], line));
        const { lines: _lines, ...metadata } = calculated;
        Object.assign(record, metadata);
        renderCalendar(preview, record, this.plugin.settings.fiveElementColors);
        renderHex(preview, record, this.plugin.settings.fiveElementColors);
        return true;
      } catch (error) {
        element(preview, 'p', 'gua-calc-error', error instanceof Error ? error.message : '排盘失败。');
        return false;
      }
    };
    createLinePicker(picker, record.lines, () => { recompute(); });
    date.addEventListener('input', recompute);
    recompute();
    const notes = element(form, 'details', 'gua-advanced') as HTMLDetailsElement;
    notes.open = Boolean(record.path);
    element(notes, 'summary', undefined, '标签、判断与反馈（选填）');
    const noteFields = element(notes, 'div', 'gua-form gua-advanced-body');
    const status = this.select(noteFields, '反馈状态', ['待反馈', '已反馈'], record.status);
    const tags = this.input(noteFields, '标签', record.tags.join('，'), 'text', '用逗号分隔');
    const judgment = this.textarea(noteFields, '当时判断', record.judgment);
    const feedback = this.textarea(noteFields, '实际反馈', record.feedback);
    const review = this.textarea(noteFields, '复盘', record.review);
    const learning = element(form, 'details', 'gua-advanced') as HTMLDetailsElement;
    learning.open = Boolean(record.learningNotes);
    element(learning, 'summary', undefined, '听课思路与感悟（选填）');
    const learningFields = element(learning, 'div', 'gua-form gua-advanced-body');
    element(learningFields, 'p', 'gua-muted', '记录老师的断卦思路、自己的理解、疑问，以及对其他卦例的启发。');
    const learningNotes = this.textarea(learningFields, '听课笔记', record.learningNotes || '');
    learningNotes.placeholder = '例如：老师先看什么？我原先怎么想？哪里有新的理解？还有哪些疑问？';
    learningNotes.rows = 8;
    const actions = element(form, 'div', 'gua-detail-actions');
    button(actions, '取消', () => this.close());
    const save = document.createElement('button');
    save.type = 'submit'; save.className = 'gua-button gua-button--primary'; save.textContent = '保存卦例';
    actions.appendChild(save);
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (!question.value.trim()) { new Notice('请填写占问。'); question.focus(); return; }
      if (!recompute()) { new Notice('请补齐有效时间和六爻后保存。'); return; }
      save.disabled = true;
      record.question = question.value.trim();
      record.date = date.value;
      record.status = status.value === '已反馈' ? '已反馈' : '待反馈';
      record.tags = [...new Set(tags.value.split(/[,，、]/).map(tag => tag.trim()).filter(Boolean))];
      record.method = '手动点选 · 自动排盘';
      record.judgment = judgment.value;
      record.feedback = feedback.value;
      record.review = review.value;
      record.learningNotes = learningNotes.value;
      void this.plugin.saveCase(record)
        .then(() => { this.close(); void this.afterSave(); new Notice('卦例已保存。'); })
        .catch(error => new Notice(error instanceof Error ? error.message : '保存失败。'))
        .finally(() => { save.disabled = false; });
    });
  }

  private input(parent: HTMLElement, label: string, value: string, type = 'text', placeholder = ''): HTMLInputElement {
    const wrapper = element(parent, 'label');
    element(wrapper, 'span', undefined, label);
    const input = document.createElement('input');
    input.type = type; input.value = value; input.placeholder = placeholder;
    wrapper.appendChild(input);
    return input;
  }

  private textarea(parent: HTMLElement, label: string, value: string): HTMLTextAreaElement {
    const wrapper = element(parent, 'label');
    element(wrapper, 'span', undefined, label);
    const input = document.createElement('textarea');
    input.rows = 5; input.value = value;
    wrapper.appendChild(input);
    return input;
  }

  private select(parent: HTMLElement, label: string,
    options: Array<string | { value: string; label: string }>, value: string): HTMLSelectElement {
    const wrapper = element(parent, 'label');
    element(wrapper, 'span', undefined, label);
    const select = document.createElement('select');
    for (const item of options) {
      const option = document.createElement('option');
      option.value = typeof item === 'string' ? item : item.value;
      option.textContent = typeof item === 'string' ? item : item.label;
      select.appendChild(option);
    }
    select.value = value;
    wrapper.appendChild(select);
    return select;
  }

}
