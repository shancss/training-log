import { Store } from "./store.js";
import { idb } from "./idb.js";
import { lineChart, barChart } from "./charts.js";
import { toCSV, toMarkdown, download, photosZip, photoList } from "./export.js";
import {
  START, WEEKS, MEALS, MEAL_LABEL, WD, EX_STATUS, EX_STATUS_LABEL, EX_TAGS, REV_TAGS, TEST_FIELDS,
  today, addDays, diffDays, weekOf, dayIdx, weekDates, weekStart, md, weekLabel, esc, num, pace, toSec, secToStr,
  normDay, dayTotals, mealTotals, mealText, itemName, hasContent, uid, textToItem,
} from "./util.js";

// ---------------------------------------------------------------- 狀態
const CFG_KEY = "tl.cfg";
const S = {
  store: null,
  view: "today",
  date: today(),
  weekN: null,
  picker: null,          // 開著常吃清單的餐別
  pickerQuery: "",
  pickSel: new Set(),    // 常吃清單裡已勾選的食物 id
  revEdit: null,         // 正在編輯的修正紀錄 id 或 "new"
  revDraft: null,
  revDel: null,
  planEdit: null,        // 正在編輯的週次
  planDraft: null,
  versions: null,        // plan.json 的 commit 清單
  versionView: null,     // { sha, date, data }
  foodDel: null,
  foodQuery: "",
  photoView: null,       // { path, owner } 燈箱
  photoDel: false,
  needRender: false,
  zipProgress: "",
};
const $view = document.getElementById("view");
const $status = document.getElementById("status");
const $toast = document.getElementById("toast");

function loadCfg() { try { return JSON.parse(localStorage.getItem(CFG_KEY) || "null"); } catch { return null; } }
function saveCfg(c) { try { localStorage.setItem(CFG_KEY, JSON.stringify(c)); } catch {} }

let toastTimer;
function toast(msg) {
  $toast.textContent = msg;
  $toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $toast.hidden = true; }, 2600);
}

// ---------------------------------------------------------------- 資料存取
const P = {
  day: (d) => `data/days/${d}.json`,
  plan: "data/plan.json", revisions: "data/revisions.json", weeks: "data/weeks.json",
  tests: "data/tests.json", foods: "data/foods.json",
};
const st = () => S.store;
function getDay(date) { return normDay(st()?.json(P.day(date)), date); }
function plan() { return st()?.json(P.plan) || { start: START, targets: { kcal: 2650, protein: 90, weight: 58 }, weeks: [] }; }
function weekPlan(n) { return plan().weeks?.find((w) => w.n === n); }
function revisions() { return st()?.json(P.revisions)?.items || []; }
function weeksDoc() { return st()?.json(P.weeks) || {}; }
function tests() { return st()?.json(P.tests) || { pre: {}, post: {} }; }
function foods() { return st()?.json(P.foods)?.items || []; }
const clone = (o) => JSON.parse(JSON.stringify(o));
const now = () => new Date().toISOString();

function editDay(date, fn) {
  const d = clone(getDay(date));
  fn(d);
  d.updatedAt = now();
  st().setJSON(P.day(date), d);
  return d;
}
function editDoc(path, fallback, fn) {
  const d = clone(st().json(path) || fallback);
  fn(d);
  d.updatedAt = now();
  st().setJSON(path, d);
  return d;
}
const editFoods = (fn) => editDoc(P.foods, { items: [] }, fn);

function setPath(obj, path, val) {
  const keys = path.split(".");
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]] ??= {};
  o[keys[keys.length - 1]] = val;
}

// ---------------------------------------------------------------- 路由
const VIEWS = ["today", "week", "stats", "log", "plan", "more", "setup"];
function route() {
  const h = location.hash.replace("#", "");
  S.view = VIEWS.includes(h) ? h : "today";
  if (!st() && S.view !== "setup") S.view = "setup";
  document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("is-on", a.dataset.nav === S.view));
  render();
  window.scrollTo(0, 0);
}
function go(view) { if (location.hash === "#" + view) route(); else location.hash = view; }

function focusedInView() {
  const a = document.activeElement;
  return a && $view.contains(a) && a.matches("input, textarea, select");
}
function safeRender() {
  if (focusedInView()) { S.needRender = true; return; }
  render();
}
$view.addEventListener("focusout", () => setTimeout(() => {
  if (S.needRender && !focusedInView()) { S.needRender = false; render(); }
}, 0));

function render() {
  const fn = { today: vToday, week: vWeek, stats: vStats, log: vLog, plan: vPlan, more: vMore, setup: vSetup }[S.view];
  $view.innerHTML = fn();
  hydratePhotos();
  renderLightbox();
}

// ---------------------------------------------------------------- 共用片段
function photoStrip(paths, owner) {
  return `<div class="photos">${paths.map((p) =>
    `<button class="thumb" data-act="photo-open" data-path="${esc(p)}" data-owner="${esc(owner)}" aria-label="查看照片"><img data-photo="${esc(p)}" alt=""></button>`).join("")}
    <label class="photo-add"><input type="file" accept="image/*,.heic,.heif" multiple data-upload="${esc(owner)}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>
      <span>照片</span></label></div>`;
}

async function hydratePhotos() {
  for (const img of $view.querySelectorAll("img[data-photo]:not([src])")) {
    const path = img.dataset.photo;
    try { img.src = await st().photoURL(path); } catch { img.closest(".thumb")?.classList.add("is-broken"); }
  }
}

function bar(label, val, target, unit, kind) {
  const pct = val != null && target ? Math.min(100, (val / target) * 100) : 0;
  const met = val != null && target && val >= target;
  return `<div class="meter meter-${kind}">
    <div class="meter-top"><span class="meter-label">${label}</span>
      <span class="meter-val"><b data-total="${kind}">${val ?? "—"}</b> / ${target ?? "—"} ${unit}</span></div>
    <div class="meter-track"><div class="meter-fill${met ? " is-met" : ""}" data-fill="${kind}" style="width:${pct}%"></div></div></div>`;
}

const statusChip = (s) => s ? `<span class="chip st-${s}">${EX_STATUS_LABEL[s] || s}</span>` : "";

// ---------------------------------------------------------------- 今日
function vToday() {
  const date = S.date;
  const d = getDay(date);
  const n = weekOf(date);
  const wp = weekPlan(n);
  const t = dayTotals(d);
  const tg = plan().targets || {};
  const isToday = date === today();
  return `
  <section class="day-head">
    <div class="date-nav">
      <button class="icon-btn" data-act="day-prev" aria-label="前一天">‹</button>
      <label class="date-pick">
        <span class="date-big">${md(date)}</span><span class="date-wd">週${WD[dayIdx(date)]}</span>
        <input type="date" id="date-pick" value="${date}" aria-label="選擇日期">
      </label>
      <button class="icon-btn" data-act="day-next" aria-label="後一天">›</button>
      ${isToday ? "" : `<button class="btn btn-ghost" data-act="day-today">回到今天</button>`}
    </div>
    <p class="week-line"><b>${weekLabel(n)}</b>${wp?.phase ? `<span>${esc(wp.phase)}</span>` : ""}</p>
  </section>

  <section class="card plan-today">
    <h2 class="card-title">今日課表</h2>
    <p>${wp ? esc(wp.days[dayIdx(date)] || "（未安排）") : "不在 8 週計畫期間"}</p>
  </section>

  <section class="card totals">
    ${bar("熱量", t.kcal, tg.kcal, "kcal", "kcal")}
    ${bar("蛋白質", t.protein, tg.protein, "g", "prot")}
  </section>

  ${MEALS.map(([k, label]) => mealCard(d, k, label)).join("")}
  ${exerciseCard(d)}

  <section class="card">
    <h2 class="card-title">體重與日記</h2>
    <div class="field-row">
      <label class="field field-sm"><span>體重（kg）</span>
        <input id="f-weight" type="number" inputmode="decimal" step="0.1" data-f="weight" data-type="num" value="${d.weight ?? ""}"></label>
    </div>
    <label class="field"><span>今天的日記（感受、遇到的狀況、想調整的地方）</span>
      <textarea id="f-diary" rows="5" data-f="diary">${esc(d.diary)}</textarea></label>
  </section>`;
}

