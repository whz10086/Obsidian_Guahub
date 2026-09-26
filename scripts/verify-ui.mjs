import { build } from 'esbuild';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'qa');
await mkdir(output, { recursive: true });

// Minimal host API for exercising the actual plugin view and editor in a browser.
// Vault writes stay in memory; no user notes or running Obsidian instance are touched.
const mock = `
import { parse } from 'yaml';
HTMLElement.prototype.empty = function () { this.replaceChildren(); };
HTMLElement.prototype.addClass = function (...names) { this.classList.add(...names); };
HTMLElement.prototype.toggleClass = function (name, enabled) { this.classList.toggle(name, enabled); };
export class Plugin {
  constructor(app) { this.app = app; this.commands = []; }
  async loadData() { return {}; }
  registerView(type, factory) { this.app.factory = factory; }
  addRibbonIcon() {}
  addCommand(command) { this.commands.push(command); }
  addSettingTab() {}
}
export class ItemView {
  constructor(leaf) { this.app = leaf.app; this.contentEl = document.createElement('div'); this.contentEl.className = 'view-content'; }
  registerEvent() {}
}
export class Modal {
  constructor(app) {
    this.app = app;
    this.modalEl = document.createElement('div'); this.modalEl.className = 'modal';
    this.contentEl = document.createElement('div'); this.contentEl.className = 'modal-content';
    this.modalEl.append(this.contentEl);
  }
  open() { document.body.append(this.modalEl); this.onOpen(); }
  close() { this.modalEl.remove(); }
}
export class Notice { constructor(message) { window.qa.notices.push(message); } }
export class PluginSettingTab {}
export class Setting {}
export class TFile {}
export class TFolder {}
export const normalizePath = value => value;
export const parseYaml = parse;
export const MarkdownRenderer = { render: async (app, text, el) => { el.textContent = text; } };
`;

const entry = `
import GuaPlugin from './src/main';
import { serializeCase, parseCase } from './src/model';
import { parse } from 'yaml';
(async () => {
  const leaves = [];
  const app = { vault: { on: () => ({}) }, workspace: {
    getLeavesOfType: () => leaves,
    getLeaf: () => {
      const leaf = { app, setViewState: async () => {
        leaf.view = app.factory(leaf); leaves.push(leaf);
        document.body.append(leaf.view.contentEl); await leaf.view.onOpen();
      } }; return leaf;
    },
    revealLeaf: async () => {},
  } };
  const plugin = new GuaPlugin(app);
  window.qa = { saved: null, notices: [] };
  plugin.listCases = async () => window.qa.saved ? [window.qa.saved] : [];
  plugin.saveCase = async record => {
    record.path = 'test-vault/example.md';
    window.qa.saved = parseCase(serializeCase(record), record.path, parse);
    await plugin.refreshViews(record.id);
  };
  await plugin.onload();
  window.qa.openNew = () => plugin.commands.find(command => command.id === 'new-case').callback();
  window.qa.openNew();
})();
`;
const bundle = await build({
  absWorkingDir: root,
  stdin: { contents: entry, resolveDir: root, loader: 'ts' },
  bundle: true, format: 'iife', write: false, logLevel: 'silent',
  plugins: [{ name: 'test-obsidian-host', setup(builder) {
    builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'host', namespace: 'test-host' }));
    builder.onLoad({ filter: /.*/, namespace: 'test-host' }, () => ({ contents: mock, resolveDir: root }));
  } }],
});

