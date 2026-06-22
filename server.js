/* =============================================================
   알뜰식단 · 네이버 쇼핑 실시간 가격 서버 (Node 내장 모듈만 사용)
   -------------------------------------------------------------
   하는 일
   1) 같은 폴더의 budget-meal-planner.html 앱을 그대로 서빙
   2) 앱이 호출하는 /api/prices 요청을 받아 네이버 쇼핑 검색 API로
      각 재료의 "최저가"를 조회해 돌려줌 (API 키는 서버에만 보관)

   실행 방법 (네이버 개발자센터에서 무료 키 발급 후)
     Windows(PowerShell):
       $env:NAVER_CLIENT_ID="발급받은아이디"; $env:NAVER_CLIENT_SECRET="시크릿"; node server.js
     macOS / Linux:
       NAVER_CLIENT_ID=발급받은아이디 NAVER_CLIENT_SECRET=시크릿 node server.js

   그러면 브라우저에서  http://localhost:8787  로 앱이 열리고,
   장바구니의 "네이버 실시간 최저가 불러오기" 버튼이 동작합니다.
   ============================================================= */

const http  = require("http");
const https = require("https");
const fs    = require("fs");
const path  = require("path");
const url   = require("url");

const PORT          = process.env.PORT || 8787;
const CLIENT_ID     = process.env.NAVER_CLIENT_ID     || "";
const CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET || "";
const APP_FILE      = path.join(__dirname, "budget-meal-planner.html");

/* ---- 가격 캐시 (배포용: 네이버 호출 수 절감) ----
   같은 검색어는 일정 시간 동안 한 번만 조회하고 모든 사용자가 공유한다. */
const CACHE = new Map();                 // query -> { data, ts }
const CACHE_TTL = 6 * 60 * 60 * 1000;    // 6시간

/* ---- 네이버 쇼핑 검색 API 호출 → 최저가 1건 ---- */
function naverLowestPrice(query){
  return new Promise((resolve)=>{
    if(!CLIENT_ID || !CLIENT_SECRET){
      return resolve({ error:"NO_KEY" });
    }
    const q = encodeURIComponent(query);
    // sort=asc : 가격 낮은 순. display=1 : 최저가 1건만.
    const apiPath = `/v1/search/shop.json?query=${q}&display=10&sort=sim`;
    const options = {
      hostname:"openapi.naver.com",
      path:apiPath,
      method:"GET",
      headers:{
        "X-Naver-Client-Id":CLIENT_ID,
        "X-Naver-Client-Secret":CLIENT_SECRET
      }
    };
    const req = https.request(options, (resp)=>{
      let body="";
      resp.on("data", d=>body+=d);
      resp.on("end", ()=>{
        try{
          const json = JSON.parse(body);
          const items = (json.items||[]).filter(it=>parseInt(it.lprice,10)>0);
          if(!items.length) return resolve({ error:"NO_RESULT" });
          // 관련도 높은(sim) 상품들 중 최저가 선택
          let best=items[0], bestP=parseInt(items[0].lprice,10);
          items.forEach(it=>{ const p=parseInt(it.lprice,10); if(p<bestP){ bestP=p; best=it; } });
          const title = String(best.title||"").replace(/<[^>]+>/g,"");
          resolve({ price: bestP, title, link: best.link||"", mall: best.mallName||"" });
        }catch(e){
          resolve({ error:"PARSE", detail:String(e) });
        }
      });
    });
    req.on("error", e=>resolve({ error:"NET", detail:String(e) }));
    req.end();
  });
}

/* ---- 동시 호출 수 제한해서 순차/소량 병렬 처리 ---- */
async function fetchPrices(items){
  const out = {};
  for(const cur of items){
    const key = cur.q || cur.id;
    const hit = CACHE.get(key);
    if(hit && (Date.now() - hit.ts) < CACHE_TTL){ out[cur.id] = hit.data; continue; }  // 캐시 사용
    const r = await naverLowestPrice(key);
    if(r && r.price > 0){ CACHE.set(key, { data:r, ts:Date.now() }); }                  // 성공분만 캐시
    out[cur.id] = r;
    await new Promise(res=>setTimeout(res, 120));   // 네이버 초당 호출 한도(10/s) 회피
  }
  return out;
}

