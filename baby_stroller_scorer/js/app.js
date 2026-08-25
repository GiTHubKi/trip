/* ==========================================================================
 * 婴儿车选购评分与多产品对比工具
 * 纯原生 JS，无依赖，无后端。所有数据保存在 localStorage。
 *
 * 代码分区：
 *   1. 配置区   —— 标准信息 / 13 项评分规则 / 等级 / 标签 / 场景权重
 *   2. 计算区   —— calculateScore / calculateWarnings / calculateTags /
 *                  calculateCompleteness / calculateMatch（纯函数，不碰 DOM）
 *   3. 状态区   —— localStorage 读写、版本迁移、增删改查
 *   4. DOM 工具 —— el() / toast / modal（全部使用 textContent，杜绝 XSS）
 *   5. 渲染区   —— 排名 / 场景 / 卡片 / 风险 / 对比 / PK / 规则说明
 *   6. 编辑器   —— 由配置自动生成表单，改动即时重算
 *   7. 导入导出 & 事件绑定
 * ========================================================================== */
(function () {
  'use strict';

  /* =======================================================================
   * 1. 配置区
   * ===================================================================== */

  var APP = {
    version: 1,
    storageKey: 'baby_stroller_scorer_data',
    exportFileName: 'baby-stroller-data.json'
  };

  /** 执行标准相关信息集中定义，未来标准变化只改这里 */
  var STANDARD_CONFIG = {
    asOf: '2026 年 8 月',
    currentStandard: 'GB 14748-2006',
    nextStandard: 'GB/T 14748-2025',
    generalSafetyStandard: 'GB 46516-2025',
    nextEffectiveDate: '2026-11-01'
  };

  /** 由 STANDARD_CONFIG 生成的说明文案 */
  function standardNotes() {
    return [
      STANDARD_CONFIG.currentStandard + ' 仍属于现行儿童推车标准',
      STANDARD_CONFIG.nextStandard + ' 将于 ' + STANDARD_CONFIG.nextEffectiveDate + ' 实施',
      STANDARD_CONFIG.generalSafetyStandard + ' 将于 ' + STANDARD_CONFIG.nextEffectiveDate + ' 实施'
    ];
  }

  /**
   * 13 项评分维度配置（数据驱动）。
   * 修改评分规则 = 修改本数组，UI、评分、对比表、规则说明会自动跟随。
   *   key     内部标识
   *   field   product 上对应的字段名
   *   max     该项满分
   *   type    select | checks | weight | volume | bool
   */
  var DIMENSIONS = [
    {
      key: 'newborn', field: 'newborn', label: '新生儿适用性', short: '新生儿',
      max: 18, type: 'select', core: true, hint: '核心安全项目，权重最高。',
      options: [
        { value: 'flat', label: '官方明确 0 月+，支持完全/接近平躺或独立睡篮', score: 18 },
        { value: 'basic', label: '官方明确 0 月+，但躺姿或新生儿支撑一般', score: 14 },
        { value: 'from6m', label: '官方要求 6 月+使用', score: 6 },
        { value: '', label: '适用月龄不明确', score: 0 }
      ]
    },
    {
      key: 'standard', field: 'standard', label: '执行标准 / CCC', short: '执行标准',
      max: 8, type: 'select', core: true,
      options: [
        { value: 'A', label: 'CCC 可查 + 符合当前国内标准 + 有新版标准检测/认证依据', score: 8 },
        { value: 'B', label: 'CCC 可查 + ' + STANDARD_CONFIG.currentStandard, score: 7 },
        { value: 'C', label: 'CCC 可查，但商品详情未明确执行标准', score: 5 },
        { value: 'D', label: '标注 ' + STANDARD_CONFIG.currentStandard + '，但 CCC 信息无法确认', score: 3 },
        { value: 'E', label: '只标注 EN 1888 / ASTM 等国外标准，没有明确国内 CCC 信息', score: 2 },
        { value: 'F', label: '只标企业标准 Q/XXX，没有明确儿童推车国标信息', score: 1 },
        { value: '', label: '无明确执行标准 / 无认证信息', score: 0 }
      ]
    },
    {
      key: 'safety', field: 'safety', label: '安全配置', short: '安全',
      max: 12, type: 'checks', core: true,
      items: [
        { key: 'fivePointHarness', label: '五点式安全带', score: 4 },
        { key: 'linkedBrake', label: '一脚双刹 / 联动刹车', score: 3 },
        { key: 'frameLock', label: '车架折叠锁定结构可靠', score: 3 },
        { key: 'adjustableHarness', label: '安全带高度可调 / 防误操作等辅助安全设计', score: 2 }
      ]
    },
    {
      key: 'weight', field: 'weightKg', label: '车重', short: '轻便',
      max: 12, type: 'weight', core: true, unit: 'kg',
      missingText: '缺少重量信息',
      brackets: [
        { maxKg: 6.5, score: 12, label: '≤ 6.5kg' },
        { maxKg: 8, score: 11, label: '>6.5 ～ 8kg' },
        { maxKg: 9, score: 9, label: '>8 ～ 9kg' },
        { maxKg: 11, score: 7, label: '>9 ～ 11kg' },
        { maxKg: 13, score: 4, label: '>11 ～ 13kg' },
        { maxKg: Infinity, score: 2, label: '>13kg' }
      ]
    },
    {
      key: 'suspension', field: 'suspension', label: '避震能力', short: '避震',
      max: 12, type: 'select', core: true,
      options: [
        { value: 'bigFour', label: '大轮 + 四轮有效避震', score: 12 },
        { value: 'midFour', label: '中等轮径 + 四轮避震', score: 10 },
        { value: 'rear', label: '后轮避震', score: 7 },
        { value: 'smallBasic', label: '小轮 + 基础避震', score: 4 },
        { value: 'none', label: '基本无避震', score: 2 },
        { value: '', label: '不明确', score: 0 }
      ]
    },
    {
      key: 'folding', field: 'folding', label: '收车便利性', short: '收车',
      max: 10, type: 'select', core: true,
      options: [
        { value: 'oneHandStand', label: '单手一键收车 + 收车后可站立', score: 10 },
        { value: 'oneHand', label: '一键收车', score: 8 },
        { value: 'twoStep', label: '两步收车', score: 6 },
        { value: 'complex', label: '收车操作比较复杂', score: 3 },
        { value: '', label: '不明确', score: 0 }
      ]
    },
    {
      key: 'foldedVolume', field: 'foldedGrade', label: '折叠体积', short: '折叠',
      max: 8, type: 'volume', core: true,
      hint: '尺寸只用于展示与体积换算，得分取决于所选档位。',
      options: [
        { value: 'travel', label: '非常紧凑 / 旅行车级别', score: 8 },
        { value: 'car', label: '普通轿车后备箱轻松放下', score: 7 },
        { value: 'bulky', label: '比较占空间', score: 4 },
        { value: 'huge', label: '折叠后仍非常大', score: 2 },
        { value: '', label: '不明确', score: 0 }
      ]
    },
    {
      key: 'reversible', field: 'reversible', label: '双向功能', short: '双向',
      max: 6, type: 'select', core: true,
      options: [
        { value: 'both', label: '座椅真正支持正反双向', score: 6 },
        { value: 'carrycot', label: '睡篮/提篮阶段可以面向父母', score: 4 },
        { value: 'forward', label: '只能正向', score: 2 },
        { value: '', label: '不明确', score: 0 }
      ]
    },
    {
      key: 'comfort', field: 'comfort', label: '座舱舒适性', short: '舒适',
      max: 6, type: 'checks', core: true,
      items: [
        { key: 'tallBackrest', label: '靠背高度充足', score: 2 },
        { key: 'wideSeat', label: '座宽充足', score: 2 },
        { key: 'adjustableLegRest', label: '腿托可调', score: 1 },
        { key: 'breathable', label: '透气设计好', score: 1 }
      ]
    },
    {
      key: 'canopy', field: 'canopy', label: '遮阳篷', short: '遮阳',
      max: 4, type: 'select', core: true,
      options: [
        { value: 'full', label: 'UPF50+ + 大遮阳篷 + 延长篷 + 透气观察窗', score: 4 },
        { value: 'upfBig', label: 'UPF50+ + 大遮阳篷', score: 3 },
        { value: 'normal', label: '普通遮阳篷', score: 2 },
        { value: 'poor', label: '遮阳效果较差', score: 1 },
        { value: '', label: '不明确', score: 0 }
      ]
    },
    {
      key: 'handling', field: 'handling', label: '轮子与操控', short: '操控',
      max: 2, type: 'select', core: true,
      options: [
        { value: 'good', label: '转向顺畅、前轮万向/锁定、过坎能力好', score: 2 },
        { value: 'normal', label: '普通', score: 1 },
        { value: '', label: '明显不好推 / 不明确', score: 0 }
      ]
    },
    {
      key: 'storage', field: 'storage', label: '储物能力', short: '储物',
      max: 1, type: 'bool', checkLabel: '置物篮较大、开口方便'
    },
    {
      key: 'aftersales', field: 'aftersales', label: '做工 / 售后', short: '售后',
      max: 1, type: 'bool', checkLabel: '品牌售后完善、配件容易购买'
    }
  ];

  var DIM_MAP = {};
  DIMENSIONS.forEach(function (d) { DIM_MAP[d.key] = d; });

  var TOTAL_MAX = DIMENSIONS.reduce(function (sum, d) { return sum + d.max; }, 0);

  /** 卡片里用进度条展示的核心维度 */
  var CARD_BAR_KEYS = ['newborn', 'safety', 'weight', 'suspension', 'folding', 'foldedVolume'];

  /** 评分等级：按总分从高到低匹配第一条 */
  var GRADES = [
    { min: 90, label: '非常优秀', cls: 'g-good' },
    { min: 85, label: '很推荐', cls: 'g-good' },
    { min: 80, label: '值得买', cls: '' },
    { min: 75, label: '可以购买，但存在明显取舍', cls: '' },
    { min: 70, label: '除非价格特别合适', cls: 'g-mid' },
    { min: 0, label: '不太推荐', cls: 'g-bad' }
  ];

  /** 产品类型标签规则（条件函数接收各维度得分表 s 与产品 p） */
  var TAG_RULES = [
    {
      label: '轻便型',
      test: function (s, p) { return (isNum(p.weightKg) && p.weightKg <= 7) || s.weight >= 11; }
    },
    {
      label: '旅行型',
      test: function (s, p) {
        return ((isNum(p.weightKg) && p.weightKg <= 7.5) || s.weight >= 11) &&
          s.foldedVolume >= 7 && s.folding >= 8;
      }
    },
    { label: '舒适型', test: function (s) { return s.comfort >= 5 && s.suspension >= 10; } },
    { label: '全地形型', test: function (s) { return s.suspension >= 10 && s.handling >= 2; } },
    {
      label: '均衡型',
      test: function (s, p, r) {
        return r.total >= 75 && r.items.every(function (it) {
          return it.dim.max < 6 || it.score / it.dim.max >= 0.6;
        });
      }
    },
    { label: '新生儿友好', test: function (s) { return s.newborn >= 18; }, cls: 't-newborn' }
  ];

  /** 使用场景 -> 各维度权重。只影响「匹配度」，不影响 100 分客观评分。 */
  var SCENARIOS = [
    { key: 'newbornFromBirth', label: '新生儿出生就开始用', weights: { newborn: 4, safety: 2, comfort: 1, reversible: 1, suspension: 1 } },
    { key: 'car', label: '经常开车', weights: { foldedVolume: 3, weight: 2, folding: 2 } },
    { key: 'stairs', label: '经常上下楼', weights: { weight: 4, folding: 2 } },
    { key: 'travel', label: '经常坐高铁 / 飞机', weights: { weight: 3, foldedVolume: 3, folding: 2 } },
    { key: 'mall', label: '主要逛商场', weights: { folding: 2, weight: 2, handling: 1, storage: 1 } },
    { key: 'park', label: '经常走公园 / 石板路', weights: { suspension: 3, handling: 2, comfort: 1 } },
    { key: 'valueSuspension', label: '特别看重避震', weights: { suspension: 4 } },
    { key: 'valueLight', label: '特别看重轻便', weights: { weight: 4 } },
    { key: 'valueFolding', label: '特别看重收车', weights: { folding: 4 } },
    { key: 'longUse', label: '希望一辆车用到 3～4 岁', weights: { comfort: 3, suspension: 2, safety: 1, canopy: 1 } }
  ];

  /** 排序方式 */
  var SORT_OPTIONS = [
    { key: 'total', label: '综合得分（高→低）', dir: 'desc', get: function (m) { return m.result.total; }, fmt: function (v) { return v + ' 分'; } },
    { key: 'price', label: '价格（低→高）', dir: 'asc', get: function (m) { return m.product.price; }, fmt: function (v) { return '¥' + fmtNum(v); } },
    { key: 'weight', label: '重量（轻→重）', dir: 'asc', get: function (m) { return m.product.weightKg; }, fmt: function (v) { return v + 'kg'; } },
    { key: 'cost', label: '每分成本（低→高）', dir: 'asc', get: function (m) { return m.costPerPoint; }, fmt: function (v) { return '¥' + v.toFixed(2) + '/分'; } },
    { key: 'newborn', label: '新生儿适用', dir: 'desc', get: function (m) { return m.result.byKey.newborn.score; }, fmt: function (v) { return v + '/18'; } },
    { key: 'suspension', label: '避震', dir: 'desc', get: function (m) { return m.result.byKey.suspension.score; }, fmt: function (v) { return v + '/12'; } },
    { key: 'light', label: '轻便程度', dir: 'desc', get: function (m) { return m.result.byKey.weight.score; }, fmt: function (v) { return v + '/12'; } }
  ];

  /* =======================================================================
   * 2. 计算区（纯函数）
   * ===================================================================== */

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  function findOption(dim, value) {
    for (var i = 0; i < dim.options.length; i++) {
      if (dim.options[i].value === value) return dim.options[i];
    }
    return null;
  }

  /** 每种维度类型的打分器，返回 { score, filled, note } */
  var SCORERS = {
    select: function (dim, p) {
      var opt = findOption(dim, p[dim.field] || '');
      return { score: opt ? opt.score : 0, filled: !!(p[dim.field] && opt) };
    },
    volume: function (dim, p) {
      var opt = findOption(dim, p[dim.field] || '');
      return { score: opt ? opt.score : 0, filled: !!(p[dim.field] && opt) };
    },
    checks: function (dim, p) {
      var obj = p[dim.field] || {};
      var score = 0, any = false;
      dim.items.forEach(function (it) {
        if (obj[it.key]) { score += it.score; any = true; }
      });
      return { score: score, filled: any };
    },
    weight: function (dim, p) {
      var w = p[dim.field];
      if (!isNum(w)) return { score: 0, filled: false, note: dim.missingText };
      for (var i = 0; i < dim.brackets.length; i++) {
        if (w <= dim.brackets[i].maxKg) {
          return { score: dim.brackets[i].score, filled: true, note: w + 'kg' };
        }
      }
      return { score: 0, filled: true };
    },
    bool: function (dim, p) {
      return { score: p[dim.field] ? dim.max : 0, filled: true };
    }
  };

  /**
   * 计算产品总分
   * @returns {{total:number, max:number, items:Array, byKey:Object}}
   */
  function calculateScore(product) {
    var items = DIMENSIONS.map(function (dim) {
      var r = SCORERS[dim.type](dim, product);
      return {
        key: dim.key, dim: dim, max: dim.max,
        score: clamp(r.score, 0, dim.max),
        filled: !!r.filled,
        note: r.note || ''
      };
    });
    var byKey = {};
    var total = 0;
    items.forEach(function (it) { byKey[it.key] = it; total += it.score; });
    return { total: total, max: TOTAL_MAX, items: items, byKey: byKey };
  }

  /** 只取各维度得分的简表，供标签/PK 使用 */
  function scoreMap(result) {
    var m = {};
    result.items.forEach(function (it) { m[it.key] = it.score; });
    return m;
  }

  /** 信息完整度：统计需要用户填写的维度中已填写的比例 */
  function calculateCompleteness(product, result) {
    var r = result || calculateScore(product);
    var counted = r.items.filter(function (it) { return it.dim.type !== 'bool'; });
    var filled = counted.filter(function (it) { return it.filled; }).length;
    var missing = counted.filter(function (it) { return !it.filled; })
      .map(function (it) { return it.dim.label; });
    return {
      percent: Math.round(filled / counted.length * 100),
      filled: filled,
      total: counted.length,
      missing: missing
    };
  }

  /** 风险提醒 */
  function calculateWarnings(product, preferences, result) {
    var r = result || calculateScore(product);
    var prefs = preferences || { scenarios: [] };
    var list = [];

    if (product.newborn === 'from6m' && prefs.scenarios.indexOf('newbornFromBirth') >= 0) {
      list.push({ level: 'danger', text: '⚠ 不建议作为新生儿主力婴儿车使用' });
    }
    var std = r.byKey.standard.score;
    if (std === 0) {
      list.push({ level: 'danger', text: '⛔ 安全认证 / 执行标准信息严重不足' });
    } else if (std <= 2) {
      list.push({ level: 'warn', text: '⚠ 国内安全认证信息不足，建议购买前确认 CCC 认证和执行标准' });
    }
    if (isNum(product.weightKg) && product.weightKg > 11) {
      list.push({ level: 'warn', text: '⚠ 整车较重，如果需要经常搬上搬下或放后备箱，长期使用可能不方便' });
    }
    if (r.byKey.suspension.score <= 4) {
      list.push({ level: 'warn', text: '⚠ 更适合商场、柏油路等平整路面，砖路和坑洼道路体验可能一般' });
    }
    if (!r.byKey.weight.filled) {
      list.push({ level: 'warn', text: '⚠ ' + DIM_MAP.weight.missingText + '，车重项按 0 分计算' });
    }
    var c = calculateCompleteness(product, r);
    if (c.percent < 80) {
      list.push({
        level: 'info',
        text: '信息完整度：' + c.percent + '% —— 当前评分存在较多未知参数，建议补充后再比较。'
      });
    }
    return list;
  }

  /** 产品类型标签 */
  function calculateTags(product, result) {
    var r = result || calculateScore(product);
    var s = scoreMap(r);
    var tags = [];
    TAG_RULES.forEach(function (rule) {
      if (rule.test(s, product, r)) tags.push({ label: rule.label, cls: rule.cls || '' });
    });
    return tags;
  }

  /**
   * 与使用场景的匹配度（0-100），与客观 100 分完全独立。
   * 未选择任何场景时返回 null。
   */
  function calculateMatch(product, preferences, result) {
    var prefs = preferences || { scenarios: [] };
    var picked = SCENARIOS.filter(function (s) { return prefs.scenarios.indexOf(s.key) >= 0; });
    if (!picked.length) return null;

    var r = result || calculateScore(product);
    var weights = {};
    picked.forEach(function (s) {
      Object.keys(s.weights).forEach(function (k) {
        weights[k] = (weights[k] || 0) + s.weights[k];
      });
    });

    var num = 0, den = 0;
    Object.keys(weights).forEach(function (k) {
      var it = r.byKey[k];
      if (!it) return;
      num += weights[k] * (it.score / it.dim.max);
      den += weights[k];
    });
    if (den === 0) return null;
    var pct = num / den * 100;

    // 明确要求 6 月+ 却打算从出生开始使用：匹配度显著下调
    if (product.newborn === 'from6m' && prefs.scenarios.indexOf('newbornFromBirth') >= 0) {
      pct *= 0.6;
    }
    return Math.round(clamp(pct, 0, 100));
  }

  function costPerPoint(product, result) {
    var r = result || calculateScore(product);
    if (!isNum(product.price) || product.price <= 0 || r.total <= 0) return null;
    return product.price / r.total;
  }

  function foldedVolumeLiters(product) {
    var s = product.foldedSize || {};
    if (!isNum(s.length) || !isNum(s.width) || !isNum(s.height)) return null;
    if (s.length <= 0 || s.width <= 0 || s.height <= 0) return null;
    return s.length * s.width * s.height / 1000; // cm³ -> L
  }

  function foldedSizeText(product) {
    var s = product.foldedSize || {};
    if (!isNum(s.length) || !isNum(s.width) || !isNum(s.height)) return '';
    return fmtNum(s.length) + ' × ' + fmtNum(s.width) + ' × ' + fmtNum(s.height) + ' cm';
  }

  function gradeOf(total) {
    for (var i = 0; i < GRADES.length; i++) {
      if (total >= GRADES[i].min) return GRADES[i];
    }
    return GRADES[GRADES.length - 1];
  }

  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

  function fmtNum(n) {
    if (!isNum(n)) return '—';
    return String(Math.round(n * 100) / 100);
  }

  function productName(p) {
    var name = [p.brand, p.model].filter(function (x) { return x && x.trim(); })
      .join(' ').trim();
    return name || '未命名产品';
  }

  /** 生成一个产品的完整计算结果（渲染层统一使用） */
  function buildModel(product, prefs) {
    var result = calculateScore(product);
    return {
      product: product,
      result: result,
      grade: gradeOf(result.total),
      tags: calculateTags(product, result),
      warnings: calculateWarnings(product, prefs, result),
      completeness: calculateCompleteness(product, result),
      match: calculateMatch(product, prefs, result),
      costPerPoint: costPerPoint(product, result),
      name: productName(product)
    };
  }

  /* =======================================================================
   * 3. 状态区
   * ===================================================================== */

  var state = {
    data: { version: APP.version, preferences: { scenarios: [] }, products: [] },
    ui: { sortKey: 'total', pkA: '', pkB: '', expanded: {} }
  };

  function uid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'p-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function emptyProduct(defaultName) {
    return {
      id: uid(),
      brand: '',
      model: defaultName || '',
      price: null,
      newborn: '',
      standard: '',
      safety: { fivePointHarness: false, linkedBrake: false, frameLock: false, adjustableHarness: false },
      weightKg: null,
      suspension: '',
      folding: '',
      foldedGrade: '',
      foldedSize: { length: null, width: null, height: null },
      reversible: '',
      comfort: { tallBackrest: false, wideSeat: false, adjustableLegRest: false, breathable: false },
      canopy: '',
      handling: '',
      storage: false,
      aftersales: false,
      notes: ''
    };
  }

  function toStr(v, maxLen) {
    if (v === null || v === undefined) return '';
    var s = String(v);
    return s.length > (maxLen || 200) ? s.slice(0, maxLen || 200) : s;
  }

  /** 解析非负数字，非法/空 -> null */
  function parseNum(v) {
    if (v === null || v === undefined) return null;
    var s = String(v).trim();
    if (s === '') return null;
    var n = Number(s);
    if (!isFinite(n) || n < 0) return null;
    return Math.round(n * 1000) / 1000;
  }

  function pickOptionValue(dim, v) {
    var s = toStr(v, 40);
    return findOption(dim, s) ? s : '';
  }

  /** 把任意外部输入规整为合法产品对象（导入校验的核心） */
  function normalizeProduct(raw, fallbackName) {
    var src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    var p = emptyProduct(fallbackName);
    if (typeof src.id === 'string' && src.id) p.id = src.id.slice(0, 64);
    p.brand = toStr(src.brand, 60);
    p.model = toStr(src.model, 80) || p.model;
    p.price = parseNum(src.price);
    p.notes = toStr(src.notes, 1000);
    p.weightKg = parseNum(src.weightKg);

    ['newborn', 'standard', 'suspension', 'folding', 'foldedGrade', 'reversible', 'canopy', 'handling']
      .forEach(function (field) {
        var dim = DIMENSIONS.filter(function (d) { return d.field === field; })[0];
        if (dim) p[field] = pickOptionValue(dim, src[field]);
      });

    ['safety', 'comfort'].forEach(function (field) {
      var dim = DIMENSIONS.filter(function (d) { return d.field === field; })[0];
      var obj = (src[field] && typeof src[field] === 'object') ? src[field] : {};
      dim.items.forEach(function (it) { p[field][it.key] = obj[it.key] === true; });
    });

    var size = (src.foldedSize && typeof src.foldedSize === 'object') ? src.foldedSize : {};
    p.foldedSize = {
      length: parseNum(size.length),
      width: parseNum(size.width),
      height: parseNum(size.height)
    };

    p.storage = src.storage === true;
    p.aftersales = src.aftersales === true;
    return p;
  }

  function normalizePreferences(raw) {
    var src = (raw && typeof raw === 'object') ? raw : {};
    var valid = SCENARIOS.map(function (s) { return s.key; });
    var picked = Array.isArray(src.scenarios) ? src.scenarios : [];
    return {
      scenarios: picked.filter(function (k) { return valid.indexOf(k) >= 0; })
    };
  }

  /**
   * 数据迁移：把任意版本/结构的数据转换成当前版本结构。
   * 未来结构升级时在此按 version 分支处理。
   */
  function migrateData(raw) {
    var data = { version: APP.version, preferences: { scenarios: [] }, products: [] };
    if (!raw || typeof raw !== 'object') return data;

    var src = Array.isArray(raw) ? { products: raw } : raw;
    // v0（无 version 字段）：结构与 v1 兼容，直接规整即可
    var products = Array.isArray(src.products) ? src.products : [];
    data.products = products.slice(0, 200).map(function (item, i) {
      return normalizeProduct(item, '婴儿车 ' + (i + 1));
    });
    data.preferences = normalizePreferences(src.preferences);
    dedupeIds(data.products);
    return data;
  }

  function dedupeIds(products) {
    var seen = {};
    products.forEach(function (p) {
      if (!p.id || seen[p.id]) p.id = uid();
      seen[p.id] = true;
    });
  }

  function loadData() {
    var raw = null;
    try {
      var text = window.localStorage.getItem(APP.storageKey);
      if (text) raw = JSON.parse(text);
    } catch (e) {
      raw = null;
    }
    return migrateData(raw);
  }

  var saveTimer = null;
  function saveData() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        window.localStorage.setItem(APP.storageKey, JSON.stringify(state.data));
      } catch (e) {
        toast('本地保存失败：浏览器可能禁用了 localStorage 或空间已满', 'bad');
      }
    }, 150);
  }

  function getProduct(id) {
    return state.data.products.filter(function (p) { return p.id === id; })[0] || null;
  }

  function nextDefaultName() {
    var n = state.data.products.length + 1;
    var names = state.data.products.map(function (p) { return p.model; });
    while (names.indexOf('婴儿车 ' + n) >= 0) n++;
    return '婴儿车 ' + n;
  }

  function addProduct() {
    var p = emptyProduct(nextDefaultName());
    state.data.products.push(p);
    saveData();
    renderAll();
    openEditor(p.id);
    toast('已添加「' + productName(p) + '」');
  }

  function duplicateProduct(id) {
    var src = getProduct(id);
    if (!src) return;
    var copy = JSON.parse(JSON.stringify(src));
    copy.id = uid();
    copy.model = (src.model || '产品') + ' 副本';
    var idx = state.data.products.indexOf(src);
    state.data.products.splice(idx + 1, 0, copy);
    saveData();
    renderAll();
    toast('已复制为「' + productName(copy) + '」');
  }

  function removeProduct(id) {
    var p = getProduct(id);
    if (!p) return;
    state.data.products = state.data.products.filter(function (x) { return x.id !== id; });
    if (state.ui.pkA === id) state.ui.pkA = '';
    if (state.ui.pkB === id) state.ui.pkB = '';
    saveData();
    renderAll();
    toast('已删除「' + productName(p) + '」');
  }

  /* =======================================================================
   * 4. DOM 工具
   * ===================================================================== */

  function $(sel) { return document.querySelector(sel); }

  /**
   * 创建元素。所有文本一律走 textContent，不使用 innerHTML，避免 XSS。
   */
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = String(v);
        else if (k === 'value') node.value = v;
        else if (k === 'checked') node.checked = !!v;
        else if (k === 'dataset') Object.keys(v).forEach(function (d) { node.dataset[d] = v[d]; });
        else if (k.indexOf('on') === 0 && typeof v === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (v === true) node.setAttribute(k, '');
        else node.setAttribute(k, String(v));
      });
    }
    append(node, children);
    return node;
  }

  function append(parent, children) {
    if (children === null || children === undefined) return parent;
    var list = Array.isArray(children) ? children : [children];
    list.forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      parent.appendChild(typeof c === 'string' || typeof c === 'number'
        ? document.createTextNode(String(c)) : c);
    });
    return parent;
  }

  function clearNode(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  function toast(message, kind) {
    var root = $('#toastRoot');
    var box = el('div', { class: 'toast' + (kind ? ' t-' + kind : ''), text: message });
    root.appendChild(box);
    setTimeout(function () {
      box.style.transition = 'opacity .2s';
      box.style.opacity = '0';
      setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, 220);
    }, 2600);
  }

  var openModals = [];

  /**
   * 通用弹窗。buttons: [{label, kind, onClick, close}]
   * @returns {{close:Function, body:HTMLElement}}
   */
  function openModal(opts) {
    var lastFocus = document.activeElement;
    var body = el('div', { class: 'modal-body' });
    append(body, opts.content);

    var foot = el('div', { class: 'modal-foot' });
    (opts.buttons || []).forEach(function (b) {
      foot.appendChild(el('button', {
        type: 'button',
        class: 'btn' + (b.kind ? ' btn-' + b.kind : ''),
        text: b.label,
        onClick: function () {
          if (b.onClick) b.onClick();
          if (b.close !== false) api.close();
        }
      }));
    });

    var modal = el('div', {
      class: 'modal' + (opts.size === 'sm' ? ' modal-sm' : ''),
      role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title || '对话框'
    }, [
      el('div', { class: 'modal-head' }, [
        el('h3', { class: 'modal-title', text: opts.title || '' }),
        el('button', {
          type: 'button', class: 'modal-close', 'aria-label': '关闭',
          text: '×', onClick: function () { api.close(); }
        })
      ]),
      body,
      (opts.buttons && opts.buttons.length) ? foot : null
    ]);

    var backdrop = el('div', {
      class: 'modal-backdrop',
      onMousedown: function (e) { if (e.target === backdrop) api.close(); }
    }, modal);

    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); api.close(); }
      if (e.key === 'Tab') trapFocus(e, modal);
    }

    var api = {
      body: body,
      modal: modal,
      close: function () {
        document.removeEventListener('keydown', onKey, true);
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        openModals = openModals.filter(function (m) { return m !== api; });
        if (!openModals.length) document.body.style.overflow = '';
        if (opts.onClose) opts.onClose();
        if (lastFocus && lastFocus.focus) lastFocus.focus();
      }
    };

    document.addEventListener('keydown', onKey, true);
    $('#modalRoot').appendChild(backdrop);
    document.body.style.overflow = 'hidden';
    openModals.push(api);

    var focusable = modal.querySelector('input, select, textarea, button');
    if (focusable) focusable.focus();
    return api;
  }

  function trapFocus(e, container) {
    var nodes = container.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (!nodes.length) return;
    var first = nodes[0], last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  /** 确认对话框（替代 confirm()） */
  function confirmDialog(opts) {
    openModal({
      title: opts.title,
      size: 'sm',
      content: el('p', { class: 'modal-text', text: opts.message }),
      buttons: [
        { label: opts.cancelLabel || '取消' },
        { label: opts.okLabel || '确定', kind: opts.danger ? 'danger' : 'primary', onClick: opts.onOk }
      ]
    });
  }

  /* =======================================================================
   * 5. 渲染区
   * ===================================================================== */

  var models = [];

  function rebuildModels() {
    models = state.data.products.map(function (p) {
      return buildModel(p, state.data.preferences);
    });
  }

  function renderAll() {
    rebuildModels();
    renderRanking();
    renderProducts();
    renderWarnings();
    renderCompare();
    renderPK();
  }

  function scoreClass(score, max) {
    var ratio = max ? score / max : 0;
    if (ratio >= 0.8) return 'good';
    if (ratio >= 0.6) return 'mid';
    return 'bad';
  }

  function starsNode(total) {
    var pct = clamp(total / TOTAL_MAX, 0, 1) * 100;
    var wrap = el('span', {
      class: 'stars', role: 'img',
      'aria-label': '星级 ' + (Math.round(total / TOTAL_MAX * 5 * 10) / 10) + ' / 5'
    });
    wrap.appendChild(el('span', { class: 'stars-fill', style: 'width:' + pct.toFixed(1) + '%' }));
    return wrap;
  }

  function emptyState(message, actions) {
    return el('div', { class: 'empty' }, [
      el('h3', { text: '还没有产品' }),
      el('p', { text: message }),
      actions ? el('div', { class: 'empty-actions' }, actions) : null
    ]);
  }

  /* ---------- 5.1 排名 ---------- */

  function currentSort() {
    return SORT_OPTIONS.filter(function (s) { return s.key === state.ui.sortKey; })[0] || SORT_OPTIONS[0];
  }

  function sortedModels() {
    var sort = currentSort();
    var list = models.slice();
    list.sort(function (a, b) {
      var va = sort.get(a), vb = sort.get(b);
      var na = !isNum(va), nb = !isNum(vb);
      if (na && nb) return b.result.total - a.result.total;
      if (na) return 1;   // 缺数据的排最后
      if (nb) return -1;
      if (va === vb) return b.result.total - a.result.total;
      return sort.dir === 'asc' ? va - vb : vb - va;
    });
    return list;
  }

  function renderRanking() {
    var box = clearNode($('#rankingBody'));
    if (!models.length) {
      box.appendChild(emptyState('添加产品后，这里会显示综合排名。', [
        el('button', { type: 'button', class: 'btn btn-primary', text: '+ 添加产品', onClick: addProduct }),
        el('button', { type: 'button', class: 'btn', text: '载入示例数据', onClick: loadSampleData })
      ]));
      return;
    }
    var sort = currentSort();
    var medals = ['🥇', '🥈', '🥉'];
    var list = el('div', { class: 'rank-list' });

    sortedModels().forEach(function (m, i) {
      var metaParts = [];
      if (sort.key !== 'total') {
        var v = sort.get(m);
        metaParts.push(el('span', { text: sort.label.split('（')[0] + '：' + (isNum(v) ? sort.fmt(v) : '未填写') }));
      }
      metaParts.push(el('span', { text: m.grade.label }));
      if (isNum(m.product.price)) metaParts.push(el('span', { text: '¥' + fmtNum(m.product.price) }));
      if (isNum(m.product.weightKg)) metaParts.push(el('span', { text: m.product.weightKg + 'kg' }));
      if (m.match !== null) metaParts.push(el('span', { text: '匹配度 ' + m.match + '%' }));

      list.appendChild(el('button', {
        type: 'button',
        class: 'rank-row' + (i < 3 ? ' is-top' : ''),
        onClick: function () { openEditor(m.product.id); }
      }, [
        el('span', { class: 'rank-medal', text: i < 3 ? medals[i] : String(i + 1) }),
        el('span', {}, [
          el('div', { class: 'rank-name', text: (i + 1) + '. ' + m.name }),
          el('div', { class: 'rank-meta' }, metaParts)
        ]),
        el('span', { class: 'rank-value' }, [
          el('span', { class: 'rank-score score-' + scoreClass(m.result.total, TOTAL_MAX), text: String(m.result.total) }),
          el('span', { class: 'rank-unit', text: ' / ' + TOTAL_MAX })
        ])
      ]));
    });
    box.appendChild(list);
  }

  /* ---------- 5.2 使用场景 ---------- */

  function renderScenarios() {
    var box = clearNode($('#scenarioGrid'));
    SCENARIOS.forEach(function (s) {
      var on = state.data.preferences.scenarios.indexOf(s.key) >= 0;
      var id = 'sc-' + s.key;
      var input = el('input', {
        type: 'checkbox', id: id, checked: on,
        onChange: function (e) {
          var arr = state.data.preferences.scenarios;
          if (e.target.checked) { if (arr.indexOf(s.key) < 0) arr.push(s.key); }
          else state.data.preferences.scenarios = arr.filter(function (k) { return k !== s.key; });
          saveData();
          renderScenarios();
          renderAll();
        }
      });
      box.appendChild(el('label', { class: 'check-tile' + (on ? ' is-on' : ''), for: id }, [
        input, el('span', { text: s.label })
      ]));
    });
  }

  /* ---------- 5.3 产品卡片 ---------- */

  function barRow(item) {
    var pct = item.max ? item.score / item.max * 100 : 0;
    return el('div', { class: 'bar-row' }, [
      el('span', { class: 'bar-label', text: item.dim.short }),
      el('span', { class: 'bar-track' }, [
        el('span', {
          class: 'bar-fill f-' + scoreClass(item.score, item.max),
          style: 'width:' + pct.toFixed(1) + '%'
        })
      ]),
      el('span', { class: 'bar-value', text: item.score + '/' + item.max })
    ]);
  }

  function alertNode(w) {
    return el('div', { class: 'alert a-' + w.level, text: w.text });
  }

  function productCard(m) {
    var p = m.product;
    var card = el('article', { class: 'card' });

    card.appendChild(el('div', { class: 'card-head' }, [
      el('div', {}, [
        el('div', { class: 'card-name', text: m.name }),
        el('div', {
          class: 'card-model',
          text: (p.brand && p.model) ? (p.brand + ' · ' + p.model) : '点击「编辑」补充参数'
        })
      ]),
      el('div', { class: 'card-score' }, [
        el('div', { class: 'score-big score-' + scoreClass(m.result.total, TOTAL_MAX), text: String(m.result.total) }),
        el('div', { class: 'score-max', text: '/ ' + TOTAL_MAX })
      ])
    ]));

    card.appendChild(el('div', { class: 'grade-line' }, [
      el('span', { class: 'grade-label ' + m.grade.cls, text: m.grade.label }),
      starsNode(m.result.total)
    ]));

    if (m.tags.length) {
      card.appendChild(el('div', { class: 'tag-row' }, m.tags.map(function (t) {
        return el('span', { class: 'tag ' + t.cls, text: t.label });
      })));
    }

    var keys = [];
    keys.push(el('span', {}, [isNum(p.price) ? el('strong', { text: '¥' + fmtNum(p.price) }) : el('span', { text: '价格未填写' })]));
    keys.push(el('span', {}, [isNum(p.weightKg) ? el('strong', { text: p.weightKg + 'kg' }) : el('span', { text: '重量未填写' })]));
    keys.push(el('span', { text: p.newborn === 'from6m' ? '6 月+' : (p.newborn ? '0 月+' : '月龄不明') }));
    if (m.costPerPoint !== null) {
      keys.push(el('span', { text: '每分成本 ¥' + m.costPerPoint.toFixed(2) }));
    }
    if (m.match !== null) {
      keys.push(el('span', {}, [el('strong', { text: '场景匹配度 ' + m.match + '%' })]));
    }
    card.appendChild(el('div', { class: 'key-row' }, keys));

    var bars = el('div', { class: 'bars' });
    CARD_BAR_KEYS.forEach(function (k) { bars.appendChild(barRow(m.result.byKey[k])); });
    card.appendChild(bars);

    // 完整度
    var cls = m.completeness.percent >= 80 ? '' : (m.completeness.percent >= 60 ? ' f-mid' : ' f-bad');
    card.appendChild(el('div', { class: 'meter' }, [
      el('span', { text: '完整度' }),
      el('span', { class: 'meter-track' }, [
        el('span', { class: 'meter-fill' + cls, style: 'width:' + m.completeness.percent + '%' })
      ]),
      el('span', { text: m.completeness.percent + '%' })
    ]));

    // 全部维度明细（可折叠）
    var expanded = !!state.ui.expanded[p.id];
    var detail = el('table', { class: 'mini-table' });
    if (expanded) {
      var tbody = el('tbody');
      m.result.items.forEach(function (it) {
        tbody.appendChild(el('tr', {}, [
          el('td', { text: it.dim.label }),
          el('td', { text: it.score + ' / ' + it.max })
        ]));
      });
      var sizeText = foldedSizeText(p);
      if (sizeText) {
        var liters = foldedVolumeLiters(p);
        tbody.appendChild(el('tr', {}, [
          el('td', { text: '折叠尺寸' }),
          el('td', { text: sizeText + '（' + fmtNum(liters) + ' L）' })
        ]));
      }
      if (p.notes) {
        tbody.appendChild(el('tr', {}, [el('td', { text: '备注' }), el('td', { text: p.notes })]));
      }
      detail.appendChild(tbody);
    }
    card.appendChild(el('button', {
      type: 'button', class: 'details-toggle',
      text: expanded ? '收起全部 13 项 ▲' : '查看全部 13 项 ▼',
      onClick: function () {
        state.ui.expanded[p.id] = !expanded;
        renderProducts();
      }
    }));
    if (expanded) card.appendChild(detail);

    if (m.warnings.length) {
      card.appendChild(el('div', { class: 'card-warnings' }, m.warnings.map(alertNode)));
    }

    card.appendChild(el('div', { class: 'card-actions' }, [
      el('button', { type: 'button', class: 'btn btn-primary btn-sm', text: '编辑', onClick: function () { openEditor(p.id); } }),
      el('button', { type: 'button', class: 'btn btn-sm', text: '重命名', onClick: function () { openRename(p.id); } }),
      el('button', { type: 'button', class: 'btn btn-sm', text: '复制', onClick: function () { duplicateProduct(p.id); } }),
      el('button', {
        type: 'button', class: 'btn btn-sm btn-ghost-danger', text: '删除',
        onClick: function () {
          confirmDialog({
            title: '删除产品',
            message: '确定要删除「' + productName(p) + '」吗？该操作无法撤销。',
            okLabel: '删除', danger: true,
            onOk: function () { removeProduct(p.id); }
          });
        }
      })
    ]));

    return card;
  }

  function renderProducts() {
    var grid = clearNode($('#productGrid'));
    $('#productCount').textContent = state.data.products.length ? String(state.data.products.length) : '';
    if (!models.length) {
      grid.appendChild(emptyState('点击「+ 添加产品」录入第一款婴儿车，或先载入示例数据体验。', [
        el('button', { type: 'button', class: 'btn btn-primary', text: '+ 添加产品', onClick: addProduct }),
        el('button', { type: 'button', class: 'btn', text: '载入示例数据', onClick: loadSampleData })
      ]));
      return;
    }
    models.forEach(function (m) { grid.appendChild(productCard(m)); });
  }

  /* ---------- 5.4 风险提醒汇总 ---------- */

  function renderWarnings() {
    var box = clearNode($('#warningsBody'));
    var withWarnings = models.filter(function (m) { return m.warnings.length; });
    if (!models.length) {
      box.appendChild(el('p', { class: 'field-note', text: '添加产品后，这里会汇总所有风险提醒。' }));
      return;
    }
    if (!withWarnings.length) {
      box.appendChild(el('div', { class: 'alert a-info', text: '当前所有产品均未触发风险提醒，参数也较为完整。' }));
      return;
    }
    var wrap = el('div', { class: 'form-grid' });
    withWarnings.forEach(function (m) {
      wrap.appendChild(el('div', {}, [
        el('h4', { class: 'field-label', text: m.name }),
        el('div', { class: 'card-warnings' }, m.warnings.map(alertNode))
      ]));
    });
    box.appendChild(wrap);
  }

  /* ---------- 5.5 横向对比 ---------- */

  function compareRows() {
    var rows = [
      {
        label: '总分', better: 'high', cls: 'row-total',
        get: function (m) { return m.result.total; },
        fmt: function (v) { return String(v); }
      },
      {
        label: '价格', better: 'low',
        get: function (m) { return m.product.price; },
        fmt: function (v) { return '¥' + fmtNum(v); }
      },
      {
        label: '重量', better: 'low',
        get: function (m) { return m.product.weightKg; },
        fmt: function (v) { return fmtNum(v) + 'kg'; }
      },
      {
        label: '每分成本', better: 'low',
        get: function (m) { return m.costPerPoint; },
        fmt: function (v) { return '¥' + v.toFixed(2); }
      }
    ];
    DIMENSIONS.forEach(function (dim) {
      rows.push({
        label: dim.short + '（' + dim.max + '）', better: 'high',
        get: function (m) { return m.result.byKey[dim.key].score; },
        fmt: function (v) { return String(v); }
      });
    });
    rows.push({
      label: '完整度', better: 'high',
      get: function (m) { return m.completeness.percent; },
      fmt: function (v) { return v + '%'; }
    });
    if (state.data.preferences.scenarios.length) {
      rows.push({
        label: '场景匹配度', better: 'high',
        get: function (m) { return m.match; },
        fmt: function (v) { return v + '%'; }
      });
    }
    return rows;
  }

  function renderCompare() {
    var box = clearNode($('#compareBody'));
    if (models.length < 2) {
      box.appendChild(el('p', {
        class: 'field-note',
        text: models.length ? '至少需要 2 款产品才能进行横向对比。' : '添加产品后即可横向对比。'
      }));
      return;
    }

    var list = sortedModels();
    var table = el('table', { class: 'cmp-table' });
    var head = el('tr', {}, [el('th', { class: 'col-item', scope: 'col', text: '项目' })]);
    list.forEach(function (m) {
      head.appendChild(el('th', { scope: 'col' }, [
        el('span', { class: 'cmp-head-name', title: m.name, text: m.name })
      ]));
    });
    table.appendChild(el('thead', {}, head));

    var tbody = el('tbody');
    compareRows().forEach(function (row) {
      var values = list.map(row.get);
      var nums = values.filter(isNum);
      var best = null, worst = null;
      if (nums.length > 1) {
        var max = Math.max.apply(null, nums);
        var min = Math.min.apply(null, nums);
        if (max !== min) {
          best = row.better === 'low' ? min : max;
          worst = row.better === 'low' ? max : min;
        }
      }
      var tr = el('tr', { class: row.cls || '' }, [
        el('th', { class: 'col-item', scope: 'row', text: row.label })
      ]);
      values.forEach(function (v) {
        var cls = '';
        if (isNum(v) && best !== null) {
          if (v === best) cls = 'is-best';
          else if (v === worst) cls = 'is-worst';
        }
        tr.appendChild(el('td', { class: cls, text: isNum(v) ? row.fmt(v) : '—' }));
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    box.appendChild(el('div', { class: 'table-scroll' }, table));
    box.appendChild(el('p', {
      class: 'field-note',
      style: 'margin-top:8px',
      text: '提示：手机上可左右滑动查看完整表格。「每分成本」仅作辅助参考，价格低不等于产品更好。'
    }));
  }

  /* ---------- 5.6 PK 对比 ---------- */

  /** 计算 A 相对 B 的优势条目 */
  function pkAdvantages(a, b) {
    var out = [];

    if (isNum(a.product.weightKg) && isNum(b.product.weightKg) && a.product.weightKg < b.product.weightKg) {
      out.push('更轻：' + a.product.weightKg + 'kg vs ' + b.product.weightKg + 'kg');
    }
    if (isNum(a.product.price) && isNum(b.product.price) && a.product.price < b.product.price) {
      out.push('价格更低：¥' + fmtNum(a.product.price) + ' vs ¥' + fmtNum(b.product.price));
    }
    if (a.costPerPoint !== null && b.costPerPoint !== null && a.costPerPoint < b.costPerPoint) {
      out.push('每分成本更低：¥' + a.costPerPoint.toFixed(2) + ' vs ¥' + b.costPerPoint.toFixed(2));
    }

    DIMENSIONS.forEach(function (dim) {
      var sa = a.result.byKey[dim.key].score;
      var sb = b.result.byKey[dim.key].score;
      if (sa <= sb) return;
      if (dim.key === 'weight') return; // 已用 kg 表述
      if (dim.key === 'foldedVolume') {
        var la = foldedVolumeLiters(a.product), lb = foldedVolumeLiters(b.product);
        if (isNum(la) && isNum(lb)) {
          out.push('折叠体积更小：' + fmtNum(la) + ' L vs ' + fmtNum(lb) + ' L');
          return;
        }
      }
      out.push(dim.label + '更好：' + sa + '/' + dim.max + ' vs ' + sb + '/' + dim.max);
    });

    if (a.match !== null && b.match !== null && a.match > b.match) {
      out.push('更贴合你选择的使用场景：' + a.match + '% vs ' + b.match + '%');
    }
    return out;
  }

  /** 便携性 / 舒适通过性两组打分，用于生成确定性结论 */
  function groupScores(m) {
    var s = scoreMap(m.result);
    return {
      portability: s.weight + s.folding + s.foldedVolume,          // 满分 30
      comfortRoad: s.suspension + s.comfort + s.newborn + s.handling // 满分 38
    };
  }

  function pkConclusions(a, b) {
    var ga = groupScores(a), gb = groupScores(b);
    var out = [];

    function pick(va, vb, gapText, tieText) {
      if (va === vb) return tieText;
      return gapText(va > vb ? a : b);
    }

    out.push(pick(ga.portability, gb.portability,
      function (m) { return '如果你经常开车、上下楼、坐高铁飞机：更推荐 ' + m.name + '（便携组 ' + Math.max(ga.portability, gb.portability) + '/30）'; },
      '便携性两者接近，可按外观和预算选择'));

    out.push(pick(ga.comfortRoad, gb.comfortRoad,
      function (m) { return '如果你更在意新生儿舒适性和烂路避震：更推荐 ' + m.name + '（舒适通过组 ' + Math.max(ga.comfortRoad, gb.comfortRoad) + '/38）'; },
      '舒适性与通过性两者接近'));

    if (a.result.total !== b.result.total) {
      var better = a.result.total > b.result.total ? a : b;
      var other = better === a ? b : a;
      out.push('综合评分更高：' + better.name + '（' + better.result.total + ' 分 vs ' + other.result.total + ' 分）');
    } else {
      out.push('两款车综合评分相同（均为 ' + a.result.total + ' 分），建议按最看重的单项取舍');
    }

    if (a.costPerPoint !== null && b.costPerPoint !== null && a.costPerPoint !== b.costPerPoint) {
      var cheap = a.costPerPoint < b.costPerPoint ? a : b;
      out.push('如果预算优先：' + cheap.name + ' 的每分成本更低（¥' + cheap.costPerPoint.toFixed(2) + '/分）');
    }

    if (a.match !== null && b.match !== null && a.match !== b.match) {
      var fit = a.match > b.match ? a : b;
      out.push('结合你勾选的使用场景：' + fit.name + ' 匹配度更高（' + fit.match + '%）');
    }

    // 一票否决类提醒优先级最高
    [a, b].forEach(function (m) {
      var hasDanger = m.warnings.some(function (w) { return w.level === 'danger'; });
      if (hasDanger) out.unshift('注意：' + m.name + ' 存在需要优先确认的安全/适用性风险，请先看风险提醒。');
    });

    return out;
  }

  function renderPK() {
    var box = clearNode($('#pkBody'));
    if (models.length < 2) {
      box.appendChild(el('p', {
        class: 'field-note',
        text: '至少需要 2 款产品才能进行 PK 对比。'
      }));
      return;
    }

    var ids = models.map(function (m) { return m.product.id; });
    if (ids.indexOf(state.ui.pkA) < 0) state.ui.pkA = ids[0];
    if (ids.indexOf(state.ui.pkB) < 0 || state.ui.pkB === state.ui.pkA) {
      state.ui.pkB = ids.filter(function (id) { return id !== state.ui.pkA; })[0];
    }

    function selectFor(side) {
      var sel = el('select', {
        class: 'select', id: 'pk-' + side,
        onChange: function (e) {
          state.ui['pk' + side] = e.target.value;
          if (state.ui.pkA === state.ui.pkB) {
            var other = ids.filter(function (id) { return id !== e.target.value; })[0];
            state.ui[side === 'A' ? 'pkB' : 'pkA'] = other;
          }
          renderPK();
        }
      });
      models.forEach(function (m) {
        sel.appendChild(el('option', {
          value: m.product.id, text: m.name + '（' + m.result.total + ' 分）',
          selected: state.ui['pk' + side] === m.product.id
        }));
      });
      sel.value = state.ui['pk' + side];
      return sel;
    }

    box.appendChild(el('div', { class: 'pk-picker' }, [
      el('div', { class: 'field' }, [
        el('label', { class: 'field-label', for: 'pk-A', text: '产品 A' }), selectFor('A')
      ]),
      el('div', { class: 'pk-vs', text: 'VS' }),
      el('div', { class: 'field' }, [
        el('label', { class: 'field-label', for: 'pk-B', text: '产品 B' }), selectFor('B')
      ])
    ]));

    var a = models.filter(function (m) { return m.product.id === state.ui.pkA; })[0];
    var b = models.filter(function (m) { return m.product.id === state.ui.pkB; })[0];
    if (!a || !b) return;

    function column(x, y, title) {
      var adv = pkAdvantages(x, y);
      var ul = el('ul', { class: 'pk-list' + (adv.length ? '' : ' is-empty') });
      if (adv.length) {
        adv.forEach(function (t) { ul.appendChild(el('li', {}, el('span', { text: t }))); });
      } else {
        ul.appendChild(el('li', {}, el('span', { text: '在当前已填写的参数中没有明显优势项' })));
      }
      return el('div', { class: 'pk-col' }, [
        el('h4', { text: title + '：' + x.name }),
        el('div', { class: 'pk-score', text: x.result.total + ' / ' + TOTAL_MAX + ' · ' + x.grade.label + (x.match !== null ? ' · 匹配度 ' + x.match + '%' : '') }),
        ul
      ]);
    }

    box.appendChild(el('div', { class: 'pk-grid' }, [
      column(a, b, 'A 的优势'),
      column(b, a, 'B 的优势')
    ]));

    box.appendChild(el('div', { class: 'pk-conclusion' }, [
      el('h4', { text: '结论建议' }),
      el('ul', {}, pkConclusions(a, b).map(function (t) {
        return el('li', {}, el('span', { text: '· ' + t }));
      }))
    ]));
  }

  /* ---------- 5.7 评分规则说明 ---------- */

  function renderRules() {
    var box = clearNode($('#rulesBody'));
    $('#rulesTotal').textContent = String(TOTAL_MAX);
    $('#rulesCount').textContent = String(DIMENSIONS.length);

    box.appendChild(el('div', { class: 'rules-note' }, [
      el('h4', { text: '关于执行标准（截至 ' + STANDARD_CONFIG.asOf + '）' }),
      el('ul', {}, standardNotes().map(function (t) { return el('li', { text: '· ' + t }); })),
      el('p', { class: 'field-note', style: 'margin-top:6px', text: '以上标准信息集中定义在 js/app.js 的 STANDARD_CONFIG 中，后续标准更新只需修改该对象。' })
    ]));

    DIMENSIONS.forEach(function (dim) {
      var body = el('div', { class: 'rule-body' });
      var table = el('table', { class: 'rule-table' });
      var tbody = el('tbody');

      if (dim.type === 'select' || dim.type === 'volume') {
        dim.options.forEach(function (o) {
          tbody.appendChild(el('tr', {}, [
            el('td', { text: o.label }), el('td', { text: o.score + ' 分' })
          ]));
        });
      } else if (dim.type === 'checks') {
        dim.items.forEach(function (it) {
          tbody.appendChild(el('tr', {}, [
            el('td', { text: it.label }), el('td', { text: '+' + it.score + ' 分' })
          ]));
        });
      } else if (dim.type === 'weight') {
        dim.brackets.forEach(function (b) {
          tbody.appendChild(el('tr', {}, [
            el('td', { text: b.label }), el('td', { text: b.score + ' 分' })
          ]));
        });
        tbody.appendChild(el('tr', {}, [
          el('td', { text: '未填写重量' }), el('td', { text: '0 分' })
        ]));
      } else if (dim.type === 'bool') {
        tbody.appendChild(el('tr', {}, [el('td', { text: dim.checkLabel }), el('td', { text: dim.max + ' 分' })]));
        tbody.appendChild(el('tr', {}, [el('td', { text: '否则' }), el('td', { text: '0 分' })]));
      }
      table.appendChild(tbody);
      body.appendChild(table);
      if (dim.hint) body.appendChild(el('p', { class: 'dim-hint', text: dim.hint }));

      box.appendChild(el('details', { class: 'rule-block' }, [
        el('summary', {}, [
          el('span', { text: dim.label }),
          el('span', { class: 'rule-max', text: '满分 ' + dim.max + ' 分' })
        ]),
        body
      ]));
    });

    box.appendChild(el('div', { class: 'rules-note' }, [
      el('h4', { text: '评分等级' }),
      el('div', { class: 'grade-legend' }, GRADES.map(function (g, i) {
        var upper = i === 0 ? TOTAL_MAX : GRADES[i - 1].min - 1;
        var range = i === 0 ? (g.min + '～' + TOTAL_MAX) : (i === GRADES.length - 1 ? ('<' + GRADES[i - 1].min) : (g.min + '～' + upper));
        return el('span', { text: range + '：' + g.label });
      })),
      el('p', { class: 'field-note', style: 'margin-top:8px', text: '星级 = 总分 / 100 × 5 颗星，按比例填充，与总分严格同步。' })
    ]));
  }

  /* =======================================================================
   * 6. 编辑器（由 DIMENSIONS 配置自动生成表单）
   * ===================================================================== */

  function fieldWrap(labelText, control, id, note) {
    return el('div', { class: 'field' }, [
      el('label', { class: 'field-label', for: id, text: labelText }),
      control,
      note ? el('span', { class: 'field-note', text: note }) : null
    ]);
  }

  function numberInput(id, value, onValue, extra) {
    var opts = extra || {};
    var input = el('input', {
      type: 'number', class: 'input', id: id, min: '0',
      step: opts.step || '1',
      inputmode: 'decimal',
      placeholder: opts.placeholder || '',
      value: isNum(value) ? String(value) : '',
      onInput: function (e) {
        // 禁止负数
        if (e.target.value.indexOf('-') >= 0) e.target.value = e.target.value.replace(/-/g, '');
        onValue(parseNum(e.target.value));
      }
    });
    return input;
  }

  function openEditor(id) {
    var product = getProduct(id);
    if (!product) return;

    var refs = { sections: {} };

    var scoreValue = el('span', { class: 'score-big', text: '0' });
    var scoreMaxEl = el('span', { class: 'score-max', text: '/ ' + TOTAL_MAX });
    var gradeEl = el('span', { class: 'grade-label' });
    var starsWrap = el('span', {});
    var metaEl = el('div', { class: 'es-meta' });

    var header = el('div', { class: 'editor-score' }, [
      el('div', { class: 'es-main' }, [scoreValue, scoreMaxEl, gradeEl, starsWrap]),
      metaEl
    ]);

    function refresh() {
      var m = buildModel(product, state.data.preferences);
      scoreValue.textContent = String(m.result.total);
      scoreValue.className = 'score-big score-' + scoreClass(m.result.total, TOTAL_MAX);
      gradeEl.textContent = m.grade.label;
      gradeEl.className = 'grade-label ' + m.grade.cls;
      clearNode(starsWrap).appendChild(starsNode(m.result.total));

      clearNode(metaEl);
      append(metaEl, [
        el('span', { text: '完整度 ' + m.completeness.percent + '%' }),
        m.costPerPoint !== null ? el('span', { text: '每分成本 ¥' + m.costPerPoint.toFixed(2) }) : el('span', { text: '每分成本：填写售价后显示' }),
        m.match !== null ? el('span', { text: '场景匹配度 ' + m.match + '%' }) : null
      ]);

      Object.keys(refs.sections).forEach(function (key) {
        var it = m.result.byKey[key];
        refs.sections[key].textContent = it.score + ' / ' + it.max;
      });
      if (refs.volumeText) {
        var liters = foldedVolumeLiters(product);
        var sizeText = foldedSizeText(product);
        refs.volumeText.textContent = sizeText
          ? sizeText + '　折叠体积约 ' + fmtNum(liters) + ' L'
          : '填写长/宽/高后显示折叠尺寸与体积';
      }
      if (refs.weightText) {
        refs.weightText.textContent = isNum(product.weightKg)
          ? '当前折算：' + m.result.byKey.weight.score + ' / ' + DIM_MAP.weight.max + ' 分'
          : DIM_MAP.weight.missingText + '，按 0 分计算';
      }

      saveData();
      renderAll();
    }

    var body = el('div', {});
    body.appendChild(header);

    /* --- 基本信息 --- */
    var basic = el('div', { class: 'form-section' }, [
      el('h4', {}, [el('span', { text: '基本信息' })])
    ]);
    var basicGrid = el('div', { class: 'form-grid' });
    basicGrid.appendChild(fieldWrap('品牌', el('input', {
      type: 'text', class: 'input', id: 'f-brand', maxlength: '60',
      placeholder: '例如：Cybex', value: product.brand,
      onInput: function (e) { product.brand = e.target.value; refresh(); }
    }), 'f-brand'));
    basicGrid.appendChild(fieldWrap('型号', el('input', {
      type: 'text', class: 'input', id: 'f-model', maxlength: '80',
      placeholder: '例如：Melio Carbon', value: product.model,
      onInput: function (e) { product.model = e.target.value; refresh(); }
    }), 'f-model'));
    basicGrid.appendChild(fieldWrap('售价（元，可留空）',
      numberInput('f-price', product.price, function (v) { product.price = v; refresh(); }, { step: '1', placeholder: '例如：3299' }),
      'f-price'));
    basic.appendChild(basicGrid);
    body.appendChild(basic);

    /* --- 13 个评分维度 --- */
    DIMENSIONS.forEach(function (dim) {
      var scoreSpan = el('span', { class: 'sec-score', text: '0 / ' + dim.max });
      refs.sections[dim.key] = scoreSpan;

      var section = el('div', { class: 'form-section' }, [
        el('h4', {}, [
          el('span', { text: dim.label + '（满分 ' + dim.max + '）' }),
          scoreSpan
        ])
      ]);

      if (dim.type === 'select') {
        var selId = 'f-' + dim.key;
        var sel = el('select', {
          class: 'select', id: selId,
          onChange: function (e) { product[dim.field] = e.target.value; refresh(); }
        });
        dim.options.forEach(function (o) {
          sel.appendChild(el('option', { value: o.value, text: o.label + '（' + o.score + ' 分）' }));
        });
        sel.value = product[dim.field] || '';
        section.appendChild(fieldWrap('选择最接近的描述', sel, selId, dim.hint));

      } else if (dim.type === 'checks') {
        var list = el('div', { class: 'check-list' });
        dim.items.forEach(function (it) {
          var cid = 'f-' + dim.key + '-' + it.key;
          var label = el('label', {
            class: 'check-tile' + (product[dim.field][it.key] ? ' is-on' : ''), for: cid
          }, [
            el('input', {
              type: 'checkbox', id: cid, checked: !!product[dim.field][it.key],
              onChange: function (e) {
                product[dim.field][it.key] = e.target.checked;
                label.className = 'check-tile' + (e.target.checked ? ' is-on' : '');
                refresh();
              }
            }),
            el('span', { text: it.label }),
            el('span', { class: 'tile-score', text: '+' + it.score })
          ]);
          list.appendChild(label);
        });
        section.appendChild(list);

      } else if (dim.type === 'weight') {
        refs.weightText = el('p', { class: 'dim-hint' });
        var wGrid = el('div', { class: 'form-grid' });
        wGrid.appendChild(fieldWrap('整车重量（kg，可填小数）',
          numberInput('f-weight', product.weightKg, function (v) { product.weightKg = v; refresh(); }, { step: '0.1', placeholder: '例如：5.9' }),
          'f-weight'));
        section.appendChild(wGrid);
        section.appendChild(refs.weightText);

      } else if (dim.type === 'volume') {
        var gid = 'f-' + dim.key;
        var gsel = el('select', {
          class: 'select', id: gid,
          onChange: function (e) { product[dim.field] = e.target.value; refresh(); }
        });
        dim.options.forEach(function (o) {
          gsel.appendChild(el('option', { value: o.value, text: o.label + '（' + o.score + ' 分）' }));
        });
        gsel.value = product[dim.field] || '';
        section.appendChild(fieldWrap('折叠体积档位（决定得分）', gsel, gid, dim.hint));

        var sizeGrid = el('div', { class: 'form-grid cols-3', style: 'margin-top:12px' });
        [['length', '折叠长度'], ['width', '折叠宽度'], ['height', '折叠高度']].forEach(function (pair) {
          var key = pair[0], text = pair[1];
          var fid = 'f-fold-' + key;
          sizeGrid.appendChild(fieldWrap(text + '（cm）',
            numberInput(fid, product.foldedSize[key], function (v) { product.foldedSize[key] = v; refresh(); }, { step: '0.1' }),
            fid));
        });
        section.appendChild(sizeGrid);
        refs.volumeText = el('p', { class: 'dim-hint' });
        section.appendChild(refs.volumeText);

      } else if (dim.type === 'bool') {
        var bid = 'f-' + dim.key;
        var blabel = el('label', {
          class: 'check-tile' + (product[dim.field] ? ' is-on' : ''), for: bid
        }, [
          el('input', {
            type: 'checkbox', id: bid, checked: !!product[dim.field],
            onChange: function (e) {
              product[dim.field] = e.target.checked;
              blabel.className = 'check-tile' + (e.target.checked ? ' is-on' : '');
              refresh();
            }
          }),
          el('span', { text: dim.checkLabel }),
          el('span', { class: 'tile-score', text: '+' + dim.max })
        ]);
        section.appendChild(blabel);
      }

      body.appendChild(section);
    });

    /* --- 备注 --- */
    var notesId = 'f-notes';
    body.appendChild(el('div', { class: 'form-section' }, [
      el('h4', {}, [el('span', { text: '备注' })]),
      fieldWrap('备注（选购时的想法、渠道、赠品等）', el('textarea', {
        class: 'textarea', id: notesId, maxlength: '1000',
        placeholder: '例如：京东自营，赠凉席和蚊帐',
        value: product.notes,
        onInput: function (e) { product.notes = e.target.value; refresh(); }
      }), notesId)
    ]));

    openModal({
      title: '编辑产品',
      content: body,
      buttons: [{ label: '完成', kind: 'primary' }]
    });

    refresh();
  }

  function openRename(id) {
    var product = getProduct(id);
    if (!product) return;
    var brand = el('input', { type: 'text', class: 'input', id: 'rn-brand', maxlength: '60', value: product.brand, placeholder: '品牌' });
    var model = el('input', { type: 'text', class: 'input', id: 'rn-model', maxlength: '80', value: product.model, placeholder: '型号' });
    openModal({
      title: '重命名产品',
      size: 'sm',
      content: el('div', { class: 'form-grid' }, [
        fieldWrap('品牌', brand, 'rn-brand'),
        fieldWrap('型号', model, 'rn-model')
      ]),
      buttons: [
        { label: '取消' },
        {
          label: '保存', kind: 'primary',
          onClick: function () {
            product.brand = brand.value.trim();
            product.model = model.value.trim();
            saveData();
            renderAll();
            toast('已更新名称');
          }
        }
      ]
    });
  }

  /* =======================================================================
   * 7. 导入 / 导出 / 示例数据 / 事件
   * ===================================================================== */

  function exportData() {
    if (!state.data.products.length) {
      toast('还没有产品可以导出', 'bad');
      return;
    }
    var payload = {
      version: APP.version,
      exportedAt: new Date().toISOString(),
      preferences: state.data.preferences,
      products: state.data.products
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = el('a', { href: url, download: APP.exportFileName });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('已导出 ' + APP.exportFileName, 'good');
  }

  /** 严格校验导入内容，返回 {products, preferences}，失败抛出可读错误 */
  function parseImport(text) {
    var json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw new Error('JSON 格式错误，无法解析：' + e.message);
    }
    if (json === null || typeof json !== 'object') {
      throw new Error('文件内容必须是一个 JSON 对象或数组');
    }
    var src = Array.isArray(json) ? { products: json } : json;
    if (!Array.isArray(src.products)) {
      throw new Error('缺少 products 数组，请确认这是本工具导出的文件');
    }
    if (!src.products.length) {
      throw new Error('products 数组为空，没有可导入的产品');
    }
    var invalid = src.products.filter(function (p) {
      return !p || typeof p !== 'object' || Array.isArray(p);
    }).length;
    if (invalid) {
      throw new Error('有 ' + invalid + ' 条产品数据格式不正确（应为对象）');
    }
    var migrated = migrateData(src);
    return migrated;
  }

  function handleImportFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onerror = function () { toast('文件读取失败', 'bad'); };
    reader.onload = function () {
      var incoming;
      try {
        incoming = parseImport(String(reader.result));
      } catch (err) {
        openModal({
          title: '导入失败',
          size: 'sm',
          content: el('p', { class: 'modal-text', text: err.message }),
          buttons: [{ label: '知道了', kind: 'primary' }]
        });
        return;
      }

      var count = incoming.products.length;
      if (!state.data.products.length) {
        applyImport(incoming, 'replace');
        return;
      }
      openModal({
        title: '导入数据',
        size: 'sm',
        content: el('p', {
          class: 'modal-text',
          text: '文件中包含 ' + count + ' 款产品。当前已有 ' + state.data.products.length +
            ' 款产品，请选择导入方式：「覆盖」会清空现有数据，「追加」会保留现有数据并合并。'
        }),
        buttons: [
          { label: '取消' },
          { label: '追加合并', onClick: function () { applyImport(incoming, 'append'); } },
          { label: '覆盖现有数据', kind: 'danger', onClick: function () { applyImport(incoming, 'replace'); } }
        ]
      });
    };
    reader.readAsText(file);
  }

  function applyImport(incoming, mode) {
    if (mode === 'replace') {
      state.data.products = incoming.products;
      state.data.preferences = incoming.preferences;
    } else {
      incoming.products.forEach(function (p) { p.id = uid(); });
      state.data.products = state.data.products.concat(incoming.products);
    }
    dedupeIds(state.data.products);
    saveData();
    renderScenarios();
    renderAll();
    toast('已导入 ' + incoming.products.length + ' 款产品', 'good');
  }

  function clearAll() {
    if (!state.data.products.length) {
      toast('当前没有数据');
      return;
    }
    confirmDialog({
      title: '清空全部产品',
      message: '将删除全部 ' + state.data.products.length + ' 款产品数据，此操作无法撤销。确定继续吗？',
      okLabel: '继续', danger: true,
      onOk: function () {
        confirmDialog({
          title: '再次确认',
          message: '真的要清空所有产品吗？建议先「导出」备份。',
          okLabel: '确认清空', danger: true,
          onOk: function () {
            state.data.products = [];
            state.ui.pkA = '';
            state.ui.pkB = '';
            state.ui.expanded = {};
            saveData();
            renderAll();
            toast('已清空全部产品', 'good');
          }
        });
      }
    });
  }

  /** 示例数据：仅用于快速体验，可随时清空 */
  function sampleProducts() {
    return [
      {
        brand: 'Cybex', model: 'Melio Carbon', price: 3299,
        newborn: 'basic', standard: 'B',
        safety: { fivePointHarness: true, linkedBrake: true, frameLock: true, adjustableHarness: false },
        weightKg: 5.9, suspension: 'smallBasic', folding: 'oneHand', foldedGrade: 'car',
        foldedSize: { length: 74, width: 51, height: 21 },
        reversible: 'forward',
        comfort: { tallBackrest: true, wideSeat: false, adjustableLegRest: false, breathable: true },
        canopy: 'upfBig', handling: 'good', storage: true, aftersales: true,
        notes: '示例数据，参数需以官方说明书为准'
      },
      {
        brand: 'Bugaboo', model: 'Fox 5', price: 6999,
        newborn: 'flat', standard: 'B',
        safety: { fivePointHarness: true, linkedBrake: true, frameLock: true, adjustableHarness: true },
        weightKg: 10.4, suspension: 'bigFour', folding: 'twoStep', foldedGrade: 'bulky',
        foldedSize: { length: 90, width: 60, height: 35 },
        reversible: 'both',
        comfort: { tallBackrest: true, wideSeat: true, adjustableLegRest: true, breathable: true },
        canopy: 'full', handling: 'good', storage: true, aftersales: true,
        notes: '示例数据，参数需以官方说明书为准'
      },
      {
        brand: 'Joolz', model: 'Aer+', price: 4299,
        newborn: 'basic', standard: 'E',
        safety: { fivePointHarness: true, linkedBrake: true, frameLock: true, adjustableHarness: false },
        weightKg: 6.4, suspension: 'none', folding: 'oneHandStand', foldedGrade: 'travel',
        foldedSize: { length: 53, width: 45, height: 21 },
        reversible: 'forward',
        comfort: { tallBackrest: true, wideSeat: false, adjustableLegRest: false, breathable: true },
        canopy: 'upfBig', handling: 'normal', storage: false, aftersales: true,
        notes: '示例数据，参数需以官方说明书为准'
      }
    ];
  }

  function loadSampleData() {
    var products = sampleProducts().map(function (raw, i) {
      return normalizeProduct(raw, '婴儿车 ' + (i + 1));
    });
    state.data.products = state.data.products.concat(products);
    saveData();
    renderAll();
    toast('已载入 ' + products.length + ' 款示例产品', 'good');
  }

  function bindEvents() {
    $('#btnAdd').addEventListener('click', addProduct);
    $('#btnAdd2').addEventListener('click', addProduct);
    $('#btnExport').addEventListener('click', exportData);
    $('#btnClear').addEventListener('click', clearAll);

    var fileInput = $('#fileInput');
    $('#btnImport').addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      handleImportFile(file);
      e.target.value = ''; // 允许重复导入同一文件
    });

    var sortSelect = $('#sortSelect');
    SORT_OPTIONS.forEach(function (s) {
      sortSelect.appendChild(el('option', { value: s.key, text: s.label }));
    });
    sortSelect.value = state.ui.sortKey;
    sortSelect.addEventListener('change', function (e) {
      state.ui.sortKey = e.target.value;
      renderRanking();
      renderCompare();
    });
  }

  /* =======================================================================
   * 启动
   * ===================================================================== */

  function init() {
    if (TOTAL_MAX !== 100) {
      // 配置校验：任何规则改动都必须保持总分 100
      console.warn('[评分配置异常] 13 项满分合计为 ' + TOTAL_MAX + '，应为 100');
    }
    state.data = loadData();
    bindEvents();
    renderScenarios();
    renderRules();
    renderAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // 供控制台调试与自测使用（不污染业务逻辑）
  window.__strollerScorer = {
    calculateScore: calculateScore,
    calculateWarnings: calculateWarnings,
    calculateTags: calculateTags,
    calculateCompleteness: calculateCompleteness,
    calculateMatch: calculateMatch,
    migrateData: migrateData,
    parseImport: parseImport,
    DIMENSIONS: DIMENSIONS,
    TOTAL_MAX: TOTAL_MAX,
    state: state
  };
})();
