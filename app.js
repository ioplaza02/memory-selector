/* メモリーセレクター 画面ロジック */
(function () {
  'use strict';

  // ===== 設定 =====
  var SITE_PASSWORD = 'memory2026'; // 簡易的な鍵（静的配信のため本物のセキュリティではない）
  var STALE_DAYS = 40;              // この日数以上データ更新が無いと赤字警告
  // PIOの検索結果URL。makerCd=-1（メーカー指定なし）で動くかは要確認。
  // 動かない場合はメーカー選択を追加し、ここに makerCd を入れる。
  var PIO_SEARCH_URL = 'https://pio.iodata.jp/pio/MatchBody?makerCd={maker}&keyWord={kw}&release=-1&categoryCd=1&bodyType=-1';
  var PIO_TOP_URL = 'https://www.iodata.jp/pio/pc.htm';

  var J = window.MemJudge;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var DATA = { products: [], updatedAt: null };
  var PIO = { entries: [] };

  var state = {
    form: null,   // 'DIMM' | 'SODIMM' | 'unknown'
    ddr: null,    // '5' | '4' | 'old' | 'onboard' | 'unknown'
    speed: null,  // number | 'over' | 'unknown'
    cap: null,    // number | null
    showEol: false,
    bto: null,    // 検出したBTOブランド名
    pioMatch: null
  };

  var SPEEDS = {
    '5': [4800, 5200, 5600, 'over', 'unknown'],
    '4': [2133, 2400, 2666, 2933, 3200, 'over', 'unknown']
  };
  var OVER_SPEED = { '5': 6000, '4': 3600 };

  var CPU_HINTS = {
    'ryzen-am5':  { ddr: '5', text: 'Ryzen 7000／8000／9000 シリーズ（デスクトップ用）は DDR5 専用です。「DDR5」を選択しました。' },
    'ryzen-old':  { ddr: '4', text: 'Ryzen 5000 シリーズ以前（デスクトップ用）は DDR4 です。「DDR4」を選択しました。' },
    'core-ultra': { ddr: '5', text: 'Core Ultra 搭載機は DDR5 です。「DDR5」を選択しました。ただし薄型ノートでは、メモリーが基板に直付け（LPDDR5／LPDDR5X）で増設できない機種が多くあります。タスクマネージャーでスロットの表示があるか確認してください。' },
    'intel-12-14':{ ddr: 'unknown', text: '第12〜14世代の Core は、マザーボードによって DDR4 の機種と DDR5 の機種の両方があり、CPUだけでは判別できません。下の「③ 速度」で、タスクマネージャーの「速度」と同じ数字を選んでください。数字から世代（DDR4／DDR5）も自動で判定します。' },
    'intel-8-11': { ddr: '4', text: '第8〜11世代の Core を搭載したパソコンの多くは DDR4 です。「DDR4」を選択しました。' }
  };

  // ===== パスワード =====
  function unlock() {
    $('#gate').hidden = true;
    $('#app').hidden = false;
  }
  function initGate() {
    var ok = false;
    try { ok = sessionStorage.getItem('memsel-ok') === '1'; } catch (e) { /* 使えない環境は毎回入力 */ }
    if (ok) { unlock(); return; }
    $('#gate-form').addEventListener('submit', function (e) {
      e.preventDefault();
      if ($('#gate-input').value === SITE_PASSWORD) {
        try { sessionStorage.setItem('memsel-ok', '1'); } catch (e2) { /* noop */ }
        unlock();
      } else {
        $('#gate-error').hidden = false;
        $('#gate-input').select();
      }
    });
    $('#gate-input').focus();
  }

  // ===== データ読み込み =====
  function loadJSON(path) {
    return fetch(path + '?v=' + Date.now()).then(function (r) {
      if (!r.ok) throw new Error(path + ' ' + r.status);
      return r.json();
    });
  }

  function showUpdated() {
    var el = $('#updated');
    if (!DATA.updatedAt) { el.textContent = ''; return; }
    var d = new Date(DATA.updatedAt);
    var days = Math.floor((Date.now() - d.getTime()) / 86400000);
    var s = d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
    if (days >= STALE_DAYS) {
      el.textContent = '商品データ最終更新：' + s + '（' + days + '日間更新されていません）';
      el.classList.add('stale');
    } else {
      el.textContent = '商品データ最終更新：' + s;
    }
  }

  // ===== HTML ヘルパー =====
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function ffLabel(ff) { return ff === 'DIMM' ? 'デスクトップ用（DIMM）' : 'ノート・小型用（S.O.DIMM）'; }
  function statusBadge(st) {
    if (st === 'limited') return '<span class="st st-limited">在庫限り</span>';
    if (st === 'suspended') return '<span class="st st-suspended">一時受注停止</span>';
    if (st === 'discontinued') return '<span class="st st-discontinued">生産終了</span>';
    return '';
  }
  function yen(n) { return '¥' + Number(n).toLocaleString('ja-JP'); }

  // 型番1行分：型番（大）→ 税込価格（税抜）→ JAN、左に容量
  function renderSkuRow(p, business) {
    var price;
    if (p.priceTaxIn) {
      price = '<p class="sku-price"><span class="p-in">' + yen(p.priceTaxIn) + '</span>' +
        (p.priceTaxEx ? '<span class="p-ex">（税抜 ' + yen(p.priceTaxEx) + '）</span>' : '') + '</p>';
    } else {
      price = '<p class="sku-price"><span class="p-open">オープン価格</span>' +
        (business ? '<span class="p-ex">（価格はお取引先の販売店へお問い合わせください）</span>' : '') + '</p>';
    }
    return '<div class="sku-row' + (p.status === 'discontinued' ? ' is-discontinued' : '') + '">' +
      (p.capacityGB ? '<div class="cap-pill"><b>' + p.capacityGB + '</b>GB</div>' : '<div class="cap-pill">-</div>') +
      '<div class="sku-body">' +
        '<p class="sku-code">' + esc(p.sku) + statusBadge(p.status) + '</p>' +
        price +
        (p.jan ? '<p class="sku-jan">JAN：' + esc(p.jan) + '</p>' : '') +
      '</div></div>';
  }

  // ===== ① 型番で探す =====
  function onModelSubmit(e) {
    e.preventDefault();
    runModel($('#model-input').value.trim());
  }

  function runModel(raw) {
    var box = $('#model-result');
    if (!raw) { box.hidden = true; state.bto = null; state.pioMatch = null; render(); return; }

    state.bto = J.detectBTO(raw);
    state.pioMatch = findPio(raw);

    var pioUrl = PIO_SEARCH_URL.replace('{maker}', '-1').replace('{kw}', encodeURIComponent(raw));
    var html = '';

    if (state.pioMatch) {
      html += '<div class="msg msg-ok"><p class="msg-title">対応表で一致する機種が見つかりました</p>' +
        '<p>' + esc(state.pioMatch.maker) + ' ' + esc(state.pioMatch.model) + '：下の「結果」に、使える組み合わせを表示しています。</p></div>';
    } else if (state.bto) {
      var btoTitle = state.bto.partial
        ? '「' + esc(raw) + '」は ' + esc(state.bto.name) + ' のカスタムメイド（BTO）パソコンの型番（の一部）のようです'
        : state.bto.guess
          ? '「' + esc(raw) + '」は ' + esc(state.bto.name) + ' のカスタムメイド（BTO）パソコンの型番のようです'
          : esc(state.bto.name) + ' はカスタムメイド（BTO）パソコンです';
      html += '<div class="msg msg-warn"><p class="msg-title">' + btoTitle + '</p>' +
        '<p>カスタムメイドのパソコンは、購入時にパーツを選んで組み立てるため、型番ごとの対応表（PIO）には載っていないことがほとんどです。</p>' +
        '<p>下の「<b>② スペックで探す</b>」で、メモリーの形・世代・速度を選んでください。I-O DATA製で使える可能性が高い商品をご案内します。</p>' +
        (state.bto.guess
          ? '<p class="note">型番の形から判断しています。メーカー製パソコンの場合は <a href="' + esc(pioUrl) + '" target="_blank" rel="noopener">PIOで検索</a> もお試しください。</p>'
          : '') + '</div>';
    } else {
      html += '<div class="msg msg-info"><p class="msg-title">対応表（PIO）で確認できます</p>' +
        '<p>メーカー製パソコンの場合、I-O DATAの対応表（PIO）に載っている可能性があります。下のボタンから検索結果を開いてください。</p>' +
        '<p>PIOで見つからなかった場合は、下の「<b>② スペックで探す</b>」へお進みください。</p>' +
        (J.normalizeModel(raw).length < 5
          ? '<p class="note">入力された型番が短いため、検索結果が0件になったり、関係のない機種がたくさん出たりすることがあります。型番はパソコン本体の裏面や側面のシールなどで確認して、できるだけ最後まで入力してください。</p>'
          : '') +
        '<div class="actions"><a class="btn" href="' + esc(pioUrl) + '" target="_blank" rel="noopener">PIOで「' + esc(raw) + '」を検索する</a>' +
        '<a class="btn btn-outline" href="' + PIO_TOP_URL + '" target="_blank" rel="noopener">PIOの検索画面を開く</a></div></div>';
    }
    box.innerHTML = html;
    box.hidden = false;
    render();
  }

  // 社内提供データ（data/pio-memory.json）があれば、型番を照合する
  function findPio(raw) {
    if (!PIO.entries || !PIO.entries.length) return null;
    var key = J.normalizeModel(raw);
    if (key.length < 3) return null;
    var exact = null, partial = null;
    PIO.entries.forEach(function (en) {
      var m = J.normalizeModel(en.model);
      if (m === key) exact = exact || en;
      else if (!partial && m.indexOf(key) === 0) partial = en;
    });
    return exact || partial;
  }

  // ===== ② スペックで探す =====
  function setChoice(q, v) {
    $$('.q[data-q="' + q + '"] .choices button').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-v') === String(v) ? 'true' : 'false');
    });
  }

  // 世代が「分からない」ときは DDR4・DDR5 の速度をまとめて出す（数字から世代を判定できるため）
  // DDR4 は〜4400程度、DDR5 は 4800〜 で数字が重ならない
  function buildSpeedChoicesBoth() {
    var label = function (t) {
      return '<p style="flex-basis:100%;margin:6px 0 0;font-size:13px;color:var(--muted)">' + t + '</p>';
    };
    var btn = function (g, v) {
      var text = v === 'over' ? (g === '4' ? '3600〜4400' : '6000以上') : v;
      return '<button type="button" data-v="' + g + ':' + v + '" aria-pressed="false">' + text +
        '<small>DDR' + g + '</small></button>';
    };
    $('#speed-choices').innerHTML =
      label('タスクマネージャーの「速度」が 4800 以上なら DDR5') +
      [4800, 5200, 5600, 'over'].map(function (v) { return btn('5', v); }).join('') +
      label('3200 以下（またはそれに近い数字）なら DDR4') +
      [2133, 2400, 2666, 2933, 3200, 'over'].map(function (v) { return btn('4', v); }).join('');
  }

  function buildSpeedChoices() {
    if (state.ddr === 'unknown') { buildSpeedChoicesBoth(); return; }
    var wrap = $('#speed-choices');
    var list = SPEEDS[state.ddr] || [];
    wrap.innerHTML = list.map(function (v) {
      var label = v === 'over' ? OVER_SPEED[state.ddr] + '以上' : (v === 'unknown' ? '分からない' : v);
      var sub = v === 'over' ? '<small>ゲーミングPCに多い</small>' : '';
      return '<button type="button" data-v="' + v + '" aria-pressed="false">' + label + sub + '</button>';
    }).join('');
  }

  function buildCapChoices() {
    var caps = {};
    DATA.products.forEach(function (p) {
      if (String(p.ddr) === state.ddr && p.formFactor === state.form) caps[p.capacityGB] = true;
    });
    var list = Object.keys(caps).map(Number).sort(function (a, b) { return a - b; });
    var html = '<button type="button" data-v="" aria-pressed="' + (state.cap ? 'false' : 'true') + '">指定しない</button>';
    html += list.map(function (c) {
      return '<button type="button" data-v="' + c + '" aria-pressed="' + (state.cap === c ? 'true' : 'false') + '">' + c + 'GB</button>';
    }).join('');
    $('#cap-choices').innerHTML = html;
  }

  function onChoice(e) {
    var btn = e.target.closest('.choices button');
    if (!btn) return;
    var q = btn.closest('.q').getAttribute('data-q');
    var v = btn.getAttribute('data-v');

    if (q === 'form') {
      state.form = v;
    } else if (q === 'ddr') {
      if (state.ddr !== v) { state.speed = null; state.cap = null; }
      state.ddr = v;
    } else if (q === 'speed') {
      if (v.indexOf(':') > 0) {          // 世代不明からの選択（例 5:5600）
        var gv = v.split(':');
        state.ddr = gv[0];
        v = gv[1];
        state.cap = null;
      }
      state.speed = (v === 'over' || v === 'unknown') ? v : Number(v);
    } else if (q === 'cap') {
      state.cap = v ? Number(v) : null;
    }
    syncQuestions();
    render();
  }

  function onCpu() {
    var h = CPU_HINTS[$('#cpu-select').value];
    var el = $('#cpu-hint');
    if (!h) { el.hidden = true; return; }
    el.textContent = h.text;
    el.hidden = false;
    if (h.ddr) {
      if (state.ddr !== h.ddr) { state.speed = null; state.cap = null; }
      state.ddr = h.ddr;
      syncQuestions();
      render();
    }
  }

  // 選択状態に合わせて③④の表示を切り替える
  function syncQuestions() {
    setChoice('form', state.form);
    setChoice('ddr', state.ddr);
    var specOk = (state.form === 'DIMM' || state.form === 'SODIMM') && (state.ddr === '4' || state.ddr === '5');
    var qs = $('.q[data-q="speed"]');
    var qc = $('.q[data-q="cap"]');
    qs.hidden = !(state.ddr === '4' || state.ddr === '5' || state.ddr === 'unknown');
    if (!qs.hidden) {
      buildSpeedChoices();
      setChoice('speed', state.speed == null ? '' : state.speed);
    }
    qc.hidden = !(specOk && state.speed != null);
    if (!qc.hidden) buildCapChoices();
  }

  // ===== 結果 =====
  function render() {
    var sec = $('#sec-result');
    var body = $('#result-body');

    // パターン1：社内データで型番が一致
    if (state.pioMatch) {
      sec.hidden = false;
      body.innerHTML = renderPioMatch(state.pioMatch);
      return;
    }

    if (!state.form && !state.ddr) { sec.hidden = true; return; }
    sec.hidden = false;

    // 判定できないケースの案内
    if (state.ddr === 'onboard') {
      body.innerHTML = '<div class="msg msg-bad"><p class="msg-title">メモリーを増設できないパソコンです</p>' +
        '<p>メモリーが基板に直付け（オンボード）されているパソコンは、あとからメモリーを増やすことができません。</p>' +
        '<p>タスクマネージャーで「使用中のスロット」が表示されない、またはフォームファクターが DIMM／SODIMM 以外の場合もこれに当たります。</p></div>';
      return;
    }
    if (state.ddr === 'old') {
      body.innerHTML = '<div class="msg msg-bad"><p class="msg-title">DDR3以前の世代は対象外です</p>' +
        '<p>現在 I-O DATA で取り扱っているメモリーは DDR4・DDR5 のみのため、本セレクターでは DDR4 以降の世代を対象としています。</p>' +
        '<p>過去の商品は <a href="https://www.iodata.jp/product/discon/index.php" target="_blank" rel="noopener">生産終了品の検索</a> から探すことができます。</p></div>';
      return;
    }
    var missing = [];
    if (!state.form || state.form === 'unknown') missing.push('パソコンの形（DIMM／SODIMM）');
    if (!state.ddr || state.ddr === 'unknown') missing.push('メモリーの世代（DDR4／DDR5）');
    if (missing.length) {
      var unknownMsg = (state.form === 'unknown' || state.ddr === 'unknown');
      var how = [];
      if (state.form === 'unknown') how.push('<b>パソコンの形</b>は、タスクマネージャーの「フォーム ファクター」欄（DIMM＝デスクトップ、SODIMM＝ノート・小型）で分かります。');
      if (state.ddr === 'unknown') how.push('<b>世代</b>は、タスクマネージャー右上の容量の横（例：16.0 GB <b>DDR5</b>）に表示されます。表示が無い場合は、「③ 速度」でタスクマネージャーの「速度」と同じ数字を選ぶと自動で判定します。');
      body.innerHTML = '<div class="msg ' + (unknownMsg ? 'msg-warn' : 'msg-info') + '"><p class="msg-title">' +
        (unknownMsg ? '調べ方をご案内します' : 'あと少しです') + '</p>' +
        '<p>' + missing.join('・') + 'が決まると、使える商品を表示します。</p>' +
        how.map(function (t) { return '<p>' + t + '</p>'; }).join('') +
        (unknownMsg ? '<p>タスクマネージャーの開き方は、上の「<b>タスクマネージャーで調べる方法</b>」をご覧ください。</p>' : '') +
        '</div>';
      if (unknownMsg) $('#tm-guide').open = true;
      if (state.ddr === 'unknown') $('.mini-guide').open = true;
      return;
    }
    if (state.speed == null) {
      body.innerHTML = '<div class="msg msg-info"><p class="msg-title">あと少しです</p><p>③ 速度を選んでください（分からない場合は「分からない」を選べます）。</p></div>';
      return;
    }

    var pc = {
      formFactor: state.form,
      ddr: Number(state.ddr),
      speed: state.speed === 'unknown' ? null : (state.speed === 'over' ? OVER_SPEED[state.ddr] : state.speed),
      speedOver: state.speed === 'over'
    };
    var list = J.recommend(pc, DATA.products, { includeDiscontinued: state.showEol, capacityGB: state.cap });
    body.innerHTML = renderSpecResult(pc, list);
  }

  function pcSpecText(pc) {
    var sp = pc.speed ? ('DDR' + pc.ddr + '-' + pc.speed + (pc.speedOver ? '以上' : '')) : ('DDR' + pc.ddr + '（速度不明）');
    return ffLabel(pc.formFactor) + '／' + sp;
  }

  function renderSpecResult(pc, list) {
    var html = '';
    var lead = state.bto
      ? esc(state.bto.name) + ' のカスタムメイド（BTO）パソコンのため、こちらが使える可能性があります。'
      : 'カスタムメイド（BTO）パソコンや、対応表で型番が見つからない場合の目安です。';
    html += '<div class="msg msg-info"><p class="msg-title">' + lead + '</p>' +
      '<p>メーカーの記載内容（' + esc(pcSpecText(pc)) + '）をもとに、I-O DATA製で現在使える可能性が高い商品を、相性の良い順に並べています。</p></div>';

    html += '<div class="pc-summary"><span>お使いのパソコン（メーカー記載）</span><b>' + esc(pcSpecText(pc)) + '</b>' +
      (state.cap ? '<span>希望容量：<b>' + state.cap + 'GB</b>／1枚</span>' : '') + '</div>';

    if (!list.length) {
      html += '<p class="empty">' + (state.showEol
        ? '条件に合う商品がありません。容量の指定を外してお試しください。'
        : '現在販売中の商品には、条件に合うものがありません。「生産終了品も表示」をオンにするか、容量の指定を外してお試しください。') + '</p>';
    } else {
      html += '<div class="series-list">' + list.map(renderSeries).join('') + '</div>';
    }

    html += renderTips(pc, list);
    html += renderDisclaimer();
    return html;
  }

  function renderSeries(s) {
    var j = s.judge;
    var spec = ffLabel(s.formFactor) + '／DDR' + s.ddr + '-' + s.speed;
    var rows = s.items.map(function (p) { return renderSkuRow(p, s.business); }).join('');
    var img = s.image
      ? '<a class="series-img" href="' + esc(s.url) + '" target="_blank" rel="noopener" title="' + esc(s.series) + ' の商品ページを開く">' +
        '<img src="' + esc(s.image) + '" alt="' + esc(s.series) + '" loading="lazy" onerror="this.parentNode.hidden=true"></a>'
      : '';
    return '<article class="series rank-' + j.rank + (s.buyable ? '' : ' unbuyable') + '">' +
      '<div class="series-head">' +
        '<div class="series-top"><span class="badge b-' + j.rank + '">' + esc(j.label) + '</span>' +
        '<p class="series-name">' + esc(s.series) + '</p>' +
        (s.business ? '<span class="badge b-biz">法人様専用</span>' : '') +
        (s.warranty ? '<span class="badge b-warranty">' + esc(s.warranty) + '</span>' : '') + '</div>' +
        '<a class="series-btn" href="' + esc(s.url) + '" target="_blank" rel="noopener">商品ページを見る<span aria-hidden="true">›</span></a>' +
      '</div>' +
      '<div class="series-main">' + img +
        '<div class="series-info"><p class="series-spec">' + esc(spec) + '</p>' +
        '<p class="series-text">' + esc(j.text) + '</p></div>' +
      '</div>' +
      '<div class="sku-list">' + rows + '</div>' +
      '</article>';
  }

  function renderTips(pc, list) {
    var tips = [];
    tips.push('<b>交換するなら、2枚とも新しいメモリーにそろえるのがおすすめです。</b>メモリーは、同じ容量・同じ規格のものを2枚1組で使うと「デュアルチャネル」という仕組みで本来の速さを発揮します。もともと入っているメモリーを1枚残したまま、新しいメモリーを1枚だけ足したり入れ替えたりすると、容量や速度がそろわず、せっかくの性能を活かしきれないことがあります。スロットが2つあるパソコンなら、2枚とも同じ新しい商品に丸ごと交換してください（例：8GB×2枚 → 16GB×2枚）。');
    tips.push('<b>空きスロットを確認してください。</b>タスクマネージャーの「スロットの使用」（ガイド画像の <span class="mark">C</span>）が「2/2」のように埋まっている場合は、増設ではなく今のメモリーとの<b>交換</b>になります。');
    tips.push('<b>他社製メモリーとの混在</b>は、相性により動作しない場合があります。確実に使うには、すべて同じ商品にそろえる（交換する）方法が安心です。');
    if (pc.speedOver) {
      tips.push('<b>オーバークロック（XMP／EXPO）メモリーについて：</b>ゲーミングPCでは、標準より速い設定で動くメモリーが搭載されていることがあります。I-O DATA製品は標準規格品のため、交換・混在させるとメモリーの速度が下がります。');
    }
    if (list.some(function (s) { return s.business; })) {
      tips.push('<b>「法人様専用」の商品</b>は店頭では販売していません。価格・納期はお取引先の販売店へお問い合わせください。');
    }
    if (list.some(function (s) { return s.warranty === '無期限保証'; })) {
      tips.push('<b>無期限保証</b>は、最初に取り付けたパソコン本体でのご使用に限ります。');
    }
    if (pc.formFactor === 'SODIMM') {
      tips.push('<b>薄型ノートパソコン</b>は、メモリーが基板に直付けで増設できない機種があります。メーカーの仕様表で「空きスロット」の有無をご確認ください。');
    }
    return '<div class="tips"><h3>ご購入前にご確認ください</h3><ul>' +
      tips.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul></div>';
  }

  function renderDisclaimer() {
    return '<div class="disclaimer">' +
      '<p class="d-title">動作保証についてのご注意</p>' +
      '<p>この結果は、パソコンメーカーが公開している仕様と I-O DATA 製品の規格を照らし合わせた<b>目安</b>です。お使いのパソコンでの実際の動作確認は行っていないため、<b>動作を保証するものではありません</b>。ご購入はお客様ご自身のご判断でご検討ください。</p>' +
      '<p>カスタムメイド（BTO）パソコンは、購入時に選んだ構成やオプションによって、搭載されているメモリーや空きスロットが標準仕様と異なる場合があります。</p>' +
      '</div>';
  }

  function renderPioMatch(en) {
    var bySku = {};
    DATA.products.forEach(function (p) { bySku[p.sku] = p; });
    var items = (en.skus || []).map(function (s) { return bySku[s] || { sku: s, status: 'unknown' }; })
      .filter(function (p) { return state.showEol || p.status !== 'discontinued'; });
    var html = '<div class="msg msg-ok"><p class="msg-title">これが使える組み合わせです</p>' +
      '<p>' + esc(en.maker) + ' ' + esc(en.model) + ' は、I-O DATA の対応表（PIO）で次の商品が対応済みです。</p></div>';
    if (!items.length) {
      html += '<p class="empty">現在販売中の対応商品はありません。「生産終了品も表示」をオンにするか、「② スペックで探す」で後継品をお探しください。</p>';
    } else {
      html += '<div class="sku-list">' + items.map(function (p) { return renderSkuRow(p, p.business); }).join('') + '</div>';
    }
    html += '<p class="note">※ 対応表の内容はパソコン出荷時の構成が対象です。オプションの選択や構成変更をしている場合は、対応が異なることがあります。</p>';
    return html;
  }

  // ===== 共有URL =====
  // 選んだ条件を URL のパラメーターにする（例 ?form=SODIMM&ddr=5&speed=5200&cap=16&eol=1&model=RL7C-R45-5N）
  var ALLOWED = {
    form: ['DIMM', 'SODIMM', 'unknown'],
    ddr: ['5', '4', 'old', 'onboard', 'unknown']
  };
  function buildShareUrl() {
    var q = new URLSearchParams();
    var model = $('#model-result').hidden ? '' : $('#model-input').value.trim();
    if (model) q.set('model', model);
    if (state.form) q.set('form', state.form);
    if (state.ddr) q.set('ddr', state.ddr);
    if (state.speed != null) q.set('speed', String(state.speed));
    if (state.cap) q.set('cap', String(state.cap));
    if (state.showEol) q.set('eol', '1');
    var cpu = $('#cpu-select').value;
    if (cpu) q.set('cpu', cpu);
    return location.origin + location.pathname + (q.toString() ? '?' + q.toString() : '');
  }

  function applyFromUrl() {
    var q = new URLSearchParams(location.search);
    if (!q.toString()) return false;
    var v;
    if ((v = q.get('form')) && ALLOWED.form.indexOf(v) >= 0) state.form = v;
    if ((v = q.get('ddr')) && ALLOWED.ddr.indexOf(v) >= 0) state.ddr = v;
    if ((v = q.get('speed'))) {
      if (v === 'over' || v === 'unknown') state.speed = v;
      else if (/^\d{4}$/.test(v)) state.speed = Number(v);
    }
    if ((v = q.get('cap')) && /^\d{1,3}$/.test(v)) state.cap = Number(v);
    if (q.get('eol') === '1') { state.showEol = true; $('#toggle-eol').checked = true; }
    if ((v = q.get('cpu')) && CPU_HINTS[v]) {
      $('#cpu-select').value = v;
      $('#cpu-hint').textContent = CPU_HINTS[v].text;
      $('#cpu-hint').hidden = false;
      $('.mini-guide').open = true;
    }
    syncQuestions();
    if ((v = q.get('model'))) {
      v = v.slice(0, 60);
      $('#model-input').value = v;
      runModel(v);           // 中で render() まで行う
    } else {
      render();
    }
    return true;
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', '');
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy') ? resolve() : reject(); } catch (e) { reject(e); }
      document.body.removeChild(ta);
    });
  }

  function onShare() {
    var url = buildShareUrl();
    var fb = $('#share-feedback');
    var box = $('#share-url');
    box.value = url;
    copyText(url).then(function () {
      fb.textContent = 'URLをコピーしました';
      fb.className = 'share-feedback ok';
      box.hidden = true;
    }).catch(function () {
      // コピーできない環境では URL を表示して手動でコピーしてもらう
      fb.textContent = '下のURLを選択してコピーしてください';
      fb.className = 'share-feedback';
      box.hidden = false;
      box.select();
    });
    fb.hidden = false;
    clearTimeout(onShare.t);
    onShare.t = setTimeout(function () { if (box.hidden) fb.hidden = true; }, 3000);
  }

  // ===== 起動 =====
  function init() {
    initGate();
    $('#model-form').addEventListener('submit', onModelSubmit);
    $('#sec-spec').addEventListener('click', onChoice);
    $('#cpu-select').addEventListener('change', onCpu);
    $('#toggle-eol').addEventListener('change', function (e) { state.showEol = e.target.checked; render(); });
    $('#share-btn').addEventListener('click', onShare);

    var pioLoad = loadJSON('data/pio-memory.json').then(function (d) { PIO = d || { entries: [] }; })
      .catch(function () { PIO = { entries: [] }; });

    loadJSON('data/products.json').then(function (d) {
      DATA = d;
      showUpdated();
      return pioLoad;
    }).then(function () {
      if (!applyFromUrl()) { syncQuestions(); render(); }
    }).catch(function (err) {
      $('#result-body').innerHTML = '<div class="msg msg-bad"><p>商品データを読み込めませんでした。時間をおいて再読み込みしてください。</p></div>';
      $('#sec-result').hidden = false;
      console.error(err);
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