/* ---- CORS (파일로 직접 연 앱에서도 호출 가능하게) ---- */
function cors(res){
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type");
}

const server = http.createServer((req,res)=>{
  cors(res);
  const parsed = url.parse(req.url, true);

  if(req.method==="OPTIONS"){ res.writeHead(204); return res.end(); }

  // 헬스 체크
  if(parsed.pathname==="/health"){
    res.writeHead(200,{"Content-Type":"application/json"});
    return res.end(JSON.stringify({ ok:true, hasKey: !!(CLIENT_ID&&CLIENT_SECRET) }));
  }

  // 가격 조회 (배치)
  if(parsed.pathname==="/api/prices" && req.method==="POST"){
    let raw="";
    req.on("data", d=>{ raw+=d; if(raw.length>1e6) req.destroy(); });
    req.on("end", async ()=>{
      try{
        const { items } = JSON.parse(raw||"{}");
        if(!Array.isArray(items) || !items.length){
          res.writeHead(400,{"Content-Type":"application/json"});
          return res.end(JSON.stringify({ error:"items 배열이 필요합니다" }));
        }
        if(!CLIENT_ID || !CLIENT_SECRET){
          res.writeHead(200,{"Content-Type":"application/json"});
          return res.end(JSON.stringify({ prices:{}, warn:"네이버 API 키가 설정되지 않았습니다. server.js 안내를 참고하세요." }));
        }
        const prices = await fetchPrices(items);
        res.writeHead(200,{"Content-Type":"application/json"});
        res.end(JSON.stringify({ prices }));
      }catch(e){
        res.writeHead(500,{"Content-Type":"application/json"});
        res.end(JSON.stringify({ error:String(e) }));
      }
    });
    return;
  }

  // 단일 조회 (테스트용):  /api/price?q=쌀 10kg
  if(parsed.pathname==="/api/price" && req.method==="GET"){
    const q = parsed.query.q || "";
    naverLowestPrice(q).then(r=>{
      res.writeHead(200,{"Content-Type":"application/json"});
      res.end(JSON.stringify(r));
    });
    return;
  }

  // 앱(HTML) 서빙
  if(parsed.pathname==="/" || parsed.pathname==="/index.html" || parsed.pathname==="/budget-meal-planner.html"){
    fs.readFile(APP_FILE, (err,buf)=>{
      if(err){
        res.writeHead(404,{"Content-Type":"text/plain; charset=utf-8"});
        return res.end("budget-meal-planner.html 을 server.js 와 같은 폴더에 두세요.");
      }
      res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});
      res.end(buf);
    });
    return;
  }

  // PWA 정적 파일(매니페스트·서비스워커·아이콘) 서빙
  const MIME = {
    ".json":"application/manifest+json; charset=utf-8",
    ".js":"application/javascript; charset=utf-8",
    ".png":"image/png",
    ".ico":"image/x-icon"
  };
  const STATIC = new Set([
    "/manifest.json","/sw.js",
    "/icon-192.png","/icon-512.png","/icon-maskable-512.png","/apple-touch-icon.png"
  ]);
  if(STATIC.has(parsed.pathname)){
    const fp = path.join(__dirname, path.basename(parsed.pathname));
    fs.readFile(fp,(err,buf)=>{
      if(err){ res.writeHead(404); return res.end(); }
      const ext = path.extname(fp);
      res.writeHead(200,{"Content-Type": MIME[ext]||"application/octet-stream"});
      res.end(buf);
    });
    return;
  }

  res.writeHead(404,{"Content-Type":"text/plain; charset=utf-8"});
  res.end("Not found");
});

server.listen(PORT, ()=>{
  console.log("──────────────────────────────────────────────");
  console.log("  알뜰식단 가격 서버 실행 중");
  console.log("  앱 주소:  http://localhost:"+PORT);
  console.log("  네이버 키:", (CLIENT_ID&&CLIENT_SECRET) ? "설정됨 ✅" : "없음 ❌ (실시간 가격 비활성)");
  if(!(CLIENT_ID&&CLIENT_SECRET)){
    console.log("  → README 를 참고해 NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 를 설정 후 다시 실행하세요.");
  }
  console.log("──────────────────────────────────────────────");
});