function mealCard(d, k, label) {
  const m = d.meals[k];
  const tt = mealTotals(m);
  const open = S.picker === k;
  return `
  <article class="card meal" data-meal="${k}">
    <header class="meal-head">
      <h2 class="card-title">${label}</h2>
      <span class="meal-sum" data-sum="${k}">${sumText(tt)}</span>
    </header>
    ${m.items.length || m.text ? `<ul class="items">${m.items.map((it, i) => itemRow(k, it, i)).join("")}${!m.items.length && m.text ? legacyRow(k, m) : ""}</ul>` : ""}
    ${open ? pickerPanel(k) : `<div class="meal-actions">
      <button class="btn" data-act="picker" data-meal="${k}">＋ 常吃清單</button>
    </div>`}
    <div class="quick-add">
      <input id="qa-${k}-name" type="text" placeholder="其他食物，例如：里肌肉蛋貝果" aria-label="食物名稱">
      <input id="qa-${k}-kcal" type="number" inputmode="decimal" placeholder="kcal" aria-label="熱量">
      <input id="qa-${k}-prot" type="number" inputmode="decimal" step="0.1" placeholder="g" aria-label="蛋白質">
      <button class="btn btn-primary" data-act="quick-add" data-meal="${k}">加入</button>
      <label class="check"><input id="qa-${k}-save" type="checkbox" checked> 同時存到常吃清單</label>
    </div>
    <label class="field"><span>備註</span>
      <input id="f-${k}-note" type="text" data-f="meals.${k}.note" value="${esc(m.note)}" placeholder="例如：只吃一半、飯少"></label>
    ${m.shot && !m.photos.length ? `<p class="hint">當時有拍照（照片還沒上傳）</p>` : ""}
    ${photoStrip(m.photos, "meal:" + k)}
  </article>`;
}
const sumText = (t) => (t.kcal == null && t.protein == null) ? "" : `${t.kcal ?? "—"} kcal · ${t.protein ?? "—"} g`;

function itemRow(k, it, i) {
  return `<li class="item">
    <div class="item-name">${esc(it.name)}</div>
    <div class="item-ctrl">
      <div class="stepper" role="group" aria-label="份數">
        <button data-act="qty" data-meal="${k}" data-i="${i}" data-d="-0.5" aria-label="減少">−</button>
        <span>${it.qty || 1}</span>
        <button data-act="qty" data-meal="${k}" data-i="${i}" data-d="0.5" aria-label="增加">＋</button>
      </div>
      <label class="mini"><input id="it-${k}-${i}-k" type="number" inputmode="numeric" data-item="${k}:${i}:kcal" value="${it.kcal ?? ""}" placeholder="?"><span>kcal</span></label>
      <label class="mini"><input id="it-${k}-${i}-p" type="number" inputmode="decimal" step="0.1" data-item="${k}:${i}:protein" value="${it.protein ?? ""}" placeholder="?"><span>g</span></label>
      <button class="icon-btn sm" data-act="item-del" data-meal="${k}" data-i="${i}" aria-label="移除">×</button>
    </div></li>`;
}

// 舊資料：整餐只有一段文字＋整餐熱量
function legacyRow(k, m) {
  return `<li class="item">
    <input id="f-${k}-text" class="item-name-input" type="text" data-f="meals.${k}.text" value="${esc(m.text)}" aria-label="食物">
    <div class="item-ctrl">
      <label class="mini"><input id="f-${k}-kcal" type="number" inputmode="decimal" data-f="meals.${k}.kcal" data-type="num" value="${m.kcal ?? ""}" placeholder="?"><span>kcal</span></label>
      <label class="mini"><input id="f-${k}-prot" type="number" inputmode="decimal" step="0.1" data-f="meals.${k}.protein" data-type="num" value="${m.protein ?? ""}" placeholder="?"><span>g</span></label>
    </div></li>`;
}

function pickerPanel(k) {
  const n = S.pickSel.size;
  return `<div class="picker">
    <div class="picker-top">
      <input id="pq-${k}" class="picker-q" type="search" data-pq="${k}" value="${esc(S.pickerQuery)}" placeholder="搜尋常吃食物">
      <button class="btn btn-ghost" data-act="picker" data-meal="${k}">關閉</button>
    </div>
    <p class="hint">點選要加入的食物，可以一次選很多樣。</p>
    <div class="picker-list" id="pl-${k}">${pickerList(k)}</div>
    <button class="btn btn-primary" id="pick-go-${k}" data-act="add-selected" data-meal="${k}" ${n ? "" : "disabled"}>${n ? `加入 ${n} 樣` : "加入"}</button>
  </div>`;
}
function pickerList(k) {
  const q = S.pickerQuery.trim().toLowerCase();
  const list = foods().filter((f) => !q || f.name.toLowerCase().includes(q))
    .sort((a, b) => (b.uses || 0) - (a.uses || 0) || a.name.localeCompare(b.name, "zh-Hant"));
  if (!foods().length) return `<p class="hint">清單還是空的。用下面的「其他食物」加入時，勾選「同時存到常吃清單」，下次就能直接點選。</p>`;
  if (!list.length) return `<p class="hint">找不到「${esc(S.pickerQuery)}」，可以用下面的「其他食物」加入。</p>`;
  return list.map((f) => {
    const on = S.pickSel.has(f.id);
    return `<button class="food${on ? " is-on" : ""}" data-act="toggle-food" data-meal="${k}" data-id="${esc(f.id)}" aria-pressed="${on}">
    <span class="food-name">${esc(f.name)}</span>
    <span class="food-num">${f.kcal ?? "?"} kcal · ${f.protein ?? "?"} g</span></button>`;
  }).join("");
}

function exerciseCard(d) {
  const e = d.exercise;
  const p = pace(e.km, e.time);
  return `
  <article class="card exercise">
    <h2 class="card-title">運動</h2>
    <div class="seg" role="group" aria-label="執行狀態">
      ${EX_STATUS.map(([v, l]) => `<button class="seg-btn st-${v}${e.status === v ? " is-on" : ""}" data-act="ex-status" data-v="${v}">${l}</button>`).join("")}
    </div>
    <div class="tags">
      ${EX_TAGS.map((t) => `<button class="tag${e.tags.includes(t) ? " is-on" : ""}" data-act="ex-tag" data-v="${t}">${t}</button>`).join("")}
    </div>
    <label class="field"><span>內容（組數×次數、路線、練舞內容）</span>
      <textarea id="f-ex-detail" rows="3" data-f="exercise.detail" placeholder="例如：爆發高拉 4×3、正手引體 7,7,6,6,6、Dip 3×10">${esc(e.detail)}</textarea></label>
    <div class="field-row">
      <label class="field field-sm"><span>距離（km）</span><input id="f-ex-km" type="number" inputmode="decimal" step="0.01" data-f="exercise.km" data-type="num" value="${e.km ?? ""}"></label>
      <label class="field field-sm"><span>時間（分:秒）</span><input id="f-ex-time" type="text" inputmode="numeric" data-f="exercise.time" value="${esc(e.time)}" placeholder="25:30"></label>
      <div class="field field-sm"><span>配速</span><output class="pace" data-pace>${p || "—"}</output></div>
    </div>
    <div class="field-row">
      <label class="field field-sm"><span>總時長（分鐘）</span><input id="f-ex-min" type="number" inputmode="numeric" data-f="exercise.minutes" data-type="num" value="${e.minutes ?? ""}"></label>
      <label class="field field-sm"><span>RPE（1–10）</span>
        <select id="f-ex-rpe" data-f="exercise.rpe" data-type="num"><option value="">—</option>
          ${Array.from({ length: 10 }, (_, i) => `<option${e.rpe === i + 1 ? " selected" : ""}>${i + 1}</option>`).join("")}</select></label>
    </div>
    <label class="field"><span>和計畫的差異（為什麼調整？）</span>
      <textarea id="f-ex-dev" rows="2" data-f="exercise.deviation" placeholder="例如：週五晚上練舞，肌力 C 順延到週日">${esc(e.deviation)}</textarea></label>
    ${e.shot && !e.photos.length ? `<p class="hint">當時有拍照（照片還沒上傳）</p>` : ""}
    ${photoStrip(e.photos, "exercise")}
  </article>`;
}

