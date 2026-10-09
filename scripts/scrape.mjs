// メモリーセレクター：商品データ収集スクリプト
// 使い方: node scripts/scrape.mjs
//
// - 外部ライブラリなし（Node 18 以降の fetch のみ）
// - リクエストは並列にせず 1件ずつ 2秒間隔、専用 User-Agent
// - 対象は www.iodata.jp のメモリー商品ページのみ。
//   ※ PIO（pio.iodata.jp）は robots.txt で自動取得が拒否されているため取得しない。
//
// 出力: data/products.json

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'data', 'products.json');
const BASE = 'https://www.iodata.jp';
const LIST_PAGES = [
  { url: `${BASE}/product/memory/desktop/index.htm`, formFactor: 'DIMM' },
  { url: `${BASE}/product/memory/note/index.htm`, formFactor: 'SODIMM' },
];
const UA = 'MemorySelectorBot/1.0 (+https://ioplaza02.github.io/memory-selector/)';
const WAIT_MS = 2000;

// 型番の形：D5R5600-16G/GQ、SD5R4800-8G、DZ3200-C8G/ST、SDZ3200-C16G/ST など
export const SKU_RE = /\b(S?D(?:5R|Z|4R)\d{4}-C?\d{1,3}G(?:\/[A-Z]{2,3})?)(?![A-Z0-9\/])/g;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let first = true;
async function get(url) {
  if (!first) await sleep(WAIT_MS);
  first = false;
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ja' } });
  if (!res.ok) {
    const err = new Error(`${res.status} ${url}`);
    err.status = res.status;
    throw err;
  }
  return await res.text();
}

// ---------- 解析（テストできるよう純粋関数にしている） ----------

// 一覧ページからシリーズページのリンクを取り出す
export function parseSeriesLinks(html) {
  const out = [];
  const seen = new Set();
  const re = /<a[^>]+href="([^"]*\/product\/memory\/(desktop|note)\/([a-z0-9]+)\/(?:index\.htm)?)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const slug = m[3];
    if (seen.has(slug)) continue;
    const text = m[4].replace(/<[^>]+>/g, '').trim();
    if (!/シリーズ/.test(text)) continue; // 画像リンク・型番リンクは除く（シリーズ名のリンクだけ採用）
    seen.add(slug);
    let href = m[1];
    if (href.startsWith('/')) href = BASE + href;
    if (!/^https?:/.test(href)) href = `${BASE}/product/memory/${m[2]}/${slug}/index.htm`;
    out.push({ slug, url: href.replace(/^http:/, 'https:'), series: text, index: m.index });
  }
  return out;
}

// HTML の範囲から状態を判定（行の終わり </tr> までに限定し、次の行・次のシリーズの表記を拾わない）
export function statusFromChunk(chunk) {
  const rowEnd = chunk.search(/<\/tr>/i);
  if (rowEnd >= 0) chunk = chunk.slice(0, rowEnd);
  if (/icon_close|生産終了/.test(chunk)) return 'discontinued';
  if (/icon_limit|在庫限り/.test(chunk)) return 'limited';
  return null;
}

// 一覧ページ内での各型番の状態（型番の出現位置から、次の型番が出るまでの範囲を見る）
// ※ 最初の出現だけで決めず、出現ごとの範囲で判定する（NASセレクターでの教訓）
export function parseStatusesFromList(html) {
  const hits = [];
  let m;
  const re = new RegExp(SKU_RE.source, 'g');
  while ((m = re.exec(html))) hits.push({ sku: m[1], at: m.index, end: re.lastIndex });
  const map = {};
  hits.forEach((h, i) => {
    const next = hits[i + 1] ? hits[i + 1].at : Math.min(html.length, h.end + 800);
    const chunk = html.slice(h.end, Math.min(next, h.end + 800));
    const st = statusFromChunk(chunk);
    if (st) map[h.sku] = st;
    else if (!(h.sku in map)) map[h.sku] = 'current';
  });
  return map;
}

// 一覧ページで「生産終了」の行だけになっているシリーズ（表が無い）を見つける
export function seriesMarkedDiscontinued(html, link) {
  const before = html.slice(Math.max(0, link.index - 400), link.index);
  // 直前の同じ行（<tr>以降）に「生産終了」がある
  const rowStart = before.lastIndexOf('<tr');
  if (rowStart < 0) return false;
  const row = before.slice(rowStart);
  // 前のシリーズの表の最終行（</tr> で閉じている）を誤って拾わない
  return !/<\/tr>/i.test(row) && /生産終了/.test(row);
}

