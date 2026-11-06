// 匯出：CSV、Markdown 報告草稿、JSON 備份、照片 zip
import { MEALS, MEAL_LABEL, WD, WEEKS, EX_STATUS_LABEL, TEST_FIELDS, weekOf, dayIdx, weekDates, weekStart, md, addDays, dayTotals, pace, hasContent, mealTotals, mealText } from "./util.js";

export function download(filename, data, type = "application/octet-stream") {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

const csvCell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function exText(e) {
  const parts = [];
  if (e.status) parts.push(`[${EX_STATUS_LABEL[e.status] || e.status}]`);
  if (e.tags?.length) parts.push(e.tags.join("/"));
  if (e.detail) parts.push(e.detail);
  if (e.km) parts.push(`${e.km} km${e.time ? " " + e.time : ""}${pace(e.km, e.time) ? "（" + pace(e.km, e.time) + "）" : ""}`);
  return parts.join(" ");
}

export function toCSV(dates, getDay) {
  const head = ["日期", "週次", "星期",
    ...MEALS.flatMap(([, l]) => [l, `${l}熱量`, `${l}蛋白質`]),
    "總熱量", "總蛋白質", "運動狀態", "運動類型", "運動內容", "距離km", "時間", "配速", "RPE", "與計畫差異", "體重", "日記"];
  const rows = [head];
  for (const date of dates) {
    const d = getDay(date);
    if (!hasContent(d)) continue;
    const t = dayTotals(d);
    const e = d.exercise;
    rows.push([date, weekOf(date) < 1 ? "前測期" : weekOf(date), WD[dayIdx(date)],
      ...MEALS.flatMap(([k]) => { const t = mealTotals(d.meals[k]); return [mealText(d.meals[k]), t.kcal, t.protein]; }),
      t.kcal, t.protein, EX_STATUS_LABEL[e.status] || "", (e.tags || []).join("/"), e.detail, e.km, e.time, pace(e.km, e.time), e.rpe, e.deviation,
      d.weight, d.diary]);
  }
  return "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

const mdCell = (s) => String(s ?? "").replace(/\|/g, "／").replace(/\n+/g, " ").trim() || " ";

export function toMarkdown({ getDay, plan, revisions, weeks, tests }) {
  const L = [];
  L.push("# 8 週運動計畫執行紀錄", "");
  L.push(`期程：${md(plan?.start || weekStart(1))} ～ ${md(addDays(weekStart(WEEKS), 6))}　目標：每日 ${plan?.targets?.kcal ?? "-"} kcal、蛋白質 ${plan?.targets?.protein ?? "-"} g、體重 ${plan?.targets?.weight ?? "-"} kg`, "");

  L.push("## 前測與後測", "", "| 項目 | 前測 | 後測 |", "|---|---|---|");
  for (const [k, label, unit] of TEST_FIELDS) {
    const a = tests?.pre?.[k] ?? "", b = tests?.post?.[k] ?? "";
    if (!a && !b) continue;
    L.push(`| ${label}${unit ? `（${unit}）` : ""} | ${mdCell(a)} | ${mdCell(b)} |`);
  }
  L.push("");

  L.push("## 計畫修正歷程", "");
  const revs = (revisions?.items || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  revs.forEach((r, i) => {
    L.push(`### ${i + 1}. ${r.title || "（未命名）"}（${md(r.date)}，第 ${weekOf(r.date)} 週）`);
    if (r.tags?.length) L.push(`標籤：${r.tags.join("、")}`);
    if (r.problem) L.push(`- **遇到的狀況**：${r.problem}`);
    if (r.cause) L.push(`- **原因分析**：${r.cause}`);
    if (r.change) L.push(`- **修正內容**：${r.change}`);
    if (r.basis) L.push(`- **依據**：${r.basis}`);
    if (r.outcome) L.push(`- **修正後成效**：${r.outcome}`);
    L.push("");
  });

  for (let n = 1; n <= WEEKS; n++) {
    const w = plan?.weeks?.find((x) => x.n === n);
    const dates = weekDates(n);
    L.push(`## 第 ${n} 週（${md(dates[0])}–${md(dates[6])}）${w?.phase ? "：" + w.phase : ""}`, "");
    if (w) {
      L.push("**計畫課表**", "");
      w.days.forEach((t, i) => L.push(`- 週${WD[i]}：${t}`));
      L.push("");
    }
    L.push("**實際執行**", "", `| 日期 | ${MEALS.map(([, l]) => l).join(" | ")} | 運動 | 熱量 | 蛋白質 | 體重 |`, `|---|${MEALS.map(() => "---").join("|")}|---|---|---|---|`);
    let any = false;
    for (const date of dates) {
      const d = getDay(date);
      if (!hasContent(d)) continue;
      any = true;
      const t = dayTotals(d);
      L.push(`| ${md(date)}（${WD[dayIdx(date)]}） | ${MEALS.map(([k]) => mdCell(mealText(d.meals[k]))).join(" | ")} | ${mdCell(exText(d.exercise))} | ${t.kcal ?? ""} | ${t.protein ?? ""} | ${d.weight ?? ""} |`);
    }
    if (!any) L.push(`| （本週尚無紀錄） |${MEALS.map(() => " ").join("|")}| | | | |`);
    L.push("");
    const diaries = dates.map((date) => [date, getDay(date)]).filter(([, d]) => d.diary || d.exercise.deviation);
    if (diaries.length) {
      L.push("**每日日記**", "");
      for (const [date, d] of diaries) {
        const extra = d.exercise.deviation ? `（與計畫差異：${d.exercise.deviation}）` : "";
        L.push(`- ${md(date)}（${WD[dayIdx(date)]}）：${(d.diary || "").replace(/\n+/g, " ")}${extra}`);
      }
      L.push("");
    }
    const refl = weeks?.[n]?.reflection;
    if (refl) L.push("**本週檢討**", "", refl, "");
  }
  return L.join("\n");
}

let jszipLoading = null;
function loadJSZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  if (!jszipLoading) {
    jszipLoading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
      s.onload = () => resolve(window.JSZip);
      s.onerror = () => { jszipLoading = null; reject(new Error("無法載入 JSZip，請確認網路")); };
      document.head.appendChild(s);
    });
  }
  return jszipLoading;
}

// photos: [{path, name}]
export async function photosZip(photos, store, onProgress) {
  const JSZip = await loadJSZip();
  const zip = new JSZip();
  let i = 0, failed = 0;
  for (const p of photos) {
    try {
      const blob = await store.photoBlob(p.path);
      zip.file(p.name, blob);
    } catch { failed++; }
    onProgress?.(++i, photos.length);
  }
  const blob = await zip.generateAsync({ type: "blob" });
  return { blob, failed };
}

export function photoList(dates, getDay) {
  const out = [];
  for (const date of dates) {
    const d = getDay(date);
    for (const [k, label] of MEALS) {
      d.meals[k].photos.forEach((path, i) => out.push({ path, name: `${date}_${label}_${i + 1}.jpg` }));
    }
    (d.exercise.photos || []).forEach((path, i) => out.push({ path, name: `${date}_運動_${i + 1}.jpg` }));
  }
  return out;
}

export { MEAL_LABEL };
