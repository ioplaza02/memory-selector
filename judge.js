/*
 * メモリーセレクター：互換判定ロジック
 * ブラウザでは window.MemJudge、Node（テスト）では module.exports として使う。
 *
 * 考え方
 *  - 形状（DIMM / S.O.DIMM）と世代（DDR4 / DDR5）は完全一致が必須（物理的に挿さらない）
 *  - 速度は「速いメモリー → 遅いPC」は PC側の速度で動作（上位互換）
 *          「遅いメモリー → 速いPC」は 動作はするが全体が遅い側に揃う（下位互換）
 */
(function (root) {
  'use strict';

  var RANK = { same: 0, upper: 1, unknown: 1, lower: 2 };

  var RANK_LABEL = {
    same: '同等品',
    upper: '上位互換',
    lower: '下位互換',
    unknown: '推奨'
  };

  /**
   * 1つの商品とPCの条件を比べる
   * @param {object} pc  { formFactor:'DIMM'|'SODIMM', ddr:4|5, speed:number|null, speedOver:boolean }
   *                     speedOver=true は「6000以上」「3600以上」のようなオーバークロック域
   * @param {object} p   products.json の1件
   * @returns {object|null} 使えない組み合わせなら null
   */
  function judgeOne(pc, p) {
    if (p.formFactor !== pc.formFactor) return null;
    if (p.ddr !== pc.ddr) return null;

    var ps = p.speed;
    var cs = pc.speed;
    var gen = 'DDR' + p.ddr;

    if (!cs) {
      return {
        rank: 'unknown',
        label: RANK_LABEL.unknown,
        diff: 0,
        text: 'お使いのパソコンの速度が分からないため、より高速な規格の商品を先に表示しています。高速なメモリーは、それより遅いパソコンに取り付けても、パソコン側の速度に合わせて動作するため、幅広い機種で使える可能性が高くなります。'
      };
    }

    var pcName = gen + '-' + cs + (pc.speedOver ? '以上' : '');
    var pName = gen + '-' + ps;
    var mem = 'このメモリー（' + pName + '）';
    var yours = 'お使いのパソコン（' + pcName + '）';

    if (ps === cs && !pc.speedOver) {
      return {
        rank: 'same', label: RANK_LABEL.same, diff: 0,
        text: mem + 'は、' + yours + 'と同じ規格です。'
      };
    }
    if (ps > cs && !pc.speedOver) {
      return {
        rank: 'upper', label: RANK_LABEL.upper, diff: ps - cs,
        text: mem + 'は、' + yours + 'より高速な規格です。取り付けるとパソコン側の速度（' + cs + '）に合わせて動作するため、問題なくお使いいただけます。'
      };
    }
    // 遅いメモリー → 速いPC（またはOC域）
    var t = mem + 'は、' + yours + 'より低速な規格です。取り付けて使うことはできますが、パソコン全体のメモリー速度がこのメモリーの速度（' + ps + '）まで下がるため、本来の性能より少し遅くなります。';
    if (pc.speedOver) {
      t += ' なお、' + pcName + ' のような速度は、オーバークロック（XMP／EXPO）設定で動いているメモリーの可能性が高く、I-O DATA製品（標準規格品）に交換・混在させると速度が下がります。';
    }
    return { rank: 'lower', label: RANK_LABEL.lower, diff: (pc.speedOver ? 9999 - ps : cs - ps), text: t };
  }

  /**
   * 候補一覧をつくる（シリーズ単位でまとめる）
   * @param {object} pc
   * @param {Array} products
   * @param {object} opt { includeDiscontinued:boolean, capacityGB:number|null }
   */
  function recommend(pc, products, opt) {
    opt = opt || {};
    var bySeries = {};
    var order = [];
    products.forEach(function (p) {
      var j = judgeOne(pc, p);
      if (!j) return;
      if (p.status === 'discontinued' && !opt.includeDiscontinued) return;
      if (opt.capacityGB && p.capacityGB !== opt.capacityGB) return;
      if (!bySeries[p.series]) {
        bySeries[p.series] = { series: p.series, url: p.url, speed: p.speed, ddr: p.ddr,
          formFactor: p.formFactor, business: p.business, warranty: p.warranty, image: p.image || null,
          judge: j, items: [] };
        order.push(p.series);
      }
      bySeries[p.series].items.push(p);
    });
    var list = order.map(function (k) { return bySeries[k]; });
    list.forEach(function (s) {
      s.items.sort(function (a, b) { return a.capacityGB - b.capacityGB; });
      s.buyable = s.items.some(function (i) { return i.status !== 'discontinued'; });
    });
    list.sort(function (a, b) {
      // 1) 買えるもの優先 2) 同等→上位→下位 3) 速度差が小さい順 4) 不明時は速い順 5) 一般向けを先に
      if (a.buyable !== b.buyable) return a.buyable ? -1 : 1;
      var r = RANK[a.judge.rank] - RANK[b.judge.rank];
      if (r) return r;
      if (a.judge.diff !== b.judge.diff) return a.judge.diff - b.judge.diff;
      if (a.speed !== b.speed) return b.speed - a.speed;
      if (a.business !== b.business) return a.business ? 1 : -1;
      return 0;
    });
    return list;
  }

  // 型番の文字列から BTO（カスタムメイド）ブランドらしさを検出
  var BTO_PATTERNS = [
    { re: /GALLERIA/i, name: 'GALLERIA（ドスパラ／サードウェーブ）' },
    { re: /RAYTREK/i, name: 'raytrek（ドスパラ／サードウェーブ）' },
    { re: /THIRDWAVE|ドスパラ/i, name: 'THIRDWAVE（ドスパラ）' },
    { re: /LIGHTNING|MAGNATE/i, name: 'Lightning／Magnate（ドスパラ）' },
    { re: /G-?TUNE/i, name: 'G-Tune（マウスコンピューター）' },
    { re: /NEXTGEAR/i, name: 'NEXTGEAR（マウスコンピューター）' },
    { re: /DAIV/i, name: 'DAIV（マウスコンピューター）' },
    { re: /LEVEL\s*∞|LEVEL-|^LEVEL/i, name: 'LEVEL∞（パソコン工房）' },
    { re: /SENSE\s*∞|SENSE-/i, name: 'SENSE∞（パソコン工房）' },
    { re: /STYLE\s*∞|STYLE-/i, name: 'STYLE∞（パソコン工房）' },
    { re: /G-?GEAR/i, name: 'G-GEAR（TSUKUMO）' },
    { re: /AERO\s*STREAM/i, name: 'AEROSTREAM（TSUKUMO）' },
    { re: /ZEFT/i, name: 'ZEFT（パソコンショップSEVEN）' },
    { re: /FRONTIER|^FR[A-Z]{2,}/i, name: 'FRONTIER（フロンティア）' }
  ];
  // ブランド名が無く、型番だけ入力された場合の判定（型番の「形」で見分ける）
  //  GALLERIA ：英字2文字＋数字1桁＋C/R/U ＋「-」＋英字1文字＋数字2桁 … 例 RL7C-R45-5N、XA7C-R47、ZA9R-R49T
  //  マウス    ：英字2文字＋「-」＋A/I＋数字1桁＋英字1文字＋数字2桁   … 例 JG-A7G60、DG-I7G70
  var BTO_MODEL_PATTERNS = [
    { re: /^[A-Z]{2}\d[CRU]-[A-Z]\d{2}[A-Z]?(-[0-9A-Z]{1,4})?$/i, name: 'GALLERIA（ドスパラ／サードウェーブ）' },
    { re: /^[A-Z]{2}-[AI]\d[A-Z]\d{2}[A-Z0-9]*$/i, name: 'マウスコンピューター（G-Tune・NEXTGEAR など）' },
    // マウス：本体ラベルの長い型番（ハイフンなし） 例 JGA7G60B5BBDW101DEC
    { re: /^[A-Z]{2}[AI]\d[A-Z]\d{2}[A-Z0-9]{8,}$/i, name: 'マウスコンピューター（G-Tune・NEXTGEAR など）' },
    // G-GEAR：英字2文字＋数字1桁＋J/A ＋「-」＋英字1文字＋数字3桁 … 例 GE7J-D242/B、GA7A-F242/XB
    { re: /^G[A-Z]\d[JA]-[A-Z]\d{3}(\/[A-Z]{1,3})?$/i, name: 'G-GEAR（TSUKUMO）' }
  ];
  // 型番が途中までしか入力されていない場合の判定（書き出しの形で見分ける）
  //  GALLERIA ：「RL7C」「RL7C-」「RL7C-R4」など、英字2文字＋数字1桁＋C/R/U で始まる
  //  マウス    ：「JG-A7」「DG-I7G」など（NEC の「PC-」で始まる型番は除外）
  var BTO_MODEL_PREFIX = [
    { re: /^[A-Z]{2}\d[CRU](-([A-Z](\d{1,2}[A-Z]?)?)?)?$/i, name: 'GALLERIA（ドスパラ／サードウェーブ）' },
    { re: /^(?!PC-)[A-Z]{2}-[AI]\d([A-Z]\d{0,2})?$/i, name: 'マウスコンピューター（G-Tune・NEXTGEAR など）' },
    { re: /^G[A-Z]\d[JA]-([A-Z]\d{0,3})?$/i, name: 'G-GEAR（TSUKUMO）' }
  ];
  // 戻り値: { name, guess, partial } または null
  //  guess=true は型番の形からの推定、partial=true は型番の途中までの入力からの推定
  function detectBTO(text) {
    if (!text) return null;
    var s = String(text)
      .replace(/[！-～]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/[‐ー－]/g, '-')
      .trim();
    var i;
    for (i = 0; i < BTO_PATTERNS.length; i++) {
      if (BTO_PATTERNS[i].re.test(s)) return { name: BTO_PATTERNS[i].name, guess: false };
    }
    var compact = s.replace(/\s+/g, '');
    for (i = 0; i < BTO_MODEL_PATTERNS.length; i++) {
      if (BTO_MODEL_PATTERNS[i].re.test(compact)) return { name: BTO_MODEL_PATTERNS[i].name, guess: true, partial: false };
    }
    for (i = 0; i < BTO_MODEL_PREFIX.length; i++) {
      if (BTO_MODEL_PREFIX[i].re.test(compact)) return { name: BTO_MODEL_PREFIX[i].name, guess: true, partial: true };
    }
    return null;
  }

  // 型番の表記ゆれをそろえる（大文字化・空白/ハイフン/スラッシュ除去・全角→半角）
  function normalizeModel(s) {
    return String(s || '')
      .replace(/[！-～]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .toUpperCase()
      .replace(/[\s\-‐ー－/／_]/g, '');
  }

  var api = { judgeOne: judgeOne, recommend: recommend, detectBTO: detectBTO,
    normalizeModel: normalizeModel, RANK_LABEL: RANK_LABEL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MemJudge = api;
})(this);