// シリーズページから型番一覧・保証・法人向けかを取り出す
export function parseSeriesPage(html) {
  const skus = [];
  const status = {};
  const re = new RegExp(SKU_RE.source, 'g');
  const hits = [];
  let m;
  while ((m = re.exec(html))) hits.push({ sku: m[1], at: m.index, end: re.lastIndex });
  hits.forEach((h, i) => {
    if (!skus.includes(h.sku)) skus.push(h.sku);
    const next = hits[i + 1] ? hits[i + 1].at : h.end + 400;
    const st = statusFromChunk(html.slice(h.end, Math.min(next, h.end + 400)));
    if (st) status[h.sku] = st;
  });
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ');
  let warranty = null;
  if (/無期限保証/.test(text)) warranty = '無期限保証';
  else {
    const w = text.match(/長期保証\s*(\d+)\s*年|(\d+)\s*年保証/);
    if (w) warranty = `${w[1] || w[2]}年保証`;
  }
  const business = /法人様専用/.test(text);
  return { skus, status, warranty, business };
}

// その型番がシリーズに属するか（関連商品欄などに出る他シリーズの型番を除外する）
// 例: 「DZ3200-C/STシリーズ」→ DZ3200-C で始まり /ST で終わる型番
export function belongsToSeries(sku, seriesName) {
  const base = seriesName.replace(/シリーズ.*$/, '').trim();
  const [head, suffix] = base.split('/');
  const skuSuffix = (sku.split('/')[1]) || '';
  const okHead = head.includes('-') ? sku.startsWith(head) : sku.startsWith(head + '-');
  return okHead && skuSuffix === (suffix || '');
}

// 型番から規格を読み取る
export function specFromSku(sku) {
  const m = sku.match(/^(S?)D(5R|Z|4R)(\d{4})-C?(\d{1,3})G(?:\/([A-Z]+))?$/);
  if (!m) return null;
  return {
    formFactor: m[1] === 'S' ? 'SODIMM' : 'DIMM',
    ddr: m[2] === '5R' ? 5 : 4,
    speed: Number(m[3]),
    capacityGB: Number(m[4]),
    business: m[5] === 'GQ',
  };
}

// ---------- 本体 ----------
async function main() {
  const products = [];
  const seenSku = new Set();

  for (const page of LIST_PAGES) {
    console.log(`一覧取得: ${page.url}`);
    const listHtml = await get(page.url);
    const links = parseSeriesLinks(listHtml);
    const listStatus = parseStatusesFromList(listHtml);
    console.log(`  シリーズ ${links.length} 件`);

    for (const link of links) {
      let sp;
      try {
        sp = parseSeriesPage(await get(link.url));
      } catch (e) {
        if (e.status === 404) { console.warn(`  404のため飛ばします: ${link.url}`); continue; }
        throw e;
      }
      const wholeEol = seriesMarkedDiscontinued(listHtml, link);
      for (const sku of sp.skus) {
        if (seenSku.has(sku)) continue;
        const spec = specFromSku(sku);
        if (!spec) continue;
        if (spec.formFactor !== page.formFactor) continue; // 他カテゴリへのリンク内の型番は除外
        if (!belongsToSeries(sku, link.series)) continue;  // 関連商品欄などの他シリーズ型番は除外
        seenSku.add(sku);
        const status = wholeEol ? 'discontinued'
          : (listStatus[sku] || sp.status[sku] || 'current');
        products.push({
          sku,
          series: link.series,
          url: link.url,
          ...spec,
          business: spec.business || sp.business,
          status,
          warranty: sp.warranty,
        });
      }
      console.log(`  ${link.series}: ${sp.skus.length} 型番${wholeEol ? '（シリーズごと生産終了）' : ''}`);
    }
  }

  products.sort((a, b) =>
    a.formFactor.localeCompare(b.formFactor) || b.ddr - a.ddr || b.speed - a.speed ||
    Number(a.business) - Number(b.business) || a.capacityGB - b.capacityGB);

  const out = {
    updatedAt: new Date().toISOString(),
    source: `${BASE}/product/memory/`,
    products,
  };
  await writeFile(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`書き出し: ${products.length} 件 → data/products.json`);
}

// テストから import されたときは実行しない
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