function refreshDaySums() {
  const d = getDay(S.date);
  for (const [k] of MEALS) {
    const el = $view.querySelector(`[data-sum="${k}"]`);
    if (el) el.textContent = sumText(mealTotals(d.meals[k]));
  }
  const t = dayTotals(d), tg = plan().targets || {};
  for (const [kind, v, target] of [["kcal", t.kcal, tg.kcal], ["prot", t.protein, tg.protein]]) {
    const b = $view.querySelector(`[data-total="${kind}"]`);
    if (b) b.textContent = v ?? "—";
    const f = $view.querySelector(`[data-fill="${kind}"]`);
    if (f) { f.style.width = `${v != null && target ? Math.min(100, (v / target) * 100) : 0}%`; f.classList.toggle("is-met", v != null && target && v >= target); }
  }
  const pc = $view.querySelector("[data-pace]");
  if (pc) pc.textContent = pace(d.exercise.km, d.exercise.time) || "—";
}

// ---------------------------------------------------------------- 週表
function vWeek() {
  const n = S.weekN ?? Math.min(WEEKS, Math.max(1, weekOf(S.date)));
  S.weekN = n;
  const dates = weekDates(n);
  const days = dates.map(getDay);
  const wp = weekPlan(n);
  const tg = plan().targets || {};
  const rows = [
    ...MEALS.map(([k, l]) => [l, (d) => {
      const m = d.meals[k], tt = mealTotals(m), txt = mealText(m);
      return txt || m.photos.length ? `<span class="cell-text">${esc(txt) || "（照片）"}</span>${tt.kcal != null ? `<span class="cell-num">${tt.kcal} kcal</span>` : ""}${m.photos.length ? `<span class="cell-photo">照片 ${m.photos.length}</span>` : ""}` : "";
    }]),
    ["運動", (d) => `${statusChip(d.exercise.status)}<span class="cell-text">${esc([d.exercise.tags.join("/"), d.exercise.detail].filter(Boolean).join(" "))}</span>${d.exercise.km ? `<span class="cell-num">${d.exercise.km} km ${pace(d.exercise.km, d.exercise.time)}</span>` : ""}`],
    ["熱量", (d) => { const v = dayTotals(d).kcal; return v != null ? `<b class="${tg.kcal && v >= tg.kcal ? "ok" : ""}">${v}</b>` : ""; }],
    ["蛋白質", (d) => { const v = dayTotals(d).protein; return v != null ? `<b class="${tg.protein && v >= tg.protein ? "ok" : ""}">${v} g</b>` : ""; }],
    ["體重", (d) => d.weight != null ? `${d.weight}` : ""],
  ];
  const s = weekSummary(n);
  const refl = weeksDoc()[n]?.reflection || "";
  return `
  <section class="week-head">
    <button class="icon-btn" data-act="week-prev" aria-label="上一週" ${n <= 1 ? "disabled" : ""}>‹</button>
    <div><h1 class="week-title">第 ${n} 週 <small>${md(dates[0])}–${md(dates[6])}</small></h1>
      ${wp?.phase ? `<p class="week-phase">${esc(wp.phase)}</p>` : ""}</div>
    <button class="icon-btn" data-act="week-next" aria-label="下一週" ${n >= WEEKS ? "disabled" : ""}>›</button>
  </section>

  <div class="table-wrap"><table class="grid">
    <thead><tr><th></th>${dates.map((d) => `<th class="${d === today() ? "is-today" : ""}">週${WD[dayIdx(d)]}<small>${md(d)}</small></th>`).join("")}</tr></thead>
    <tbody>${rows.map(([label, fn]) => `<tr><th>${label}</th>${days.map((d) => `<td data-act="goto" data-date="${d.date}">${fn(d)}</td>`).join("")}</tr>`).join("")}</tbody>
  </table></div>
  <p class="hint">點任一格可以打開那一天編輯。</p>

  <section class="stat-row">
    ${statTile("運動完成", `${s.done}<small> / 7 天</small>`)}
    ${statTile("單槓", `${s.bar}<small> 次</small>`)}
    ${statTile("跑步", `${s.runKm}<small> km</small>`)}
    ${statTile("平均熱量", `${s.kcal ?? "—"}<small> kcal</small>`)}
    ${statTile("平均蛋白質", `${s.prot ?? "—"}<small> g</small>`)}
    ${statTile("照片", `${s.photos}<small> 張</small>`)}
  </section>

  ${wp ? `<details class="card"><summary class="card-title">本週計畫課表</summary>
    <ol class="plan-days">${wp.days.map((t, i) => `<li><b>週${WD[i]}</b>${esc(t)}</li>`).join("")}</ol></details>` : ""}

  <section class="card">
    <h2 class="card-title">本週檢討</h2>
    <label class="field"><span>執行率、和計畫的差異、原因、對照五大原則，以及下週要怎麼調整</span>
      <textarea id="f-refl" rows="7" data-wf="${n}">${esc(refl)}</textarea></label>
  </section>`;
}
const statTile = (label, val) => `<div class="stat"><span class="stat-label">${label}</span><span class="stat-val">${val}</span></div>`;

function weekSummary(n) {
  const days = weekDates(n).map(getDay);
  let done = 0, bar = 0, runKm = 0, bike = 0, dance = 0, photos = 0, ks = [], ps = [], ws = [];
  for (const d of days) {
    const e = d.exercise;
    if (["done", "partial", "changed"].includes(e.status)) done++;
    if (e.tags.includes("單槓")) bar++;
    if (e.tags.includes("跑步") && e.km) runKm += e.km;
    if (e.tags.includes("單車")) bike += e.minutes || 0;
    if (e.tags.includes("練舞")) dance++;
    photos += MEALS.reduce((a, [k]) => a + d.meals[k].photos.length, 0) + e.photos.length;
    const t = dayTotals(d);
    if (t.kcal != null) ks.push(t.kcal);
    if (t.protein != null) ps.push(t.protein);
    if (d.weight != null) ws.push(d.weight);
  }
  const avg = (a, dp = 0) => a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10 ** dp) / 10 ** dp : null;
  return { done, bar, runKm: Math.round(runKm * 100) / 100, bike, dance, photos, kcal: avg(ks), prot: avg(ps, 1), weight: avg(ws, 1) };
}

