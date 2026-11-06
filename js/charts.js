// 手寫 SVG 圖表：顏色全部走 CSS class，深淺色模式自動適用
import { diffDays, md, addDays } from "./util.js";

const W = 640, H = 220, PL = 40, PR = 14, PT = 14, PB = 28;

function niceTicks(min, max, count = 4) {
  const span = max - min || 1;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || step0;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 1000; v += step) ticks.push(Math.round(v * 100) / 100);
  return { lo, hi, ticks };
}

function xAxis(from, to, x) {
  const days = diffDays(to, from);
  const every = days > 60 ? 14 : 7;
  let out = "";
  for (let i = 0; i <= days; i += every) {
    const d = addDays(from, i);
    out += `<line class="c-grid" x1="${x(d)}" x2="${x(d)}" y1="${PT}" y2="${H - PB}"/>`;
    out += `<text class="c-label" x="${x(d)}" y="${H - 8}" text-anchor="middle">${md(d)}</text>`;
  }
  return out;
}

function yAxis(ticks, y, unit = "") {
  return ticks.map((t) =>
    `<line class="c-grid" x1="${PL}" x2="${W - PR}" y1="${y(t)}" y2="${y(t)}"/>` +
    `<text class="c-label" x="${PL - 6}" y="${y(t) + 4}" text-anchor="end">${t}${unit}</text>`).join("");
}

// points: [{date, y}]
export function lineChart(points, { from, to, target, targetLabel = "", unit = "", empty = "還沒有資料" }) {
  if (!points.length) return `<div class="chart-empty">${empty}</div>`;
  const ys = points.map((p) => p.y).concat(target != null ? [target] : []);
  const { lo, hi, ticks } = niceTicks(Math.min(...ys) - 0.3, Math.max(...ys) + 0.3);
  const total = Math.max(1, diffDays(to, from));
  const x = (d) => PL + (diffDays(d, from) / total) * (W - PL - PR);
  const y = (v) => PT + (1 - (v - lo) / (hi - lo || 1)) * (H - PT - PB);
  const pts = points.slice().sort((a, b) => a.date.localeCompare(b.date));
  const path = pts.map((p, i) => `${i ? "L" : "M"}${x(p.date).toFixed(1)},${y(p.y).toFixed(1)}`).join("");
  const area = `${path}L${x(pts[pts.length - 1].date).toFixed(1)},${H - PB}L${x(pts[0].date).toFixed(1)},${H - PB}Z`;
  const last = pts[pts.length - 1];
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="折線圖">`;
  svg += yAxis(ticks, y) + xAxis(from, to, x);
  if (target != null) {
    svg += `<line class="c-target" x1="${PL}" x2="${W - PR}" y1="${y(target)}" y2="${y(target)}"/>`;
    svg += `<text class="c-target-label" x="${W - PR - 4}" y="${y(target) - 5}" text-anchor="end">${targetLabel}</text>`;
  }
  svg += `<path class="c-area" d="${area}"/><path class="c-line" d="${path}"/>`;
  svg += pts.map((p) => `<circle class="c-dot" cx="${x(p.date)}" cy="${y(p.y)}" r="3"><title>${md(p.date)}：${p.y}${unit}</title></circle>`).join("");
  svg += `<circle class="c-dot-end" cx="${x(last.date)}" cy="${y(last.y)}" r="5"/>`;
  svg += `<text class="c-end-label" x="${Math.min(x(last.date), W - PR - 30)}" y="${y(last.y) - 10}" text-anchor="middle">${last.y}${unit}</text>`;
  return svg + "</svg>";
}

// values: [{date, v, partial}]
export function barChart(values, { from, to, target, band, unit = "", kind = "kcal", empty = "還沒有資料" }) {
  const vals = values.filter((v) => v.v != null);
  if (!vals.length) return `<div class="chart-empty">${empty}</div>`;
  const maxV = Math.max(...vals.map((v) => v.v), target || 0, band ? band[1] : 0);
  const { hi, ticks } = niceTicks(0, maxV * 1.08);
  const total = diffDays(to, from) + 1;
  const slot = (W - PL - PR) / total;
  const x = (d) => PL + diffDays(d, from) * slot;
  const y = (v) => PT + (1 - v / (hi || 1)) * (H - PT - PB);
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="長條圖">`;
  svg += yAxis(ticks, y) + xAxis(from, addDays(to, 0), (d) => x(d) + slot / 2);
  if (band) svg += `<rect class="c-band" x="${PL}" width="${W - PL - PR}" y="${y(band[1])}" height="${Math.max(1, y(band[0]) - y(band[1]))}"/>`;
  for (const v of vals) {
    const bw = Math.max(2, slot * 0.7);
    const top = y(v.v);
    svg += `<rect class="c-bar c-bar-${kind}${v.partial ? " is-partial" : ""}" x="${x(v.date) + (slot - bw) / 2}" y="${top}" width="${bw}" height="${H - PB - top}" rx="1.5"><title>${md(v.date)}：${v.v}${unit}${v.partial ? "（部分餐點未估算）" : ""}</title></rect>`;
  }
  if (target != null) svg += `<line class="c-target" x1="${PL}" x2="${W - PR}" y1="${y(target)}" y2="${y(target)}"/>`;
  return svg + "</svg>";
}
