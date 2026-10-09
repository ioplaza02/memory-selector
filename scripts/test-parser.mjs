// スクレイパーの解析部分のテスト（ネットワーク不要）
// 使い方: node scripts/test-parser.mjs
import assert from 'node:assert/strict';
import {
  parseSeriesLinks, parseStatusesFromList, seriesMarkedDiscontinued,
  parseSeriesPage, specFromSku, belongsToSeries, mergeStatus,
} from './scrape.mjs';

const close = '<img src="/common/img_v2/icon_close.gif" alt="生産終了">';
const limit = '<img src="/common/img_v2/icon_limit.gif" alt="店頭在庫限り">';
const row = (sku, slug, icon = '') =>
  `<tr><td><a href="/product/memory/note/${slug}/index.htm">${sku}</a> ${icon}</td><td>8GB</td><td>オープン価格</td></tr>`;

const listHtml = `
<h2>DDR5 SDRAM</h2>
<h3><a href="/product/memory/note/sd5r5600gq/index.htm">SD5R5600/GQシリーズ</a></h3>
<a href="/product/memory/note/sd5r5600gq/index.htm"><img src="x.jpg" alt="SD5R5600/GQシリーズ"></a>
<table>${row('SD5R5600-8G/GQ', 'sd5r5600gq')}${row('SD5R5600-16G/GQ', 'sd5r5600gq')}</table>
<h3><a href="/product/memory/note/sd5r5600/index.htm">SD5R5600シリーズ</a></h3>
<table>${row('SD5R5600-8G', 'sd5r5600', close)}${row('SD5R5600-32G', 'sd5r5600', limit)}</table>
<table><tr><td>${close}</td><td><a href="/product/memory/note/sd5r4800/index.htm">SD5R4800シリーズ</a></td></tr></table>
<h2>DDR4 SDRAM</h2>
<h3><a href="https://www.iodata.jp/product/memory/note/sdz3200cst/index.htm">SDZ3200-C/STシリーズ</a></h3>
<table>${row('SDZ3200-C4G/ST', 'sdz3200cst', limit)}${row('SDZ3200-C8G/ST', 'sdz3200cst')}</table>
`;

// シリーズリンク（画像リンクの重複を除き、シリーズ名のものだけ）
const links = parseSeriesLinks(listHtml);
assert.deepEqual(links.map((l) => l.slug), ['sd5r5600gq', 'sd5r5600', 'sd5r4800', 'sdz3200cst']);
assert.equal(links[3].url, 'https://www.iodata.jp/product/memory/note/sdz3200cst/index.htm');
assert.equal(links[0].url, 'https://www.iodata.jp/product/memory/note/sd5r5600gq/index.htm');

// 状態：行の中だけで判定（SD5R5600-32G の後ろにある「生産終了」行を拾わない）
const st = parseStatusesFromList(listHtml);
assert.equal(st['SD5R5600-8G/GQ'], 'current');
assert.equal(st['SD5R5600-8G'], 'discontinued');
assert.equal(st['SD5R5600-32G'], 'limited');
assert.equal(st['SDZ3200-C4G/ST'], 'limited');
assert.equal(st['SDZ3200-C8G/ST'], 'current');

// シリーズごと生産終了の判定（前の表の最終行の icon_close を拾わない）
assert.equal(seriesMarkedDiscontinued(listHtml, links[2]), true);
assert.equal(seriesMarkedDiscontinued(listHtml, links[1]), false);
assert.equal(seriesMarkedDiscontinued(listHtml, links[3]), false);

// シリーズページ
const seriesHtml = `
<p>無期限保証対象品 ※初回導入本体に限る</p>
<table>
<tr><td>SD5R4800-8G</td><td>2026/10/1生産終了</td></tr>
<tr><td>SD5R4800-16G</td><td>2026/10/1生産終了</td></tr>
</table>
<div class="related"><a>SD5R5600-16G/GQ</a></div>`;
const sp = parseSeriesPage(seriesHtml);
assert.equal(sp.warranty, '無期限保証');
assert.equal(sp.status['SD5R4800-8G'], 'discontinued');
assert.ok(sp.skus.includes('SD5R5600-16G/GQ'));
assert.equal(belongsToSeries('SD5R5600-16G/GQ', 'SD5R4800シリーズ'), false); // 関連商品は除外される
assert.equal(belongsToSeries('SD5R4800-8G', 'SD5R4800シリーズ'), true);
assert.equal(belongsToSeries('SD5R4800-8G/GQ', 'SD5R4800シリーズ'), false);
assert.equal(belongsToSeries('SD5R4800-8G/GQ', 'SD5R4800/GQシリーズ'), true);
assert.equal(belongsToSeries('DZ3200-C16G/ST', 'DZ3200-C/STシリーズ'), true);
assert.equal(belongsToSeries('SDZ3200-C16G/ST', 'DZ3200-C/STシリーズ'), false);

assert.equal(parseSeriesPage('<p>アイオーは安心の長期保証6年を実現！</p><p>法人様専用モデル</p>').warranty, '6年保証');
assert.equal(parseSeriesPage('<p>法人様専用モデル</p>').business, true);

// 型番 → 規格
assert.deepEqual(specFromSku('D5R5600-16G/GQ'), { formFactor: 'DIMM', ddr: 5, speed: 5600, capacityGB: 16, business: true });
assert.deepEqual(specFromSku('SDZ3200-C32G/ST'), { formFactor: 'SODIMM', ddr: 4, speed: 3200, capacityGB: 32, business: false });
assert.equal(specFromSku('HDL4-Z25SI3BB'), null);

// JANコード・画像・一時受注停止
const page2 = `<img src="/image/sdz3200cst_l.jpg" alt="">
<table>
<tr><td>SDZ3200-C16G/ST</td><td>4957180166155</td><td>16GB</td><td>オープン価格</td><td></td></tr>
<tr><td>SDZ3200-C32G/ST</td><td>4957180178868</td><td>32GB</td><td>オープン価格</td><td>一時受注停止</td></tr>
</table>`;
const sp2 = parseSeriesPage(page2, 'sdz3200cst');
assert.equal(sp2.jan['SDZ3200-C16G/ST'], '4957180166155');
assert.equal(sp2.jan['SDZ3200-C32G/ST'], '4957180178868');
assert.equal(sp2.status['SDZ3200-C32G/ST'], 'suspended');
assert.equal(sp2.status['SDZ3200-C16G/ST'], undefined);
assert.equal(sp2.image, 'https://www.iodata.jp/image/sdz3200cst_l.jpg');
assert.equal(parseSeriesPage('<img src="https://www.iodata.jp/image/d5r5600_l.jpg">', 'd5r5600').image, 'https://www.iodata.jp/image/d5r5600_l.jpg');
assert.equal(mergeStatus('current', 'suspended'), 'suspended');
assert.equal(mergeStatus('limited', undefined), 'limited');
assert.equal(mergeStatus(undefined, undefined), 'current');
assert.equal(mergeStatus('limited', 'discontinued'), 'discontinued');

console.log('parser tests: all passed');
