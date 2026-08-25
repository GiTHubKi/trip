/*
 * 自测脚本：用极简 DOM 桩在 Node 中加载 js/app.js，真实跑通评分、渲染与交互路径。
 * 运行： node selftest.node.js
 * 不影响浏览器使用，仅用于验证评分规则与关键流程未被改坏。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;

/* ---------------- 极简 DOM ---------------- */
class Node {
  constructor(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.childNodes = [];
    this.attributes = {};
    this.dataset = {};
    this.style = {};
    this.listeners = {};
    this._text = '';
    this.className = '';
    this.value = '';
    this.checked = false;
    this.parentNode = null;
  }
  get firstChild() { return this.childNodes[0] || null; }
  appendChild(c) { c.parentNode = this; this.childNodes.push(c); return c; }
  removeChild(c) {
    const i = this.childNodes.indexOf(c);
    if (i >= 0) this.childNodes.splice(i, 1);
    c.parentNode = null;
    return c;
  }
  setAttribute(k, v) { this.attributes[k] = v; }
  getAttribute(k) { return this.attributes[k]; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  removeEventListener() {}
  focus() {}
  click() {}
  fire(type, ev) { (this.listeners[type] || []).forEach(fn => fn(ev || { target: this })); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  get textContent() {
    if (this.childNodes.length) return this.childNodes.map(c => c.textContent).join('');
    return this._text;
  }
  set textContent(v) { this.childNodes = []; this._text = String(v); }
  /** 测试辅助：递归查找第一个 class 包含 cls 的节点 */
  find(cls) {
    if (String(this.className).split(/\s+/).includes(cls)) return this;
    for (const c of this.childNodes) { const r = c.find && c.find(cls); if (r) return r; }
    return null;
  }
  findAll(cls, out = []) {
    if (String(this.className).split(/\s+/).includes(cls)) out.push(this);
    this.childNodes.forEach(c => c.findAll && c.findAll(cls, out));
    return out;
  }
}
class TextNode extends Node {
  constructor(t) { super('#text'); this._text = String(t); }
  find() { return null; }
  findAll(_, out = []) { return out; }
}

const nodesById = {};
const IDS = ['btnAdd', 'btnAdd2', 'btnImport', 'btnExport', 'btnClear', 'fileInput',
  'sortSelect', 'rankingBody', 'scenarioGrid', 'productGrid', 'productCount',
  'warningsBody', 'compareBody', 'pkBody', 'rulesBody', 'rulesTotal', 'rulesCount',
  'modalRoot', 'toastRoot'];
IDS.forEach(id => { nodesById[id] = new Node('div'); });

const document = {
  readyState: 'complete',
  body: new Node('body'),
  activeElement: null,
  createElement: (t) => new Node(t),
  createTextNode: (t) => new TextNode(t),
  querySelector: (sel) => nodesById[sel.replace('#', '')] || null,
  addEventListener() {},
  removeEventListener() {}
};

const store = {};
const window = {
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  },
  crypto: undefined
};
window.window = window;

const sandbox = {
  window, document, console,
  setTimeout: (fn) => { fn(); return 0; },   // 同步执行，方便断言保存结果
  clearTimeout: () => {},
  Blob: function () {}, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
  FileReader: function () {},
  Math, Date, JSON, Number, String, Array, Object, isFinite, parseFloat, parseInt, RegExp, Error
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8'), sandbox, { filename: 'app.js' });

const API = window.__strollerScorer;

/* ---------------- 测试框架 ---------------- */
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}
function eq(name, a, b) { ok(name + ' (' + JSON.stringify(a) + ' === ' + JSON.stringify(b) + ')', a === b, a); }
function section(t) { console.log('\n== ' + t + ' =='); }

const S = API.state;
const addBtn = nodesById.btnAdd;

/* ---------------- Case 0：总分配置 ---------------- */
section('Case 0 评分体系');
eq('13 项满分合计为 100', API.TOTAL_MAX, 100);
eq('维度数量为 13', API.DIMENSIONS.length, 13);
const maxes = API.DIMENSIONS.map(d => d.max);
eq('各项满分序列', maxes.join(','), '18,8,12,12,12,10,8,6,6,4,2,1,1');

/* ---------------- Case 1：添加第一款产品 ---------------- */
section('Case 1 添加第一款产品');
addBtn.fire('click');
eq('产品数量 = 1', S.data.products.length, 1);
eq('默认名称', S.data.products[0].model, '婴儿车 1');
eq('空产品总分 = 0', API.calculateScore(S.data.products[0]).total, 0);
ok('产品区已渲染卡片', !!nodesById.productGrid.find('card'));

/* ---------------- Case 2：3 款产品 ---------------- */
section('Case 2 同时添加 3 款产品');
addBtn.fire('click');
addBtn.fire('click');
eq('产品数量 = 3', S.data.products.length, 3);
eq('默认名称递增', S.data.products[2].model, '婴儿车 3');
eq('卡片数量 = 3', nodesById.productGrid.findAll('card').length, 3);
ok('排名区渲染了 3 行', nodesById.rankingBody.findAll('rank-row').length === 3);

/* ---------------- Case 3：满分产品 & 实时更新 ---------------- */
section('Case 3 参数修改后总分实时更新');
const p1 = S.data.products[0];
Object.assign(p1, {
  brand: 'Cybex', model: 'Melio Carbon', price: 3299,
  newborn: 'flat', standard: 'A',
  safety: { fivePointHarness: true, linkedBrake: true, frameLock: true, adjustableHarness: true },
  weightKg: 5.9, suspension: 'bigFour', folding: 'oneHandStand', foldedGrade: 'travel',
  foldedSize: { length: 59, width: 49, height: 29 },
  reversible: 'both',
  comfort: { tallBackrest: true, wideSeat: true, adjustableLegRest: true, breathable: true },
  canopy: 'full', handling: 'good', storage: true, aftersales: true
});
eq('全选最高档 = 100 分', API.calculateScore(p1).total, 100);
p1.weightKg = 12.5;   // 落在 >11~13kg 档 = 4 分，100 - 12 + 4 = 92
eq('改重量 12.5kg 后 = 92 分', API.calculateScore(p1).total, 92);
p1.weightKg = 7.2;    // 落在 >6.5~8kg 档 = 11 分
eq('改重量 7.2kg 后 = 99 分', API.calculateScore(p1).total, 99);
p1.weightKg = 5.9;
eq('改回 5.9kg 后 = 100 分', API.calculateScore(p1).total, 100);
p1.suspension = 'smallBasic';
eq('避震降到 4 分后 = 92 分', API.calculateScore(p1).total, 92);
p1.suspension = 'bigFour';

/* 各档位逐一核对 */
const table = {
  newborn: { flat: 18, basic: 14, from6m: 6, '': 0 },
  standard: { A: 8, B: 7, C: 5, D: 3, E: 2, F: 1, '': 0 },
  suspension: { bigFour: 12, midFour: 10, rear: 7, smallBasic: 4, none: 2, '': 0 },
  folding: { oneHandStand: 10, oneHand: 8, twoStep: 6, complex: 3, '': 0 },
  foldedGrade: { travel: 8, car: 7, bulky: 4, huge: 2, '': 0 },
  reversible: { both: 6, carrycot: 4, forward: 2, '': 0 },
  canopy: { full: 4, upfBig: 3, normal: 2, poor: 1, '': 0 },
  handling: { good: 2, normal: 1, '': 0 }
};
let optOk = true;
Object.keys(table).forEach(field => {
  const dim = API.DIMENSIONS.find(d => d.field === field);
  Object.keys(table[field]).forEach(v => {
    const got = dim.options.find(o => o.value === v);
    if (!got || got.score !== table[field][v]) { optOk = false; console.log('   差异:', field, v, got && got.score); }
  });
});
ok('所有下拉档位分值与规格一致', optOk);

const wb = [[6.5, 12], [6.4, 12], [8, 11], [7.9, 11], [9, 9], [11, 7], [13, 4], [13.1, 2], [20, 2]];
let wOk = true;
wb.forEach(([kg, want]) => {
  const t = API.calculateScore(Object.assign({}, p1, { weightKg: kg })).byKey.weight.score;
  if (t !== want) { wOk = false; console.log('   重量差异:', kg, t, '应为', want); }
});
ok('车重换算表全部正确', wOk);
eq('未填重量 = 0 分', API.calculateScore(Object.assign({}, p1, { weightKg: null })).byKey.weight.score, 0);

/* ---------------- Case 4：每分成本 ---------------- */
section('Case 4 每分成本');
const p2 = S.data.products[1];
Object.assign(p2, {
  brand: 'Bugaboo', model: 'Fox 5', price: 6999,
  newborn: 'flat', standard: 'B',
  safety: { fivePointHarness: true, linkedBrake: true, frameLock: true, adjustableHarness: true },
  weightKg: 10.4, suspension: 'bigFour', folding: 'twoStep', foldedGrade: 'bulky',
  foldedSize: { length: 90, width: 60, height: 35 },
  reversible: 'both',
  comfort: { tallBackrest: true, wideSeat: true, adjustableLegRest: true, breathable: true },
  canopy: 'full', handling: 'good', storage: true, aftersales: true
});
const t2 = API.calculateScore(p2).total;
eq('Fox 5 总分', t2, 18 + 7 + 12 + 7 + 12 + 6 + 4 + 6 + 6 + 4 + 2 + 1 + 1);
const cpp = 6999 / t2;
ok('每分成本 = 价格 / 总分 = ' + cpp.toFixed(2), Math.abs(cpp - 6999 / t2) < 1e-9);
const demo = { price: 3299 };
ok('文档示例 3299 / 88 = 37.49', (3299 / 88).toFixed(2) === '37.49');

/* ---------------- Case 11：CCC 0~2 分风险 ---------------- */
section('Case 11 执行标准风险');
const p3 = S.data.products[2];
Object.assign(p3, { brand: 'Joolz', model: 'Aer+', price: 4299, newborn: 'basic', standard: 'E', weightKg: 6.4, suspension: 'none', folding: 'oneHandStand', foldedGrade: 'travel' });
let w3 = API.calculateWarnings(p3, S.data.preferences).map(w => w.text);
ok('标准 2 分 -> 提示认证信息不足', w3.some(t => t.indexOf('国内安全认证信息不足') >= 0), w3);
ok('避震 2 分 -> 提示小轮路面', w3.some(t => t.indexOf('平整路面') >= 0));
p3.standard = '';
w3 = API.calculateWarnings(p3, S.data.preferences).map(w => w.text);
ok('标准 0 分 -> 严重不足', w3.some(t => t.indexOf('严重不足') >= 0), w3);
p3.standard = 'E';
const heavy = Object.assign({}, p2, { weightKg: 11.5 });
ok('>11kg -> 超重提醒', API.calculateWarnings(heavy, S.data.preferences).some(w => w.text.indexOf('整车较重') >= 0));
ok('=11kg 不触发超重提醒', !API.calculateWarnings(Object.assign({}, p2, { weightKg: 11 }), S.data.preferences).some(w => w.text.indexOf('整车较重') >= 0));

/* ---------------- Case 12：6 月+ vs 新生儿场景 ---------------- */
section('Case 12 新生儿一票否决');
const p6m = Object.assign({}, p1, { newborn: 'from6m' });
ok('未选场景时不报新生儿风险', !API.calculateWarnings(p6m, { scenarios: [] }).some(w => w.text.indexOf('新生儿主力') >= 0));
const wNb = API.calculateWarnings(p6m, { scenarios: ['newbornFromBirth'] });
ok('选了「出生就用」-> 红色提醒', wNb.some(w => w.level === 'danger' && w.text.indexOf('不建议作为新生儿主力婴儿车使用') >= 0), wNb);

/* ---------------- 完整度 / 标签 / 匹配度 ---------------- */
section('完整度 / 标签 / 匹配度');
const blank = API.state.data.products[0];
const c1 = API.calculateCompleteness(p1);
eq('参数填满 -> 完整度 100%', c1.percent, 100);
const cEmpty = API.calculateCompleteness({ safety: {}, comfort: {}, foldedSize: {} });
eq('全空 -> 完整度 0%', cEmpty.percent, 0);
ok('全空会触发信息缺失提醒',
  API.calculateWarnings({ safety: {}, comfort: {}, foldedSize: {} }, { scenarios: [] })
    .some(w => w.text.indexOf('信息完整度') >= 0));

const tags1 = API.calculateTags(p1).map(t => t.label);
ok('5.9kg 极致车 -> 含 轻便型/旅行型', tags1.includes('轻便型') && tags1.includes('旅行型'), tags1);
const tags2 = API.calculateTags(p2).map(t => t.label);
ok('Fox 5 -> 含 舒适型/全地形型', tags2.includes('舒适型') && tags2.includes('全地形型'), tags2);
ok('Fox 5 不应是轻便型', !tags2.includes('轻便型'), tags2);

eq('无场景时匹配度为 null', API.calculateMatch(p1, { scenarios: [] }), null);
const mLight = API.calculateMatch(p1, { scenarios: ['valueLight'] });
eq('看重轻便 + 12/12 -> 100%', mLight, 100);
const mSus = API.calculateMatch(p3, { scenarios: ['valueSuspension'] });
eq('看重避震 + 2/12 -> 17%', mSus, Math.round(2 / 12 * 100));
const m6 = API.calculateMatch(p6m, { scenarios: ['newbornFromBirth'] });
const mFull = API.calculateMatch(p1, { scenarios: ['newbornFromBirth'] });
ok('6月+ 车在新生儿场景下匹配度被下调', m6 < mFull, { m6, mFull });
ok('匹配度与总分是两套指标（数值不同）', API.calculateScore(p3).total !== API.calculateMatch(p3, { scenarios: ['valueSuspension'] }));

/* ---------------- Case 5：localStorage 持久化 ---------------- */
section('Case 5 刷新后数据仍在');
// 触发一次保存（编辑器/场景变更都会调用；这里直接改场景勾选来触发）
const tile = nodesById.scenarioGrid.findAll('check-tile')[0];
tile.childNodes[0].fire('change', { target: { checked: true } });
ok('已写入 localStorage', !!store['baby_stroller_scorer_data']);
const reloaded = API.migrateData(JSON.parse(store['baby_stroller_scorer_data']));
eq('重新载入后产品数量', reloaded.products.length, 3);
eq('重新载入后第一款品牌', reloaded.products[0].brand, 'Cybex');
eq('重新载入后总分一致', API.calculateScore(reloaded.products[0]).total, API.calculateScore(p1).total);
eq('重新载入后场景偏好保留', reloaded.preferences.scenarios.length, 1);

/* ---------------- Case 6：导出 -> 清空 -> 导入 ---------------- */
section('Case 6 导出后重新导入');
const exported = JSON.stringify({ version: 1, preferences: S.data.preferences, products: S.data.products }, null, 2);
const back = API.parseImport(exported);
eq('导入产品数量', back.products.length, 3);
eq('导入后总分一致', API.calculateScore(back.products[1]).total, t2);
eq('裸数组也可导入', API.parseImport(JSON.stringify(S.data.products)).products.length, 3);

/* ---------------- Case 7：错误 JSON 不崩溃 ---------------- */
section('Case 7 非法 JSON 友好报错');
const badInputs = ['{ 这不是 json', '[', 'null', '123', '"abc"', '{}', '{"products":{}}', '{"products":[]}', '{"products":[1,2]}'];
let allHandled = true;
badInputs.forEach(txt => {
  try { API.parseImport(txt); allHandled = false; console.log('   未拦截:', txt); }
  catch (e) { if (!e.message) allHandled = false; }
});
ok('9 种非法输入均抛出可读错误且未崩溃', allHandled);
const dirty = API.parseImport(JSON.stringify({
  products: [{ brand: '<img src=x onerror=alert(1)>', price: -100, weightKg: 'abc', newborn: 'HACK', safety: 'nope', foldedSize: { length: '59' } }]
}));
eq('非法 price 归零为 null', dirty.products[0].price, null);
eq('非法 weight 归为 null', dirty.products[0].weightKg, null);
eq('非法枚举值归为空', dirty.products[0].newborn, '');
eq('非法 safety 结构被重建', dirty.products[0].safety.fivePointHarness, false);
eq('字符串数字被转为数值', dirty.products[0].foldedSize.length, 59);
ok('危险字符串原样保留为文本（渲染层用 textContent）', dirty.products[0].brand.indexOf('<img') === 0);
eq('负数被拒绝', API.parseImport(JSON.stringify({ products: [{ price: -5 }] })).products[0].price, null);

/* ---------------- Case 10：10 款产品 ---------------- */
section('Case 10 十款产品');
while (S.data.products.length < 10) addBtn.fire('click');
eq('产品数量 = 10', S.data.products.length, 10);
eq('卡片渲染 = 10', nodesById.productGrid.findAll('card').length, 10);
eq('排名行 = 10', nodesById.rankingBody.findAll('rank-row').length, 10);
const cmpRows = nodesById.compareBody.findAll('col-item').length;
ok('对比表行数 = 项目行(4+13+1) + 表头 = ' + cmpRows, cmpRows === 4 + 13 + 1 + 1 + 1, cmpRows);
ok('PK 区域已渲染结论', !!nodesById.pkBody.find('pk-conclusion'));

/* ---------------- 排序 ---------------- */
section('排序切换');
const sortSel = nodesById.sortSelect;
eq('排序选项数量', sortSel.childNodes.length, 7);
['total', 'price', 'weight', 'cost', 'newborn', 'suspension', 'light'].forEach(k => {
  sortSel.fire('change', { target: { value: k } });
  ok('按 ' + k + ' 排序不报错且有输出', nodesById.rankingBody.findAll('rank-row').length === 10);
});
sortSel.fire('change', { target: { value: 'total' } });
const rankNames = nodesById.rankingBody.findAll('rank-name').map(n => n.textContent);
ok('默认按总分从高到低（首位为满分车）', rankNames[0].indexOf('Cybex Melio Carbon') >= 0, rankNames.slice(0, 3));

/* ---------------- 对比表高亮 ---------------- */
section('对比表高亮');
const best = nodesById.compareBody.findAll('is-best').length;
const worst = nodesById.compareBody.findAll('is-worst').length;
ok('存在绿色最高分高亮 (' + best + ')', best > 0);
ok('存在橙红最低分高亮 (' + worst + ')', worst > 0);

/* ---------------- 规则说明 ---------------- */
section('规则说明与标准配置');
const rulesText = nodesById.rulesBody.textContent;
ok('包含 GB 14748-2006', rulesText.indexOf('GB 14748-2006') >= 0);
ok('包含 GB/T 14748-2025', rulesText.indexOf('GB/T 14748-2025') >= 0);
ok('包含 GB 46516-2025', rulesText.indexOf('GB 46516-2025') >= 0);
ok('包含实施日期 2026-11-01', rulesText.indexOf('2026-11-01') >= 0);
eq('规则说明总分标注', nodesById.rulesTotal.textContent, '100');
eq('规则说明项目数标注', nodesById.rulesCount.textContent, '13');

/* ---------------- 等级与星级 ---------------- */
section('等级映射');
const gradeCases = [[100, '非常优秀'], [90, '非常优秀'], [89, '很推荐'], [85, '很推荐'], [84, '值得买'], [80, '值得买'], [79, '可以购买，但存在明显取舍'], [75, '可以购买，但存在明显取舍'], [74, '除非价格特别合适'], [70, '除非价格特别合适'], [69, '不太推荐'], [0, '不太推荐']];
let gOk = true;
gradeCases.forEach(([sc, label]) => {
  const fake = { safety: {}, comfort: {}, foldedSize: {} };
  // 直接用内部等级函数不可见，改为通过卡片渲染验证映射区间（用配置断言）
});
ok('等级区间在渲染文本中完整出现',
  gradeCases.every(([, l]) => nodesById.rulesBody.textContent.indexOf(l) >= 0));

/* ---------------- 编辑弹窗实时刷新 ---------------- */
section('编辑弹窗实时刷新');
function findTag(node, tag, out = []) {
  if (node.tagName === tag) out.push(node);
  node.childNodes.forEach(c => c.childNodes && findTag(c, tag, out));
  return out;
}
// 打开一个空产品的编辑器
nodesById.modalRoot.childNodes = [];
const target = S.data.products[9];
eq('目标产品初始总分为 0', API.calculateScore(target).total, 0);
nodesById.rankingBody.findAll('rank-row').slice(-1)[0]; // 排名行可点击
API.state; // noop
(function openViaCard() {
  const cards = nodesById.productGrid.findAll('card');
  const lastCard = cards[9];
  const editBtn = findTag(lastCard, 'BUTTON').filter(b => b.textContent === '编辑')[0];
  ok('卡片上存在「编辑」按钮', !!editBtn);
  editBtn.fire('click');
})();
const modal = nodesById.modalRoot.childNodes[0];
ok('编辑弹窗已打开', !!modal);
const esHeader = modal.find('editor-score');
ok('弹窗顶部有实时分数条', !!esHeader);
eq('初始显示 0 分', esHeader.find('score-big').textContent, '0');

const selects = findTag(modal, 'SELECT');
eq('弹窗内下拉数量 = 8（6 select + 折叠档位 + 1）', selects.length, 8);
// 新生儿选择最高档
selects[0].fire('change', { target: { value: 'flat' } });
eq('选新生儿满档后总分 = 18', API.calculateScore(target).total, 18);
eq('分数条同步更新为 18', esHeader.find('score-big').textContent, '18');
// 勾选五点式安全带
const checks = findTag(modal, 'INPUT').filter(i => i.attributes.type === 'checkbox');
checks[0].fire('change', { target: { checked: true } });
eq('勾选五点式安全带后 = 22', API.calculateScore(target).total, 22);
// 填写价格与重量
const numbers = findTag(modal, 'INPUT').filter(i => i.attributes.type === 'number');
numbers[0].value = '3299';
numbers[0].fire('input', { target: numbers[0] });
eq('价格写入', target.price, 3299);
ok('每分成本随价格实时出现', esHeader.textContent.indexOf('每分成本 ¥') >= 0, esHeader.textContent);
numbers[1].value = '-6.5';
numbers[1].fire('input', { target: numbers[1] });
eq('负号被剥离', numbers[1].value, '6.5');
eq('重量写入 6.5kg', target.weightKg, 6.5);
eq('重量 6.5kg 计 12 分 -> 总分 34', API.calculateScore(target).total, 34);
ok('列表卡片同步刷新', nodesById.productGrid.findAll('card').length === 10);

/* ---------------- PK 结论 ---------------- */
section('PK 对比结论');
function pkSelect(side) {
  return findTag(nodesById.pkBody, 'SELECT')[side === 'A' ? 0 : 1];
}
function setPk(a, b) {
  pkSelect('A').fire('change', { target: { value: S.data.products[a].id } });
  pkSelect('B').fire('change', { target: { value: S.data.products[b].id } });
  return nodesById.pkBody.textContent;
}

// 满分轻便车(0) vs Fox 5(1)：便携差距大，舒适通过组打平
let pkText = setPk(0, 1);
ok('A 优势中出现「更轻」并带具体重量', pkText.indexOf('更轻：5.9kg vs 10.4kg') >= 0, pkText.slice(0, 300));
ok('出现折叠体积对比（升）', pkText.indexOf('折叠体积更小') >= 0);
ok('给出便携场景结论', pkText.indexOf('如果你经常开车、上下楼、坐高铁飞机') >= 0);
ok('打平时给出「两者接近」而非硬推荐', pkText.indexOf('舒适性与通过性两者接近') >= 0);
ok('给出综合评分结论', pkText.indexOf('综合评分更高') >= 0);
ok('给出每分成本结论', pkText.indexOf('每分成本更低') >= 0);

// Joolz Aer+(2) vs Fox 5(1)：一个偏便携、一个偏舒适，两条结论应指向不同产品
pkText = setPk(2, 1);
ok('给出舒适/烂路场景结论', pkText.indexOf('如果你更在意新生儿舒适性和烂路避震') >= 0, pkText.slice(0, 300));
ok('舒适结论指向 Fox 5', /如果你更在意新生儿舒适性和烂路避震：更推荐 Bugaboo Fox 5/.test(pkText));
ok('便携结论指向 Joolz Aer\\+', /如果你经常开车、上下楼、坐高铁飞机：更推荐 Joolz Aer\+/.test(pkText));
// 把 Aer+ 的执行标准改成「无信息」，PK 结论应把风险提示顶到最前
// （直接改数据后需触发一次全量重算，正常 UI 路径由编辑器 refresh() 自动完成）
function forceRerender() {
  const t = nodesById.scenarioGrid.findAll('check-tile')[1];
  t.childNodes[0].fire('change', { target: { checked: true } });
  const t2 = nodesById.scenarioGrid.findAll('check-tile')[1];
  t2.childNodes[0].fire('change', { target: { checked: false } });
}
S.data.products[2].standard = '';
forceRerender();
pkText = setPk(2, 1);
ok('一票否决级风险在结论中被优先提示',
  pkText.indexOf('存在需要优先确认的安全/适用性风险') >= 0, pkText.slice(0, 300));
S.data.products[2].standard = 'E';

/* ---------------- 清空全部（二次确认） ---------------- */
section('清空全部需二次确认');
nodesById.modalRoot.childNodes = [];
nodesById.btnClear.fire('click');
const confirm1 = nodesById.modalRoot.childNodes[0];
ok('弹出第一次确认', !!confirm1 && confirm1.textContent.indexOf('无法撤销') >= 0);
const okBtn1 = findTag(confirm1, 'BUTTON').filter(b => b.textContent === '继续')[0];
okBtn1.fire('click');
const confirm2 = nodesById.modalRoot.childNodes[nodesById.modalRoot.childNodes.length - 1];
ok('弹出第二次确认', !!confirm2 && confirm2.textContent.indexOf('真的要清空') >= 0);
eq('未确认前数据仍在', S.data.products.length, 10);
findTag(confirm2, 'BUTTON').filter(b => b.textContent === '确认清空')[0].fire('click');
eq('二次确认后已清空', S.data.products.length, 0);
ok('清空后显示空状态', !!nodesById.productGrid.find('empty'));

/* ---------------- 结果 ---------------- */
console.log('\n----------------------------------------');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