// ---------------------------------------------------------------- 趨勢
function vStats() {
  const end = addDays(weekStart(WEEKS), 6);
  const all = st().paths("data/days/").map((p) => p.slice(10, 20)).sort();
  const first = all[0] && all[0] < START ? all[0] : addDays(START, -14);
  const tg = plan().targets || {};
  const wPts = all.map(getDay).filter((d) => d.weight != null).map((d) => ({ date: d.date, y: d.weight }));
  const range = Array.from({ length: diffDays(end, START) + 1 }, (_, i) => addDays(START, i));
  const kc = range.map((date) => { const d = getDay(date); const t = dayTotals(d); return { date, v: t.kcal, partial: t.filled > t.estimated }; });
  const pr = range.map((date) => { const d = getDay(date); const t = dayTotals(d); return { date, v: t.protein, partial: t.filled > t.estimated }; });
  const runs = all.map(getDay).filter((d) => d.exercise.km && (d.exercise.tags.includes("跑步") || /跑/.test(d.exercise.detail)));
  return `
  <h1 class="page-title">趨勢</h1>
  <section class="card"><h2 class="card-title">體重（kg）</h2>
    ${lineChart(wPts, { from: first, to: end, target: tg.weight, targetLabel: `目標 ${tg.weight} kg`, unit: " kg", empty: "在「今日」填體重後，這裡會畫出變化。" })}</section>
  <section class="card"><h2 class="card-title">每日熱量（kcal）</h2>
    ${barChart(kc, { from: START, to: end, target: tg.kcal, unit: " kcal", kind: "kcal", empty: "填了餐點熱量後會出現。" })}
    <p class="legend"><i class="lg lg-kcal"></i>熱量 <i class="lg lg-partial"></i>當天有餐點沒填熱量 <i class="lg lg-target"></i>目標 ${tg.kcal ?? "—"} kcal</p></section>
  <section class="card"><h2 class="card-title">每日蛋白質（g）</h2>
    ${barChart(pr, { from: START, to: end, target: tg.protein, unit: " g", kind: "prot", empty: "填了餐點蛋白質後會出現。" })}
    <p class="legend"><i class="lg lg-prot"></i>蛋白質 <i class="lg lg-target"></i>目標 ${tg.protein ?? "—"} g</p></section>

  <section class="card"><h2 class="card-title">每週統計</h2>
    <div class="table-wrap"><table class="data">
      <thead><tr><th>週次</th><th>運動天數</th><th>單槓</th><th>跑步 km</th><th>單車 分</th><th>練舞</th><th>平均熱量</th><th>平均蛋白質</th><th>平均體重</th></tr></thead>
      <tbody>${Array.from({ length: WEEKS }, (_, i) => { const s = weekSummary(i + 1); return `<tr><th>第 ${i + 1} 週</th><td>${s.done}</td><td>${s.bar}</td><td>${s.runKm || ""}</td><td>${s.bike || ""}</td><td>${s.dance}</td><td>${s.kcal ?? ""}</td><td>${s.prot ?? ""}</td><td>${s.weight ?? ""}</td></tr>`; }).join("")}</tbody>
    </table></div></section>

  <section class="card"><h2 class="card-title">跑步紀錄 <small>目標 5 km、5:30/km</small></h2>
    ${runs.length ? `<div class="table-wrap"><table class="data">
      <thead><tr><th>日期</th><th>距離</th><th>時間</th><th>配速</th><th>內容</th></tr></thead>
      <tbody>${runs.map((d) => { const e = d.exercise; const s = toSec(e.time); const fast = s && e.km && s / e.km <= 330; return `<tr><th>${md(d.date)}</th><td>${e.km} km</td><td>${esc(e.time)}</td><td class="${fast ? "ok" : ""}">${pace(e.km, e.time)}</td><td>${esc(e.detail)}</td></tr>`; }).join("")}</tbody>
    </table></div>` : `<p class="hint">跑步時填入距離和時間，這裡會列出配速變化。</p>`}</section>`;
}

// ---------------------------------------------------------------- 修正歷程
function vLog() {
  const items = revisions().slice().sort((a, b) => a.date.localeCompare(b.date));
  return `
  <div class="page-head"><h1 class="page-title">修正歷程</h1>
    ${S.revEdit ? "" : `<button class="btn btn-primary" data-act="rev-new">＋ 新增修正</button>`}</div>
  <p class="lead">每次因為課堂內容或遇到狀況而調整計畫，就記一筆：遇到什麼、為什麼、怎麼改、依據哪一頁講義或原則，之後再補上修正後的成效。</p>
  ${S.revEdit === "new" ? revForm() : ""}
  ${items.length ? `<ol class="timeline">${items.map((r) => S.revEdit === r.id ? `<li>${revForm()}</li>` : revItem(r)).join("")}</ol>`
    : `<p class="hint">還沒有修正紀錄。</p>`}`;
}
function revItem(r) {
  const del = S.revDel === r.id;
  return `<li class="tl-item">
    <div class="tl-date"><b>${md(r.date)}</b><span>${weekLabel(weekOf(r.date))}</span></div>
    <article class="card tl-card">
      <h2 class="tl-title">${esc(r.title || "（未命名）")}</h2>
      ${r.tags?.length ? `<div class="tags">${r.tags.map((t) => `<span class="tag is-static">${esc(t)}</span>`).join("")}</div>` : ""}
      <dl class="rev">
        ${r.problem ? `<dt>遇到的狀況</dt><dd>${esc(r.problem)}</dd>` : ""}
        ${r.cause ? `<dt>原因分析</dt><dd>${esc(r.cause)}</dd>` : ""}
        ${r.change ? `<dt>修正內容</dt><dd>${esc(r.change)}</dd>` : ""}
        ${r.basis ? `<dt>依據</dt><dd>${esc(r.basis)}</dd>` : ""}
        <dt>修正後成效</dt><dd>${r.outcome ? esc(r.outcome) : `<span class="muted">還沒填，執行一段時間後回來補。</span>`}</dd>
      </dl>
      <div class="card-actions">
        <button class="btn btn-ghost" data-act="rev-edit" data-id="${esc(r.id)}">編輯</button>
        ${del ? `<span class="confirm">確定刪除？<button class="btn btn-danger" data-act="rev-del-yes" data-id="${esc(r.id)}">刪除</button><button class="btn btn-ghost" data-act="rev-del-no">取消</button></span>`
          : `<button class="btn btn-ghost" data-act="rev-del" data-id="${esc(r.id)}">刪除</button>`}
      </div>
    </article></li>`;
}
function revForm() {
  const r = S.revDraft;
  const f = (key, label, rows, ph = "") => `<label class="field"><span>${label}</span>${rows
    ? `<textarea id="rf-${key}" rows="${rows}" data-rf="${key}" placeholder="${ph}">${esc(r[key])}</textarea>`
    : `<input id="rf-${key}" type="text" data-rf="${key}" value="${esc(r[key])}" placeholder="${ph}">`}</label>`;
  return `<section class="card rev-form">
    <h2 class="card-title">${S.revEdit === "new" ? "新增修正紀錄" : "編輯修正紀錄"}</h2>
    <div class="field-row">
      <label class="field field-sm"><span>日期</span><input id="rf-date" type="date" data-rf="date" value="${esc(r.date)}"></label>
      ${f("title", "標題", 0, "例如：週五練舞衝到單槓")}
    </div>
    ${f("problem", "遇到的狀況", 2)}
    ${f("cause", "原因分析", 2)}
    ${f("change", "修正內容", 3)}
    ${f("basis", "依據（講義頁碼、運動處方原則）", 2, "例如：講義 P.9 可逆性原則")}
    <div class="field"><span>標籤</span><div class="tags">${REV_TAGS.map((t) => `<button class="tag${r.tags.includes(t) ? " is-on" : ""}" data-act="rev-tag" data-v="${t}">${t}</button>`).join("")}</div></div>
    ${f("outcome", "修正後成效（之後再補也可以）", 2)}
    <div class="card-actions"><button class="btn btn-primary" data-act="rev-save">儲存</button><button class="btn btn-ghost" data-act="rev-cancel">取消</button></div>
  </section>`;
}

