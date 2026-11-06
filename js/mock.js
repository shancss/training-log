// 本機測試用：在記憶體裡模擬 GitHub API（網址加 ?mock=1 才會載入）。
// 會嘗試讀 ../seed/_bundle.json 當初始資料；讀不到就從空白開始。
const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (bytes) => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };

export async function mockFetch() {
  let n = 0;
  const sha = () => (++n).toString(16).padStart(40, "0");
  const files = new Map();   // path -> { sha, bytes }
  const history = [];        // { commit, date, path, bytes }
  try {
    const bundle = await (await fetch("../seed/_bundle.json")).json();
    for (const [p, obj] of Object.entries(bundle)) {
      const bytes = enc.encode(JSON.stringify(obj, null, 2) + "\n");
      const s = sha();
      files.set(p, { sha: s, bytes });
      history.push({ commit: s, date: "2026-11-06T08:00:00Z", path: p, bytes });
    }
  } catch { /* 空白開始 */ }

  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
  return async function (url, opts = {}) {
    await new Promise((r) => setTimeout(r, 60));
    const u = new URL(url);
    const m = u.pathname.match(/^\/repos\/[^/]+\/[^/]+(\/.*)?$/);
    if (!m) return json({ message: "Not Found" }, 404);
    const rest = m[1] || "";
    const method = opts.method || "GET";
    const accept = opts.headers?.Accept || "";
    if (!rest) return json({ default_branch: "main", private: true });
    if (rest.startsWith("/git/trees/")) return json({ tree: [...files].map(([path, f]) => ({ path, type: "blob", sha: f.sha })) });
    if (rest.startsWith("/git/blobs/")) {
      const s = rest.split("/").pop();
      const f = [...files.values()].find((x) => x.sha === s);
      return f ? json({ content: b64(f.bytes), encoding: "base64" }) : json({ message: "Not Found" }, 404);
    }
    if (rest === "/commits") {
      const p = u.searchParams.get("path");
      return json(history.filter((h) => h.path === p).reverse().map((h) => ({ sha: h.commit, commit: { committer: { date: h.date }, message: "更新" } })));
    }
    if (rest.startsWith("/contents/")) {
      const path = decodeURIComponent(rest.slice(10));
      const body = opts.body ? JSON.parse(opts.body) : {};
      const cur = files.get(path);
      if (method === "GET") {
        const ref = u.searchParams.get("ref");
        let bytes = cur?.bytes, s = cur?.sha;
        if (ref && ref !== "main") { const h = history.find((x) => x.commit === ref && x.path === path); bytes = h?.bytes; s = ref; }
        if (!bytes) return json({ message: "Not Found" }, 404);
        if (accept.includes("raw")) return new Response(bytes, { status: 200, headers: { "Content-Type": path.endsWith(".jpg") ? "image/jpeg" : "application/octet-stream" } });
        return json({ sha: s, content: b64(bytes) });
      }
      if (method === "PUT") {
        if (cur && !body.sha) return json({ message: "\"sha\" wasn't supplied." }, 422);
        if (cur && body.sha !== cur.sha) return json({ message: "does not match" }, 409);
        const bytes = unb64(body.content);
        const s = sha();
        files.set(path, { sha: s, bytes });
        history.push({ commit: s, date: new Date().toISOString(), path, bytes });
        return json({ content: { sha: s, path } }, cur ? 200 : 201);
      }
      if (method === "DELETE") {
        if (!cur) return json({ message: "Not Found" }, 404);
        files.delete(path);
        return json({ commit: {} });
      }
    }
    return json({ message: "Not Found" }, 404);
  };
}
// 讓除錯時可以看到解碼後的內容
export const _dec = dec;
