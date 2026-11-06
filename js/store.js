// 以私人 GitHub repo 當資料庫：JSON 檔 + 照片。
// 讀取：tree API 列出所有檔案，只下載 sha 有變的 JSON，快取在 IndexedDB。
// 寫入：先改本機狀態並放進佇列（IndexedDB），再依序 PUT 到 contents API；離線時保留佇列。
import { idb } from "./idb.js";

const API = "https://api.github.com";
const enc = new TextEncoder();
const dec = new TextDecoder();

function bytesToB64(bytes) {
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(bin);
}
function b64ToText(b64) {
  const bin = atob(b64.replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return dec.decode(bytes);
}
const encPath = (p) => p.split("/").map(encodeURIComponent).join("/");

export class GhError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export class Store extends EventTarget {
  constructor({ owner, repo, token, fetchImpl }) {
    super();
    this.owner = owner;
    this.repo = repo;
    this.token = token;
    this.fetch = fetchImpl || ((...a) => fetch(...a));
    this.branch = "main";
    this.files = {};        // path -> { sha, data }  （data/*.json）
    this.tree = {};         // path -> sha（所有檔案，含照片）
    this.queue = new Map(); // path -> { kind: "json"|"photo"|"delete", data?, blob? }
    this.urls = new Map();  // 照片 path -> object URL
    this.status = "idle";
    this.lastError = "";
    this.flushTimer = null;
    this.flushing = false;
  }

  // ---------- 基本 ----------
  setStatus(s, err = "") {
    this.status = s;
    this.lastError = err;
    this.dispatchEvent(new CustomEvent("status", { detail: { status: s, error: err } }));
  }
  emit(paths, source) {
    this.dispatchEvent(new CustomEvent("change", { detail: { paths, source } }));
  }
  base() { return `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}`; }

  async gh(path, { method = "GET", body, accept, raw = false } = {}) {
    const res = await this.fetch(API + path, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: accept || "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    if (!res.ok) {
      let msg = res.statusText;
      try { msg = (await res.json()).message || msg; } catch {}
      throw new GhError(res.status, msg);
    }
    if (raw) return res;
    if (res.status === 204) return null;
    return res.json();
  }

  // ---------- 啟動與同步 ----------
  async init() {
    const cached = await idb.get("kv", this.cacheKey());
    if (cached) { this.files = cached.files || {}; this.tree = cached.tree || {}; this.branch = cached.branch || "main"; }
    for (const [path, item] of await idb.entries("queue")) {
      this.queue.set(path, item);
      if (item.kind === "json") this.files[path] = { sha: this.files[path]?.sha, data: item.data };
      if (item.kind === "photo") this.tree[path] = this.tree[path] || "local";
      if (item.kind === "delete") delete this.files[path];
    }
    this.emit(Object.keys(this.files), "cache");
    try {
      const info = await this.gh(this.base());
      this.branch = info.default_branch || "main";
      this.isPrivate = !!info.private;
    } catch (e) {
      this.handleErr(e);
      return false;
    }
    await this.sync();
    this.flushSoon(0);
    return true;
  }
  cacheKey() { return `files:${this.owner}/${this.repo}`; }
  async saveCache() {
    await idb.set("kv", this.cacheKey(), { files: this.files, tree: this.tree, branch: this.branch });
  }

  handleErr(e) {
    if (e instanceof GhError) {
      if (e.status === 401) this.setStatus("error", "GitHub token 無效或已過期，請到設定重新輸入。");
      else if (e.status === 403) this.setStatus("error", "沒有權限或超過 API 次數限制：" + e.message);
      else if (e.status === 404) this.setStatus("error", "找不到資料 repo，請確認帳號、repo 名稱，以及 token 有開放這個 repo。");
      else this.setStatus("error", `GitHub 錯誤 ${e.status}：${e.message}`);
    } else {
      this.setStatus("offline", "目前離線，修改會先存在這台裝置，連上網路後自動上傳。");
    }
  }

  async sync() {
    if (this.syncing) return;
    this.syncing = true;
    this.setStatus("syncing");
    try {
      let items = [];
      try {
        const t = await this.gh(`${this.base()}/git/trees/${encodeURIComponent(this.branch)}?recursive=1`);
        items = t.tree.filter((x) => x.type === "blob");
      } catch (e) {
        if (!(e instanceof GhError && (e.status === 409 || e.status === 404))) throw e; // 409：空 repo
      }
      const newTree = {};
      for (const it of items) newTree[it.path] = it.sha;
      const changed = [];
      const toFetch = items.filter((it) =>
        it.path.startsWith("data/") && it.path.endsWith(".json") &&
        !this.queue.has(it.path) && this.files[it.path]?.sha !== it.sha);
      // 平行下載（一次 6 個）
      for (let i = 0; i < toFetch.length; i += 6) {
        await Promise.all(toFetch.slice(i, i + 6).map(async (it) => {
          const blob = await this.gh(`${this.base()}/git/blobs/${it.sha}`);
          try {
            this.files[it.path] = { sha: it.sha, data: JSON.parse(b64ToText(blob.content)) };
            changed.push(it.path);
          } catch (err) { console.warn("無法解析", it.path, err); }
        }));
      }
      for (const p of Object.keys(this.files)) {
        if (!(p in newTree) && !this.queue.has(p)) { delete this.files[p]; changed.push(p); }
      }
      for (const [p, item] of this.queue) if (item.kind === "photo") newTree[p] = newTree[p] || "local";
      this.tree = newTree;
      await this.saveCache();
      if (changed.length) this.emit(changed, "remote");
      this.setStatus(this.queue.size ? "pending" : "idle");
    } catch (e) {
      this.handleErr(e);
    } finally {
      this.syncing = false;
    }
  }

  // ---------- 讀 ----------
  json(path) { return this.files[path]?.data; }
  paths(prefix) { return Object.keys(this.files).filter((p) => p.startsWith(prefix)); }

  // ---------- 寫 ----------
  async setJSON(path, data) {
    const copy = JSON.parse(JSON.stringify(data));
    this.files[path] = { sha: this.files[path]?.sha, data: copy };
    const item = { kind: "json", data: copy };
    this.queue.set(path, item);
    await idb.set("queue", path, item);
    this.setStatus("pending");
    this.flushSoon(2000);
  }

  async addPhoto(path, blob) {
    const item = { kind: "photo", blob };
    this.queue.set(path, item);
    this.tree[path] = "local";
    await idb.set("photos", path, blob);
    await idb.set("queue", path, item);
    this.setStatus("pending");
    this.flushSoon(0);
  }

  async deleteFile(path) {
    const pendingPhoto = this.queue.get(path);
    if (pendingPhoto && pendingPhoto.kind === "photo") {
      // 還沒上傳的照片：直接取消
      this.queue.delete(path);
      await idb.del("queue", path);
    } else {
      const item = { kind: "delete" };
      this.queue.set(path, item);
      await idb.set("queue", path, item);
      this.flushSoon(500);
    }
    await idb.del("photos", path);
    if (this.urls.has(path)) { URL.revokeObjectURL(this.urls.get(path)); this.urls.delete(path); }
  }

  flushSoon(ms) {
    clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flush(), ms);
  }

  async flush() {
    if (this.flushing) { this.flushAgain = true; return; }
    this.flushing = true;
    try {
      while (this.queue.size) {
        const [path, item] = this.queue.entries().next().value;
        this.setStatus("saving");
        try {
          await this.writeOne(path, item);
        } catch (e) {
          if (e instanceof GhError && e.status === 422 && item.kind === "photo") {
            // 已存在：視為完成
          } else {
            this.handleErr(e);
            return;
          }
        }
        if (this.queue.get(path) === item) {
          this.queue.delete(path);
          await idb.del("queue", path);
        } else {
          // 上傳期間又被改過：把佇列移到尾端，下一輪再送
          const newer = this.queue.get(path);
          if (newer) { this.queue.delete(path); this.queue.set(path, newer); }
        }
      }
      await this.saveCache();
      this.setStatus("idle");
      this.emit([], "saved");
    } finally {
      this.flushing = false;
      if (this.flushAgain) { this.flushAgain = false; this.flushSoon(0); }
    }
  }

  async writeOne(path, item) {
    const url = `${this.base()}/contents/${encPath(path)}`;
    if (item.kind === "json") {
      const put = (sha, data) => this.gh(url, {
        method: "PUT",
        body: {
          message: `更新 ${path}`,
          content: bytesToB64(enc.encode(JSON.stringify(data, null, 2) + "\n")),
          branch: this.branch,
          ...(sha && sha !== "local" ? { sha } : {}),
        },
      });
      let data = item.data;
      let res;
      try {
        res = await put(this.files[path]?.sha || this.tree[path], data);
      } catch (e) {
        if (!(e instanceof GhError && (e.status === 409 || e.status === 422))) throw e;
        // sha 衝突：抓最新版合併後重送
        const remote = await this.getRemote(path);
        data = remote ? this.merge(path, remote.data, data) : data;
        res = await put(remote?.sha, data);
      }
      const sha = res.content.sha;
      const keepLocal = this.queue.get(path) !== item; // 期間又被改過，保留較新的本機資料
      this.files[path] = { sha, data: keepLocal ? this.files[path].data : data };
      this.tree[path] = sha;
      if (data !== item.data && !keepLocal) this.emit([path], "merged");
    } else if (item.kind === "photo") {
      const buf = new Uint8Array(await item.blob.arrayBuffer());
      const res = await this.gh(url, {
        method: "PUT",
        body: { message: `新增照片 ${path}`, content: bytesToB64(buf), branch: this.branch },
      });
      this.tree[path] = res.content.sha;
    } else if (item.kind === "delete") {
      let sha = this.tree[path];
      if (!sha || sha === "local") {
        const r = await this.getRemote(path, false);
        sha = r?.sha;
      }
      if (sha) {
        try {
          await this.gh(url, { method: "DELETE", body: { message: `刪除 ${path}`, sha, branch: this.branch } });
        } catch (e) {
          if (!(e instanceof GhError && e.status === 404)) throw e;
        }
      }
      delete this.tree[path];
      delete this.files[path];
    }
  }

  async getRemote(path, parse = true) {
    try {
      const r = await this.gh(`${this.base()}/contents/${encPath(path)}?ref=${encodeURIComponent(this.branch)}`);
      return { sha: r.sha, data: parse && r.content ? JSON.parse(b64ToText(r.content)) : null };
    } catch (e) {
      if (e instanceof GhError && e.status === 404) return null;
      throw e;
    }
  }

  // 衝突合併：本機內容為主，照片清單取聯集（避免另一台裝置剛上傳的照片消失）
  merge(path, remote, local) {
    if (!path.startsWith("data/days/") || !remote) return local;
    const out = JSON.parse(JSON.stringify(local));
    const union = (a = [], b = []) => [...new Set([...a, ...b])];
    for (const k of Object.keys(remote.meals || {})) {
      if (!out.meals?.[k]) continue;
      out.meals[k].photos = union(remote.meals[k].photos, out.meals[k].photos);
    }
    if (remote.exercise && out.exercise) out.exercise.photos = union(remote.exercise.photos, out.exercise.photos);
    return out;
  }

  // ---------- 照片 ----------
  async photoBlob(path) {
    let blob = await idb.get("photos", path);
    if (blob) return blob;
    const res = await this.gh(`${this.base()}/contents/${encPath(path)}?ref=${encodeURIComponent(this.branch)}`,
      { accept: "application/vnd.github.raw", raw: true });
    blob = await res.blob();
    if (!blob.type || blob.type === "application/octet-stream") blob = new Blob([blob], { type: "image/jpeg" });
    await idb.set("photos", path, blob);
    return blob;
  }
  async photoURL(path) {
    if (this.urls.has(path)) return this.urls.get(path);
    const blob = await this.photoBlob(path);
    const u = URL.createObjectURL(blob);
    this.urls.set(path, u);
    return u;
  }

  // ---------- 版本紀錄 ----------
  async commits(path) {
    const list = await this.gh(`${this.base()}/commits?path=${encodeURIComponent(path)}&sha=${encodeURIComponent(this.branch)}&per_page=60`);
    return list.map((c) => ({ sha: c.sha, date: c.commit.committer?.date || c.commit.author?.date, message: c.commit.message }));
  }
  async jsonAt(path, ref) {
    const r = await this.gh(`${this.base()}/contents/${encPath(path)}?ref=${encodeURIComponent(ref)}`);
    return JSON.parse(b64ToText(r.content));
  }
}
