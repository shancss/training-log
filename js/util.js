// 日期、格式與資料模型的共用工具
export const START = "2026-10-05";
export const WEEKS = 8;
export const MEALS = [["breakfast", "早餐"], ["lunch", "午餐"], ["tea", "下午茶"], ["dinner", "晚餐"], ["snack", "宵夜"]];
export const MEAL_LABEL = Object.fromEntries(MEALS);
export const WD = ["一", "二", "三", "四", "五", "六", "日"];
export const EX_STATUS = [["done", "完成"], ["partial", "部分完成"], ["changed", "有調整"], ["skip", "沒做"], ["rest", "休息日"]];
export const EX_STATUS_LABEL = Object.fromEntries(EX_STATUS);
export const EX_TAGS = ["單槓", "跑步", "單車", "練舞", "核心", "伸展", "重訓", "其他"];
export const REV_TAGS = ["超載", "漸進", "特殊性", "可逆性", "恢復性", "FITT-VP", "營養", "傷害預防", "時間安排"];

export const TEST_FIELDS = [
  ["date", "測驗日期", ""], ["height", "身高", "cm"], ["weight", "體重", "kg"], ["bmi", "BMI", ""],
  ["waist", "腰圍", "cm"], ["hip", "臀圍", "cm"], ["skinfold", "皮脂三點總和", "mm"],
  ["bfSkinfold", "體脂率（皮脂夾）", "%"], ["bfInbody", "體脂率（InBody）", "%"], ["muscle", "骨骼肌重", "kg"],
  ["plank", "棒式", "分:秒"], ["pullupMax", "引體向上最大次數", "下"], ["run1600", "1600 m 跑走", "分:秒"],
  ["sitReach", "坐姿體前彎", "cm"], ["run5k", "5 km 跑步", "分:秒"], ["note", "備註", ""],
];

export function parseD(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
export function fmtD(dt) {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}
export function today() { return fmtD(new Date()); }
export function addDays(s, n) { const d = parseD(s); d.setDate(d.getDate() + n); return fmtD(d); }
export function diffDays(a, b) { return Math.round((parseD(a) - parseD(b)) / 864e5); }
export function weekOf(s) { return Math.floor(diffDays(s, START) / 7) + 1; }
export function dayIdx(s) { return (parseD(s).getDay() + 6) % 7; }
export function weekStart(n) { return addDays(START, (n - 1) * 7); }
export function weekDates(n) { return Array.from({ length: 7 }, (_, i) => addDays(weekStart(n), i)); }
export function md(s) { const d = parseD(s); return `${d.getMonth() + 1}/${d.getDate()}`; }
export function weekLabel(n) {
  if (n < 1) return "前測期";
  if (n > WEEKS) return "計畫結束後";
  return `第 ${n} 週`;
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
export const num = (v) => (v === "" || v == null || isNaN(Number(v)) ? null : Number(v));

// "20:22" 或 "1:02:30" → 秒
export function toSec(t) {
  if (!t) return null;
  const p = String(t).trim().split(":").map(Number);
  if (p.some(isNaN)) return null;
  return p.reduce((a, v) => a * 60 + v, 0);
}
export function secToStr(s) {
  if (s == null || !isFinite(s)) return "";
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return (h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + `:${String(r).padStart(2, "0")}`;
}
export function pace(km, time) {
  const s = toSec(time);
  if (!km || !s) return "";
  return secToStr(s / km) + "/km";
}

// 一餐：items 是一樣樣食物（每份熱量／蛋白質 × 份數）；note 是備註。
// 舊資料只有 text（＋整餐 kcal／protein），沒有 items；一旦加入食物，text 會轉成第一樣食物。
export function emptyMeal() { return { items: [], text: "", note: "", photos: [], kcal: null, protein: null, shot: false }; }

const r1 = (v) => Math.round(v * 10) / 10;
export function mealTotals(m) {
  if (m.items?.length) {
    let kcal = 0, protein = 0, kOk = false, pOk = false;
    for (const it of m.items) {
      const q = it.qty || 1;
      if (it.kcal != null) { kcal += it.kcal * q; kOk = true; }
      if (it.protein != null) { protein += it.protein * q; pOk = true; }
    }
    return { kcal: kOk ? Math.round(kcal) : null, protein: pOk ? r1(protein) : null };
  }
  return { kcal: m.kcal ?? null, protein: m.protein ?? null };
}
export function itemName(it) { return (it.qty || 1) !== 1 ? `${it.name}×${it.qty}` : it.name; }
export function mealText(m) {
  const main = [(m.items || []).map(itemName).join("＋"), m.text].filter(Boolean).join("＋");
  return m.note ? `${main}（${m.note}）` : main;
}
// 把舊的整餐文字轉成第一樣食物（加入新食物前呼叫）
export function textToItem(m) {
  if (m.text && !m.items.length) {
    m.items.push({ foodId: null, name: m.text, kcal: m.kcal ?? null, protein: m.protein ?? null, qty: 1 });
    m.text = ""; m.kcal = null; m.protein = null;
  }
}
export function emptyDay(date) {
  return {
    date,
    meals: Object.fromEntries(MEALS.map(([k]) => [k, emptyMeal()])),
    exercise: { status: "", tags: [], detail: "", km: null, time: "", minutes: null, rpe: null, photos: [], deviation: "", shot: false },
    weight: null,
    diary: "",
    updatedAt: null,
  };
}
// 補齊欄位（舊資料或缺欄位時）
export function normDay(d, date) {
  const base = emptyDay(date);
  if (!d) return base;
  const out = { ...base, ...d, meals: { ...base.meals }, exercise: { ...base.exercise, ...(d.exercise || {}) } };
  for (const [k] of MEALS) {
    const m = { ...emptyMeal(), ...(d.meals?.[k] || {}) };
    m.items = (m.items || []).map((it) => ({ ...it }));
    // 前一版：有食物時 text 是「補充說明」，其實多半是另一樣食物 → 轉成一樣食物
    if (m.items.length && m.text) { m.items.push({ foodId: null, name: m.text, kcal: null, protein: null, qty: 1 }); m.text = ""; }
    out.meals[k] = m;
  }
  return out;
}

export function dayTotals(d) {
  let kcal = 0, protein = 0, kn = 0, pn = 0, filled = 0;
  for (const [k] of MEALS) {
    const m = d.meals[k];
    if (m.text || m.items.length || m.photos.length) filled++;
    const t = mealTotals(m);
    if (t.kcal != null) { kcal += t.kcal; kn++; }
    if (t.protein != null) { protein += t.protein; pn++; }
  }
  return { kcal: kn ? Math.round(kcal) : null, protein: pn ? Math.round(protein * 10) / 10 : null, filled, estimated: kn };
}

export function hasContent(d) {
  if (!d) return false;
  if (d.weight != null || d.diary || d.exercise?.status || d.exercise?.detail) return true;
  return MEALS.some(([k]) => d.meals?.[k]?.text || d.meals?.[k]?.items?.length || d.meals?.[k]?.photos?.length);
}

export function uid() { return Math.random().toString(36).slice(2, 10); }
