import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { emptyCase, parseCase, safeFileStem, serializeCase } from '../src/model';

describe('卦例 Markdown', () => {
  it('保存后能读回六爻、标签、判断和反馈', () => {
    const record = emptyCase(new Date('2026-09-26T07:44:46Z'));
    record.question = '这次岗位调整能否落实？';
    record.primaryName = '乾为天';
    record.changedName = '天火同人';
    record.status = '已反馈';
    record.tags = ['工作', '复盘'];
    record.pillars = '丙午年 丁酉月 癸卯日 庚申时';
    record.lines[4] = {
      spirit: '青龙', hidden: '伏神|示例', primaryRelative: '妻财', primaryBranch: '甲寅',
      primaryYao: '阳', role: '世', moving: true, changedRelative: '父母',
      changedBranch: '己丑', changedYao: '阴', changedRole: '应',
    };
    record.judgment = '当时判断第一行\n## 实际反馈\n这只是判断中的小标题';
    record.feedback = '## 复盘\n实际结果：已落实';
    record.review = '## 自己的补充标题\n继续复盘';
    record.learningNotes = '## 老师的思路\n先看用神，再结合动爻。\n## 我的疑问\n为什么这样取用？';
    const text = serializeCase(record);
    const reread = parseCase(text, '玄/六爻/个人卦例/记录.md', parseYaml);
    expect(reread).toEqual({ ...record, path: '玄/六爻/个人卦例/记录.md', sourceContent: text });
    expect(text).toContain('伏神\\|示例');
    expect(reread?.lines[0].primaryYao).toBe('');
  });

  it('只识别本插件标记的笔记，不导入课程目录中的普通卦例', () => {
    expect(parseCase('# 占问\n内容', '其他/普通笔记.md', parseYaml)).toBeNull();
    expect(parseCase('---\ntags: ["卦例"]\n---\n# 占问', '其他/旧卦例.md', parseYaml)).toBeNull();
  });

  it('兼容 Obsidian 属性编辑产生的普通 YAML 和列表标签', () => {
    const record = emptyCase();
    record.question = '测试占问';
    let text = serializeCase(record);
    text = text.replace(`gua-id: "${record.id}"`, `gua-id: ${record.id}`)
      .replace('tags: ["卦例"]', 'tags:\n  - 卦例\n  - 工作');
    const parsed = parseCase(text, '记录.md', parseYaml);
    expect(parsed?.id).toBe(record.id);
    expect(parsed?.tags).toEqual(['工作']);
  });

  it('重新保存时保留插件以外的属性和末尾附注', () => {
    const record = emptyCase();
    record.question = '占问';
    const text = serializeCase(record).replace('---\n\n# 占问', 'source: 自己的来源\n---\n\n# 占问') + '\n## 自己附加的资料\n原文';
    const parsed = parseCase(text, '记录.md', parseYaml);
    expect(parsed).not.toBeNull();
    expect(serializeCase(parsed!)).toContain('source: 自己的来源');
    expect(serializeCase(parsed!)).toContain('## 自己附加的资料\n原文');
  });

  it('旧卦例没有听课笔记时返回空文本，保留原复盘', () => {
    const record = emptyCase();
    record.review = '原有复盘';
    const old = serializeCase(record).replace(/\n## 听课思路与感悟\n[\s\S]*?(?=<!-- gua-casebook:document:end -->)/, '');
    const parsed = parseCase(old, '旧记录.md', parseYaml)!;
    expect(parsed.learningNotes).toBe('');
    expect(parsed.review).toBe('原有复盘');
  });

  it('文件名去掉 Windows 禁用字符', () => {
    expect(safeFileStem('占问: A/B? *')).toBe('占问 AB');
    expect(safeFileStem('...')).toBe('未命名卦例');
  });
});
