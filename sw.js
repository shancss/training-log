// 敹怠? App ?祇?嚗蝺??賣???鞈?嚗itHub API嚗?敺粥蝬脰楝嚗 App ?芸楛??IndexedDB 敹怠?????const CACHE = "training-log-v3";
const SHELL = [
  "./", "./index.html", "./styles.css", "./manifest.webmanifest", "./icon.svg", "./icon-192.png",
  "./js/app.js", "./js/store.js", "./js/idb.js", "./js/util.js", "./js/charts.js", "./js/export.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// ??瑼?嚗??函雯頝荔??踹??啁?嚗?憭望??敹怠?
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("./index.html")))
  );
});
