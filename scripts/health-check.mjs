// 商品データの健全性チェック
// 使い方: node scripts/health-check.mjs <前回のproducts.json> <今回のproducts.json>
// 問題があれば理由を表示して exit 1（GitHub Actions 側で PR と Issue を作成して知らせる）
import { readFile } from 'node:fs/promises';

const [prevPath, nextPath] = process.argv.slice(2);
const load = async (p) => JSON.parse(await readFile(p, 'utf8'));

const problems = [];
let prev = null;
try { prev = await load(prevPath); } catch { /* 初回は前回データなし */ }
const next = await load(nextPath);
const P = next.products || [];

if (P.length === 0) problems.push('商品が1件も取得できませんでした（ページ構造が変わった可能性があります）');

if (prev && prev.products && prev.products.length) {
  const before = prev.products.length;
  if (P.length < before * 0.9) {
    problems.push(`商品件数が1割以上減りました（前回 ${before} 件 → 今回 ${P.length} 件）`);
  }
  // 前回あった型番が消えた場合は内訳を出す（生産終了品は通常一覧に残るため、消えるのは異常のサイン）
  const now = new Set(P.map((p) => p.sku));
  const gone = prev.products.filter((p) => !now.has(p.sku)).map((p) => p.sku);
  if (gone.length) console.log(`前回から消えた型番: ${gone.join(', ')}`);
}

// 4種類（DIMM/SODIMM × DDR4/DDR5）のどれかが丸ごと消えていないか
for (const ff of ['DIMM', 'SODIMM']) {
  for (const ddr of [4, 5]) {
    if (!P.some((p) => p.formFactor === ff && p.ddr === ddr)) {
      problems.push(`${ff} / DDR${ddr} の商品が0件です`);
    }
  }
}

// 必須項目の欠け
const broken = P.filter((p) => !p.sku || !p.url || !p.speed || !p.capacityGB || !p.series);
if (broken.length) problems.push(`必須項目が欠けた商品があります: ${broken.map((p) => p.sku || '(型番なし)').join(', ')}`);

if (problems.length) {
  console.error('健全性チェックで問題が見つかりました:');
  problems.forEach((m) => console.error(' - ' + m));
  process.exit(1);
}
console.log(`健全性チェックOK（${P.length} 件）`);