const css = await readFile(path.join(root, 'styles.css'), 'utf8');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const [width, dark] of [[320, false], [390, false], [390, true], [960, false]]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
    // A localhost origin supplies the secure-context Web Crypto API used by Obsidian.
    await page.route('http://127.0.0.1:4173/', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }));
    await page.goto('http://127.0.0.1:4173/');
    await page.setContent(`<!doctype html><html><head><meta charset="UTF-8"><style>
      body { margin: 0; font: 14px system-ui; --font-interface: system-ui; }
      .view-content { height: 100vh; }
      .modal { position: fixed; inset: 12px 0 auto; margin: auto; max-height: calc(100vh - 24px); overflow: auto; border: 1px solid #888; border-radius: 12px; }
      button { cursor: pointer; }
      ${css}</style></head><body class="${dark ? 'theme-dark' : 'theme-light'}"></body></html>`);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const editor = page.locator('.gua-editor-modal');
    await editor.getByRole('heading', { name: '新建卦例', exact: true }).waitFor();
    await editor.getByLabel('占问 *', { exact: true }).fill('点选示例：这次岗位调整能否落实？');
    await editor.getByLabel('起卦时间', { exact: true }).fill('2026-09-26T15:44:46');
    await editor.locator('.gua-move-toggle').nth(4).click();
    assert.equal(await editor.locator('.gua-entry-summary').textContent(), '乾为天 之 天火同人');
    const measurements = await editor.evaluate(el => ({
      width: el.clientWidth, scroll: el.scrollWidth,
      targets: [...el.querySelectorAll('.gua-line-toggle, .gua-move-toggle')].map(button => button.getBoundingClientRect().height),
    }));
    assert.ok(measurements.scroll <= measurements.width + 1, `Horizontal overflow at ${width}px`);
    assert.ok(measurements.targets.every(height => height >= 44), 'Touch target is too short');
    await page.screenshot({ path: path.join(output, `input-${width}-${dark ? 'dark' : 'light'}.png`) });

    // Real button keyboard semantics, then restore the screenshot's second moving line.
    const second = editor.locator('.gua-move-toggle').nth(4);
    await second.focus(); await page.keyboard.press('Space');
    assert.equal(await second.getAttribute('aria-pressed'), 'false');
    await page.keyboard.press('Space');
    await editor.getByRole('button', { name: '保存卦例', exact: true }).click();
    await editor.waitFor({ state: 'detached' });
    const saved = await page.evaluate(() => window.qa.saved);
    assert.equal(saved.changedName, '天火同人');
    assert.equal(saved.lines[4].changedYao, '阴');
    assert.equal(saved.pillars, '丙午年 丁酉月 癸卯日 庚申时');
    assert.equal(saved.lines[0].spirit, '白虎');
    assert.equal(saved.lines[0].primaryBranch, '壬戌');
    if (width < 760) await page.locator('.gua-list-item').first().click();
    await page.locator('.gua-detail .gua-hex').scrollIntoViewIfNeeded();
    const chart = page.locator('.gua-detail .gua-hex');
    assert.ok(await chart.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'Chart overflows');
    assert.equal(await chart.locator('.gua-hex-primary .gua-hex-branch').first().locator('.gua-element-water').textContent(), '壬');
    assert.equal(await chart.locator('.gua-hex-primary .gua-hex-branch').first().locator('.gua-element-earth').textContent(), '戌');
    await page.screenshot({ path: path.join(output, `chart-${width}-${dark ? 'dark' : 'light'}.png`) });
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    await editor.locator('.gua-line-toggle').first().click();
    await editor.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal((await page.evaluate(() => window.qa.saved)).primaryName, '乾为天');
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    assert.equal(await editor.locator('.gua-move-toggle').nth(4).getAttribute('aria-pressed'), 'true');
    assert.match(await editor.locator('.gua-line-toggle').first().getAttribute('aria-label'), /阳爻/);
    assert.equal(await editor.locator('.gua-pillars').textContent(), '丙午年 丁酉月 癸卯日 庚申时');
    assert.equal(await editor.getByLabel('六神', { exact: true }).count(), 0);
    await editor.getByLabel('当时判断', { exact: true }).fill('保留手填判断');
    await editor.locator('.gua-line-toggle').first().click();
    await editor.getByRole('button', { name: '保存卦例', exact: true }).click();
    await editor.waitFor({ state: 'detached' });
    const updated = await page.evaluate(() => window.qa.saved);
    assert.equal(updated.primaryName, '泽天夬');
    assert.equal(updated.changedName, '泽火革');
    assert.equal(updated.lines[0].spirit, '白虎');
    assert.equal(updated.lines[0].primaryBranch, '丁未');
    assert.equal(updated.lines[0].primaryYao, '阴');
    assert.equal(updated.judgment, '保留手填判断');
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    await editor.getByLabel('起卦时间', { exact: true }).fill('2026-09-27T15:44:46');
    assert.match(await editor.locator('.gua-pillars').textContent(), /甲辰日/);
    await editor.getByRole('button', { name: '保存卦例', exact: true }).click();
    await editor.waitFor({ state: 'detached' });
    assert.equal((await page.evaluate(() => window.qa.saved)).lines[5].spirit, '青龙');
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px ${dark ? 'dark' : 'light'}: picker, keyboard, save/read, reopen, cancel, no overflow`);
    await page.close();
  }
} finally { await browser.close(); }