// ---------------------------------------------------------------- 計畫
function vPlan() {
  const pl = plan();
  const tg = pl.targets || {};
  const t = tests();
  return `
  <h1 class="page-title">計畫</h1>
  <section class="card">
    <h2 class="card-title">每日目標</h2>
    <div class="field-row">
      <label class="field field-sm"><span>熱量（kcal）</span><input id="pt-kcal" type="number" inputmode="numeric" data-pt="kcal" value="${tg.kcal ?? ""}"></label>
      <label class="field field-sm"><span>蛋白質（g）</span><input id="pt-prot" type="number" inputmode="decimal" data-pt="protein" value="${tg.protein ?? ""}"></label>
      <label class="field field-sm"><span>目標體重（kg）</span><input id="pt-weight" type="number" inputmode="decimal" step="0.1" data-pt="weight" value="${tg.weight ?? ""}"></label>
    </div>
  </section>

  <h2 class="section-title">8 週課表</h2>
  ${(pl.weeks || []).map((w) => S.planEdit === w.n ? planEditCard() : planCard(w)).join("")}

  <section class="card">
    <h2 class="card-title">計畫版本紀錄</h2>
    <p class="lead">每次儲存課表都會留下一個版本。打開舊版本可以和現在的課表對照，看出計畫一路怎麼調整。</p>
    ${S.versions ? versionList() : `<button class="btn" data-act="ver-load">載入版本紀錄</button>`}
    ${S.versionView ? versionDiff() : ""}
  </section>

  <section class="card">
    <h2 class="card-title">前測與後測</h2>
    <div class="table-wrap"><table class="data tests">
      <thead><tr><th>項目</th><th>前測</th><th>後測</th></tr></thead>
      <tbody>${TEST_FIELDS.map(([k, l, u]) => `<tr><th>${l}${u ? `<small>${u}</small>` : ""}</th>
        <td><input id="tf-pre-${k}" type="text" data-tf="pre.${k}" value="${esc(t.pre?.[k] ?? "")}" aria-label="${l} 前測"></td>
        <td><input id="tf-post-${k}" type="text" data-tf="post.${k}" value="${esc(t.post?.[k] ?? "")}" aria-label="${l} 後測"></td></tr>`).join("")}</tbody>
    </table></div>
  </section>`;
}
function planCard(w) {
  const dates = weekDates(w.n);
  const cur = weekOf(today()) === w.n;
  return `<details class="card plan-week${cur ? " is-current" : ""}" ${cur ? "open" : ""}>
    <summary><span class="pw-n">第 ${w.n} 週</span><span class="pw-d">${md(dates[0])}–${md(dates[6])}</span><span class="pw-phase">${esc(w.phase)}</span></summary>
    <ol class="plan-days">${w.days.map((t, i) => `<li><b>週${WD[i]}</b>${esc(t)}</li>`).join("")}</ol>
    <div class="card-actions"><button class="btn btn-ghost" data-act="plan-edit" data-n="${w.n}">編輯這週</button></div>
  </details>`;
}
function planEditCard() {
  const w = S.planDraft;
  return `<section class="card plan-week is-editing">
    <h3 class="card-title">編輯第 ${w.n} 週</h3>
    <label class="field"><span>階段與目標</span><input id="pd-phase" type="text" data-pd="phase" value="${esc(w.phase)}"></label>
    ${w.days.map((t, i) => `<label class="field"><span>週${WD[i]}</span><textarea id="pd-${i}" rows="2" data-pd="${i}">${esc(t)}</textarea></label>`).join("")}
    <div class="card-actions">
      <button class="btn btn-primary" data-act="plan-save">儲存</button>
      <button class="btn btn-ghost" data-act="plan-cancel">取消</button>
    </div>
  </section>`;
}
function versionList() {
  if (!S.versions.length) return `<p class="hint">還沒有版本紀錄。</p>`;
  return `<ul class="versions">${S.versions.map((v) => {
    const d = new Date(v.date);
    const label = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    return `<li><button class="btn btn-ghost${S.versionView?.sha === v.sha ? " btn-on" : ""}" data-act="ver-open" data-sha="${v.sha}">${label}</button></li>`;
  }).join("")}</ul>`;
}
function versionDiff() {
  const old = S.versionView.data, cur = plan();
  const out = [];
  for (const w of cur.weeks || []) {
    const ow = old.weeks?.find((x) => x.n === w.n);
    if (!ow) { out.push(`<li><b>第 ${w.n} 週</b>：舊版本沒有這週</li>`); continue; }
    if (ow.phase !== w.phase) out.push(`<li><b>第 ${w.n} 週 階段</b><div class="diff"><del>${esc(ow.phase)}</del><ins>${esc(w.phase)}</ins></div></li>`);
    w.days.forEach((t, i) => {
      if ((ow.days?.[i] || "") !== t) out.push(`<li><b>第 ${w.n} 週 週${WD[i]}</b><div class="diff"><del>${esc(ow.days?.[i] || "（空白）")}</del><ins>${esc(t)}</ins></div></li>`);
    });
  }
  const ot = old.targets || {}, ct = cur.targets || {};
  for (const [k, l] of [["kcal", "熱量目標"], ["protein", "蛋白質目標"], ["weight", "目標體重"]]) {
    if (ot[k] !== ct[k]) out.push(`<li><b>${l}</b><div class="diff"><del>${ot[k] ?? "—"}</del><ins>${ct[k] ?? "—"}</ins></div></li>`);
  }
  return `<div class="ver-diff"><h3>這個版本和現在的差異</h3>${out.length ? `<ul>${out.join("")}</ul>` : `<p class="hint">內容和現在相同（這個版本改的是其他欄位）。</p>`}
    <p class="legend"><del>舊</del> → <ins>現在</ins></p></div>`;
}

// ---------------------------------------------------------------- 更多（常吃清單、匯出）
function vMore() {
  const q = S.foodQuery.trim().toLowerCase();
  const list = foods().filter((f) => !q || f.name.toLowerCase().includes(q))
    .sort((a, b) => (b.uses || 0) - (a.uses || 0) || a.name.localeCompare(b.name, "zh-Hant"));
  return `
  <h1 class="page-title">更多</h1>
  <section class="card">
    <h2 class="card-title">常吃食物清單</h2>
    <p class="lead">熱量和蛋白質填一次就好，記錄餐點時從「＋ 常吃清單」點選即可。數字填每一份的量。</p>
    <div class="food-add">
      <input id="fa-name" type="text" placeholder="名稱，例如：茶葉蛋" aria-label="名稱">
      <input id="fa-kcal" type="number" inputmode="numeric" placeholder="kcal" aria-label="熱量">
      <input id="fa-prot" type="number" inputmode="decimal" step="0.1" placeholder="蛋白質 g" aria-label="蛋白質">
      <button class="btn btn-primary" data-act="food-add">新增</button>
    </div>
    ${foods().length > 6 ? `<input id="fq" class="picker-q" type="search" data-fq value="${esc(S.foodQuery)}" placeholder="搜尋">` : ""}
    ${list.length ? `<ul class="food-list">${list.map((f) => `<li>
      <input id="fe-${esc(f.id)}-name" type="text" data-food="${esc(f.id)}:name" value="${esc(f.name)}" aria-label="名稱">
      <label class="mini"><input id="fe-${esc(f.id)}-k" type="number" inputmode="numeric" data-food="${esc(f.id)}:kcal" value="${f.kcal ?? ""}"><span>kcal</span></label>
      <label class="mini"><input id="fe-${esc(f.id)}-p" type="number" inputmode="decimal" step="0.1" data-food="${esc(f.id)}:protein" value="${f.protein ?? ""}"><span>g</span></label>
      <span class="uses">用過 ${f.uses || 0} 次</span>
      ${S.foodDel === f.id ? `<span class="confirm"><button class="btn btn-danger" data-act="food-del-yes" data-id="${esc(f.id)}">刪除</button><button class="btn btn-ghost" data-act="food-del-no">取消</button></span>`
        : `<button class="icon-btn sm" data-act="food-del" data-id="${esc(f.id)}" aria-label="刪除">×</button>`}
    </li>`).join("")}</ul>` : `<p class="hint">${foods().length ? "找不到符合的食物。" : "還沒有任何食物，在上面新增第一樣。"}</p>`}
  </section>

  <section class="card">
    <h2 class="card-title">匯出（做報告用）</h2>
    <div class="export-list">
      <button class="export" data-act="exp-md"><b>報告草稿（Markdown）</b><span>前後測、修正歷程、每週課表＋紀錄表＋日記＋檢討，可以貼到 Word 或 Notion。</span></button>
      <button class="export" data-act="exp-csv"><b>每日紀錄（CSV）</b><span>用 Excel 或 Google 試算表打開，自己做圖表。</span></button>
      <button class="export" data-act="exp-zip"><b>所有照片（zip）</b><span>${S.zipProgress || "檔名是「日期_餐別_編號.jpg」，方便放進報告。"}</span></button>
      <button class="export" data-act="exp-json"><b>完整備份（JSON）</b><span>所有資料一個檔案。</span></button>
    </div>
  </section>

  <section class="card">
    <h2 class="card-title">同步</h2>
    <p class="lead">資料存在 GitHub 私人 repo <b>${esc(st().owner)}/${esc(st().repo)}</b>。手機和電腦開同一個網址，資料會自動同步。</p>
    <div class="card-actions"><button class="btn" data-act="sync">立即同步</button><a class="btn btn-ghost" href="#setup">設定</a></div>
  </section>`;
}

