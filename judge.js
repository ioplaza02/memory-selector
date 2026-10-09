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
        text: '速度が分からない場合は、より速い規格の商品がおすすめです。速い規格のメモリーは、遅い規格のパソコンに挿してもパソコン側の速度に合わせて動作するため、幅広い機種で使える可能性が高くなります。'
      };
    }

    var pcName = gen + '-' + cs + (pc.speedOver ? '以上' : '');
    var pName = gen + '-' + ps;

    if (ps === cs && !pc.speedOver) {
      return {
        rank: 'same', label: RANK_LABEL.same, diff: 0,
        text: 'メーカー記載の ' + pcName + ' と同じ規格です。'
      };
    }
    if (ps > cs && !pc.speedOver) {
      return {
        rank: 'upper', label: RANK_LABEL.upper, diff: ps - cs,
        text: pName + ' は ' + pcName + ' より速い規格です。パソコン側の ' + cs + ' に合わせて動作するため、性能面の問題はありません。'
      };
    }
    // 遅いメモリー → 速いPC（またはOC域）
    var t = '動作は可能ですが、' + pName + ' は ' + pcName + ' より遅い規格のため、既存のメモリーと混ぜると全体が ' + ps + ' に揃って動作し、本来の性能より少し遅くなります。';
    if (pc.speedOver) {
      t += ' ' + pcName + ' はオーバークロック（XMP / EXPO）設定で動いているメモリーの可能性が高く、I-O DATA製品（定格品）と混在させると速度が下がります。';
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
          formFactor: p.formFactor, business: p.business, warranty: p.warranty,
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
  function detectBTO(text) {
    if (!text) return null;
    var s = String(text).trim();
    for (var i = 0; i < BTO_PATTERNS.length; i++) {
      if (BTO_PATTERNS[i].re.test(s)) return BTO_PATTERNS[i].name;
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
