/* 알뜰식단 서비스워커 — 앱 셸 캐시(오프라인 지원), 가격 API는 항상 네트워크 */
const CACHE = "alddeul-v1";
const ASSETS = [
  "./",
  "./budget-meal-planner.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png"
];

self.addEventListener("install", e=>{
  e.waitUntil(
    caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())
  );
});

self.addEventListener("activate", e=>{
  e.waitUntil(
    caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener("fetch", e=>{
  const u = new URL(e.request.url);
  if(u.pathname.includes("/api/")) return;          // 실시간 가격은 캐시하지 않음
  if(e.request.method!=="GET") return;
  e.respondWith(
    caches.match(e.request).then(r=> r || fetch(e.request).then(resp=>{
      const copy=resp.clone();
      caches.open(CACHE).then(c=>c.put(e.request, copy)).catch(()=>{});
      return resp;
    }).catch(()=> caches.match("./budget-meal-planner.html")))
  );
});