// ---------------------------------------------------------------- 設定
function vSetup() {
  const c = loadCfg() || {};
  return `
  <h1 class="page-title">連接 GitHub</h1>
  <section class="card">
    <p class="lead">資料會存在你自己的 GitHub 私人 repo。每台裝置第一次使用時，輸入一次就好；token 只存在這台裝置的瀏覽器裡。</p>
    <label class="field"><span>GitHub 帳號</span><input id="cfg-owner" type="text" autocomplete="username" autocapitalize="off" value="${esc(c.owner || "")}"></label>
    <label class="field"><span>資料 repo 名稱</span><input id="cfg-repo" type="text" autocapitalize="off" value="${esc(c.repo || "training-log-data")}"></label>
    <label class="field"><span>Fine-grained token（只開放這個 repo 的 Contents 讀寫）</span><input id="cfg-token" type="password" autocomplete="off" value="${esc(c.token || "")}"></label>
    <div class="card-actions"><button class="btn btn-primary" data-act="cfg-save">連接</button></div>
  </section>
  <details class="card"><summary class="card-title">怎麼建立 token？</summary>
    <ol class="steps">
      <li>GitHub 右上角頭像 → Settings → Developer settings → Personal access tokens → <b>Fine-grained tokens</b> → Generate new token。</li>
      <li>Expiration 選到 2027 年初（超過期末報告）。</li>
      <li>Repository access 選 <b>Only select repositories</b>，只勾 <b>training-log-data</b>。</li>
      <li>Permissions → Repository permissions → <b>Contents</b> 改成 <b>Read and write</b>。</li>
      <li>產生後複製 token 貼到上面。</li>
    </ol></details>
  ${st() ? `<section class="card">
    <h2 class="card-title">這台裝置</h2>
    <p class="lead">清除會刪掉這台裝置上的 token 和快取，GitHub 上的資料不受影響。還沒上傳的修改會遺失。</p>
    ${S.clearAsk ? `<span class="confirm">確定清除？<button class="btn btn-danger" data-act="cfg-clear-yes">清除</button><button class="btn btn-ghost" data-act="cfg-clear-no">取消</button></span>`
      : `<button class="btn btn-ghost" data-act="cfg-clear">清除這台裝置的資料</button>`}
  </section>` : ""}`;
}

// ---------------------------------------------------------------- 燈箱
function renderLightbox() {
  const lb = document.getElementById("lightbox");
  if (!S.photoView) { lb.hidden = true; lb.innerHTML = ""; return; }
  lb.hidden = false;
  lb.innerHTML = `<div class="lb-inner">
    <img id="lb-img" alt="">
    <div class="lb-actions">
      ${S.photoDel ? `<span class="confirm">刪除這張照片？<button class="btn btn-danger" data-act="photo-del-yes">刪除</button><button class="btn" data-act="photo-del-no">取消</button></span>`
        : `<button class="btn" data-act="photo-del">刪除</button><button class="btn btn-primary" data-act="photo-close">關閉</button>`}
    </div></div>`;
  st().photoURL(S.photoView.path).then((u) => { const i = document.getElementById("lb-img"); if (i) i.src = u; }).catch(() => {});
}

// ---------------------------------------------------------------- 照片上傳
// HEIC／HEIF（iPhone、部分 Android 相機）：瀏覽器多半無法直接讀，先用 heic2any 轉成 JPEG
const isHeic = (f) => /image\/hei[cf]/i.test(f.type) || /\.hei[cf]$/i.test(f.name || "");
let heicLib = null;
function loadHeic() {
  if (window.heic2any) return Promise.resolve(window.heic2any);
  heicLib ||= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js";
    s.onload = () => resolve(window.heic2any);
    s.onerror = () => { heicLib = null; reject(new Error("無法載入 HEIC 轉檔工具，請確認網路")); };
    document.head.appendChild(s);
  });
  return heicLib;
}
async function decodeHeic(file) {
  // 有些瀏覽器（Safari）本身就能讀 HEIC，先試原生
  try { const b = await createImageBitmap(file); b.close?.(); return file; } catch {}
  const heic2any = await loadHeic();
  const out = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
  return Array.isArray(out) ? out[0] : out;
}

async function compress(file) {
  if (isHeic(file)) {
    toast("HEIC 照片轉檔中…");
    try { file = await decodeHeic(file); } catch (e) { throw new Error(e.message || "這張 HEIC 照片無法轉檔"); }
  }
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const max = 1600;
    const r = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * r);
    c.height = Math.round(bmp.height * r);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.82));
    return blob || file;
  } catch {
    if (/image\/(jpeg|png|webp)/.test(file.type)) return file;
    throw new Error("這個照片格式無法讀取，請改用 JPG 或 PNG。");
  }
}
async function uploadPhotos(owner, files) {
  const date = S.date;
  const key = owner.startsWith("meal:") ? owner.slice(5) : "exercise";
  const paths = [];
  for (const [i, f] of [...files].entries()) {
    try {
      const blob = await compress(f);
      const path = `photos/${date}/${key}-${Date.now()}-${i}.jpg`;
      await st().addPhoto(path, blob);
      paths.push(path);
    } catch (e) { toast(e.message); }
  }
  if (!paths.length) return;
  editDay(date, (d) => {
    const arr = key === "exercise" ? d.exercise.photos : d.meals[key].photos;
    arr.push(...paths);
  });
  toast(`已加入 ${paths.length} 張照片`);
  render();
}
function photoArray(d, owner) { return owner === "exercise" ? d.exercise.photos : d.meals[owner.slice(5)].photos; }

// ---------------------------------------------------------------- 事件：點擊
$view.addEventListener("click", onClick);
document.getElementById("lightbox").addEventListener("click", (e) => {
  if (e.target.id === "lightbox") { S.photoView = null; S.photoDel = false; renderLightbox(); return; }
  onClick(e);
});

function onClick(e) {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const a = el.dataset.act;
  const ds = el.dataset;
  const H = {
    "day-prev": () => { S.date = addDays(S.date, -1); S.picker = null; render(); },
    "day-next": () => { S.date = addDays(S.date, 1); S.picker = null; render(); },
    "day-today": () => { S.date = today(); render(); },
    picker: () => { S.picker = S.picker === ds.meal ? null : ds.meal; S.pickerQuery = ""; S.pickSel = new Set(); render(); },
    "toggle-food": () => {
      S.pickSel.has(ds.id) ? S.pickSel.delete(ds.id) : S.pickSel.add(ds.id);
      el.classList.toggle("is-on", S.pickSel.has(ds.id));
      el.setAttribute("aria-pressed", S.pickSel.has(ds.id));
      const go = document.getElementById("pick-go-" + ds.meal);
      if (go) { const n = S.pickSel.size; go.disabled = !n; go.textContent = n ? `加入 ${n} 樣` : "加入"; }
    },
    "add-selected": () => {
      const picked = foods().filter((f) => S.pickSel.has(f.id));
      if (!picked.length) return;
      editDay(S.date, (d) => {
        const m = d.meals[ds.meal];
        textToItem(m);
        for (const f of picked) {
          const same = m.items.find((it) => it.foodId === f.id);
          if (same) same.qty = (same.qty || 1) + 1;
          else m.items.push({ foodId: f.id, name: f.name, kcal: f.kcal, protein: f.protein, qty: 1 });
        }
      });
      editFoods((doc) => { for (const x of doc.items) if (S.pickSel.has(x.id)) x.uses = (x.uses || 0) + 1; });
      toast(`已加入 ${picked.map((f) => f.name).join("、")}`);
      S.picker = null; S.pickSel = new Set();
      render();
    },
    "quick-add": () => {
      const k = ds.meal;
      const name = document.getElementById(`qa-${k}-name`).value.trim();
      if (!name) { toast("請輸入食物名稱"); document.getElementById(`qa-${k}-name`).focus(); return; }
      const kcal = num(document.getElementById(`qa-${k}-kcal`).value);
      const protein = num(document.getElementById(`qa-${k}-prot`).value);
      const save = document.getElementById(`qa-${k}-save`).checked;
      let foodId = null;
      if (save) {
        const existing = foods().find((f) => f.name === name);
        foodId = existing?.id || "f" + uid();
        editFoods((doc) => {
          const x = doc.items.find((i) => i.id === foodId);
          if (x) { x.kcal = kcal ?? x.kcal; x.protein = protein ?? x.protein; x.uses = (x.uses || 0) + 1; }
          else doc.items.push({ id: foodId, name, kcal, protein, uses: 1 });
        });
      }
      editDay(S.date, (d) => { textToItem(d.meals[k]); d.meals[k].items.push({ foodId, name, kcal, protein, qty: 1 }); });
      toast(save ? `已加入 ${name}，也存到常吃清單` : `已加入 ${name}`);
      render();
    },
    qty: () => editDay(S.date, (d) => {
      const it = d.meals[ds.meal].items[+ds.i];
      it.qty = Math.max(0.5, Math.round(((it.qty || 1) + Number(ds.d)) * 2) / 2);
    }) && render(),
    "item-del": () => { editDay(S.date, (d) => d.meals[ds.meal].items.splice(+ds.i, 1)); render(); },
    "ex-status": () => { editDay(S.date, (d) => { d.exercise.status = d.exercise.status === ds.v ? "" : ds.v; }); render(); },
    "ex-tag": () => { editDay(S.date, (d) => { const t = d.exercise.tags; const i = t.indexOf(ds.v); i >= 0 ? t.splice(i, 1) : t.push(ds.v); }); render(); },
    "photo-open": () => { S.photoView = { path: ds.path, owner: ds.owner }; S.photoDel = false; renderLightbox(); },
    "photo-close": () => { S.photoView = null; renderLightbox(); },
    "photo-del": () => { S.photoDel = true; renderLightbox(); },
    "photo-del-no": () => { S.photoDel = false; renderLightbox(); },
    "photo-del-yes": () => {
      const { path, owner } = S.photoView;
      editDay(S.date, (d) => { const arr = photoArray(d, owner); const i = arr.indexOf(path); if (i >= 0) arr.splice(i, 1); });
      st().deleteFile(path);
      S.photoView = null; S.photoDel = false;
      toast("照片已刪除");
      render();
    },

    goto: () => { S.date = ds.date; go("today"); },
    "week-prev": () => { S.weekN = Math.max(1, S.weekN - 1); render(); },
    "week-next": () => { S.weekN = Math.min(WEEKS, S.weekN + 1); render(); },

    "rev-new": () => { S.revEdit = "new"; S.revDraft = { id: "r" + uid(), date: today(), title: "", problem: "", cause: "", change: "", basis: "", tags: [], outcome: "" }; render(); },
    "rev-edit": () => { S.revEdit = ds.id; S.revDraft = clone(revisions().find((r) => r.id === ds.id)); S.revDraft.tags ||= []; render(); },
    "rev-cancel": () => { S.revEdit = null; S.revDraft = null; render(); },
    "rev-tag": () => { const t = S.revDraft.tags; const i = t.indexOf(ds.v); i >= 0 ? t.splice(i, 1) : t.push(ds.v); el.classList.toggle("is-on"); },
    "rev-save": () => {
      const r = S.revDraft;
      if (!r.title && !r.change) { toast("至少填標題或修正內容"); return; }
      editDoc(P.revisions, { items: [] }, (doc) => {
        const i = doc.items.findIndex((x) => x.id === r.id);
        i >= 0 ? (doc.items[i] = r) : doc.items.push(r);
      });
      S.revEdit = null; S.revDraft = null;
      toast("已儲存修正紀錄");
      render();
    },
    "rev-del": () => { S.revDel = ds.id; render(); },
    "rev-del-no": () => { S.revDel = null; render(); },
    "rev-del-yes": () => { editDoc(P.revisions, { items: [] }, (doc) => { doc.items = doc.items.filter((x) => x.id !== ds.id); }); S.revDel = null; render(); },

    "plan-edit": () => { S.planEdit = +ds.n; S.planDraft = clone(weekPlan(+ds.n)); render(); },
    "plan-cancel": () => { S.planEdit = null; S.planDraft = null; render(); },
    "plan-save": () => {
      const w = S.planDraft;
      editDoc(P.plan, plan(), (doc) => { const i = doc.weeks.findIndex((x) => x.n === w.n); doc.weeks[i] = w; });
      S.planEdit = null; S.planDraft = null; S.versions = null;
      toast("課表已儲存。如果是因為狀況調整，記得到「歷程」記一筆。");
      render();
    },
    "ver-load": async () => {
      el.disabled = true; el.textContent = "載入中…";
      try { S.versions = await st().commits(P.plan); } catch { toast("無法載入版本紀錄，請確認網路"); }
      render();
    },
    "ver-open": async () => {
      if (S.versionView?.sha === ds.sha) { S.versionView = null; render(); return; }
      try { S.versionView = { sha: ds.sha, data: await st().jsonAt(P.plan, ds.sha) }; } catch { toast("無法載入這個版本"); }
      render();
    },

    "food-add": () => {
      const name = document.getElementById("fa-name").value.trim();
      if (!name) { toast("請輸入名稱"); return; }
      if (foods().some((f) => f.name === name)) { toast("清單裡已經有這個名稱"); return; }
      editFoods((doc) => doc.items.push({ id: "f" + uid(), name, kcal: num(document.getElementById("fa-kcal").value), protein: num(document.getElementById("fa-prot").value), uses: 0 }));
      toast(`已新增 ${name}`);
      render();
      document.getElementById("fa-name")?.focus();
    },
    "food-del": () => { S.foodDel = ds.id; render(); },
    "food-del-no": () => { S.foodDel = null; render(); },
    "food-del-yes": () => { editFoods((doc) => { doc.items = doc.items.filter((x) => x.id !== ds.id); }); S.foodDel = null; render(); },

    "exp-md": () => download(`8週運動計畫報告草稿_${today()}.md`, toMarkdown({ getDay, plan: plan(), revisions: { items: revisions() }, weeks: weeksDoc(), tests: tests() }), "text/markdown;charset=utf-8"),
    "exp-csv": () => download(`8週運動計畫每日紀錄_${today()}.csv`, toCSV(allDates(), getDay), "text/csv;charset=utf-8"),
    "exp-json": () => {
      const out = {};
      for (const p of Object.keys(st().files)) out[p] = st().json(p);
      download(`training-log-backup_${today()}.json`, JSON.stringify(out, null, 2), "application/json");
    },
    "exp-zip": async () => {
      const list = photoList(allDates(), getDay);
      if (!list.length) { toast("還沒有上傳任何照片"); return; }
      try {
        const { blob, failed } = await photosZip(list, st(), (i, n) => { S.zipProgress = `下載中 ${i} / ${n}…`; const s = el.querySelector("span"); if (s) s.textContent = S.zipProgress; });
        download(`8週運動計畫照片_${today()}.zip`, blob);
        toast(failed ? `完成，有 ${failed} 張下載失敗` : `已打包 ${list.length} 張照片`);
      } catch (err) { toast(err.message || "打包失敗"); }
      S.zipProgress = "";
      render();
    },
    sync: async () => { await st().sync(); await st().flush(); toast("已同步"); },

    "cfg-save": async () => {
      const c = {
        owner: document.getElementById("cfg-owner").value.trim(),
        repo: document.getElementById("cfg-repo").value.trim() || "training-log-data",
        token: document.getElementById("cfg-token").value.trim(),
      };
      if (!c.owner || !c.token) { toast("請填 GitHub 帳號和 token"); return; }
      el.disabled = true; el.textContent = "連接中…";
      const ok = await connect(c);
      if (ok) { saveCfg(c); toast("已連接"); go("today"); }
      else { el.disabled = false; el.textContent = "連接"; toast(S.store?.lastError || "連接失敗"); S.store = null; }
    },
    "cfg-clear": () => { S.clearAsk = true; render(); },
    "cfg-clear-no": () => { S.clearAsk = false; render(); },
    "cfg-clear-yes": async () => {
      try { localStorage.removeItem(CFG_KEY); } catch {}
      for (const s of ["kv", "photos", "queue"]) await idb.clear(s);
      S.store = null; S.clearAsk = false;
      go("setup");
    },
  };
  const h = H[a];
  if (h) { e.preventDefault(); h(); }
}

function allDates() {
  return st().paths("data/days/").map((p) => p.slice(10, 20)).sort();
}

// ---------------------------------------------------------------- 事件：輸入
$view.addEventListener("input", (e) => {
  const t = e.target;
  const ds = t.dataset;
  if (ds.f) {
    const v = ds.type === "num" ? num(t.value) : t.value;
    editDay(S.date, (d) => setPath(d, ds.f, v));
    refreshDaySums();
  } else if (ds.item) {
    const [k, i, field] = ds.item.split(":");
    const v = num(t.value);
    let foodId = null;
    editDay(S.date, (d) => { const it = d.meals[k].items[+i]; it[field] = v; foodId = it.foodId; });
    // 常吃清單裡這項還沒填數字 → 順便補上，下次就不用再填
    const f = foodId && foods().find((x) => x.id === foodId);
    if (f && f[field] == null && v != null) editFoods((doc) => { const x = doc.items.find((y) => y.id === foodId); if (x) x[field] = v; });
    refreshDaySums();
  } else if (ds.pq) {
    S.pickerQuery = t.value;
    const box = document.getElementById("pl-" + ds.pq);
    if (box) box.innerHTML = pickerList(ds.pq);
  } else if (ds.wf) {
    editDoc(P.weeks, {}, (doc) => { doc[ds.wf] = { ...(doc[ds.wf] || {}), reflection: t.value }; });
  } else if (ds.rf) {
    S.revDraft[ds.rf] = t.value;
  } else if (ds.pd != null && ds.pd !== undefined && S.planDraft) {
    if (ds.pd === "phase") S.planDraft.phase = t.value; else S.planDraft.days[+ds.pd] = t.value;
  } else if (ds.pt) {
    editDoc(P.plan, plan(), (doc) => { doc.targets = { ...(doc.targets || {}), [ds.pt]: num(t.value) }; });
  } else if (ds.tf) {
    editDoc(P.tests, { pre: {}, post: {} }, (doc) => setPath(doc, ds.tf, t.value));
  } else if (ds.food) {
    const [id, field] = ds.food.split(":");
    editFoods((doc) => { const x = doc.items.find((y) => y.id === id); if (x) x[field] = field === "name" ? t.value : num(t.value); });
  } else if ("fq" in ds) {
    S.foodQuery = t.value;
    S.needRender = true; // 離開輸入框後重畫
  }
});

$view.addEventListener("change", (e) => {
  const t = e.target;
  if (t.id === "date-pick" && t.value) { S.date = t.value; S.picker = null; render(); }
  else if (t.dataset.upload && t.files?.length) { uploadPhotos(t.dataset.upload, t.files); t.value = ""; }
});

$view.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.id === "fa-name") { e.preventDefault(); document.querySelector('[data-act="food-add"]')?.click(); }
  if (e.key === "Enter" && e.target.id === "fq") e.target.blur();
  const qa = e.target.id?.match(/^qa-(\w+)-(name|kcal|prot)$/);
  if (e.key === "Enter" && qa) { e.preventDefault(); document.querySelector(`[data-act="quick-add"][data-meal="${qa[1]}"]`)?.click(); }
});

// ---------------------------------------------------------------- 同步狀態
const STATUS_TEXT = {
  idle: "已同步", pending: "有修改待上傳", saving: "上傳中…", syncing: "同步中…",
  offline: "離線（已存在本機）", error: "同步失敗",
};
function showStatus(s, err) {
  $status.dataset.state = s;
  $status.querySelector("span").textContent = STATUS_TEXT[s] || s;
  $status.title = err || STATUS_TEXT[s] || "";
}
$status.addEventListener("click", async () => {
  if (!st()) return go("setup");
  if (st().status === "error") toast(st().lastError);
  await st().sync();
  st().flush();
});

// ---------------------------------------------------------------- 啟動
async function connect(cfg, fetchImpl) {
  const store = new Store({ ...cfg, fetchImpl });
  store.addEventListener("status", (ev) => showStatus(ev.detail.status, ev.detail.error));
  store.addEventListener("change", (ev) => { if (ev.detail.source !== "saved") safeRender(); });
  S.store = store;
  return store.init();
}

async function boot() {
  window.addEventListener("hashchange", route);
  const params = new URLSearchParams(location.search);
  if (params.has("mock")) {
    for (const s of ["kv", "photos", "queue"]) await idb.clear(s); // 示範模式每次從頭開始
    const { mockFetch } = await import("./mock.js");
    const f = await mockFetch();
    await connect({ owner: "demo", repo: "training-log-data", token: "mock" }, f);
    document.body.classList.add("is-mock");
  } else {
    const cfg = loadCfg();
    if (cfg?.owner && cfg?.token) {
      const ok = await connect(cfg);
      if (!ok && st()?.status === "error" && !Object.keys(st().files).length) S.store = null;
    }
  }
  route();
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && st()) st().sync(); });
  setInterval(() => { if (document.visibilityState === "visible" && st() && !st().flushing) st().sync(); }, 60000);
  window.addEventListener("online", () => st()?.flush());
  if ("serviceWorker" in navigator && !params.has("mock") && location.protocol === "https:") {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}
boot();
