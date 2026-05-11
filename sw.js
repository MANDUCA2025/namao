/* NaMão Service Worker — v1
   Estratégia:
   - app shell (HTML/JS/CSS/fontes/CDNs) → stale-while-revalidate
   - documentos do Firebase Storage (.enc) → cache-first (já estão cifrados)
   - navegação → network-first com fallback para shell
*/
const VERSION='namao-v1';
const SHELL_CACHE=`${VERSION}-shell`;
const RUNTIME_CACHE=`${VERSION}-runtime`;
const DOCS_CACHE=`${VERSION}-docs`;

const SHELL=[
  './',
  './namao_v3.html',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
];

self.addEventListener('install', e=>{
  self.skipWaiting();
  e.waitUntil(
    caches.open(SHELL_CACHE).then(c=>Promise.all(
      SHELL.map(u=>c.add(new Request(u,{mode:'no-cors'})).catch(()=>{}))
    ))
  );
});

self.addEventListener('activate', e=>{
  e.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>!k.startsWith(VERSION)).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});

const isDoc = url => /firebasestorage\.googleapis\.com/.test(url) || url.endsWith('.enc');
const isShell = url => SHELL.some(s=>url.endsWith(s.replace('./','')) || url===s);

self.addEventListener('fetch', e=>{
  const req=e.request;
  if(req.method!=='GET') return;
  const url=req.url;

  // Documentos cifrados — cache-first (são imutáveis por path)
  if(isDoc(url)){
    e.respondWith((async()=>{
      const cache=await caches.open(DOCS_CACHE);
      const hit=await cache.match(req);
      if(hit) return hit;
      try{
        const res=await fetch(req);
        if(res.ok) cache.put(req,res.clone());
        return res;
      }catch(err){
        return new Response('offline',{status:503});
      }
    })());
    return;
  }

  // Navegação HTML — network-first
  if(req.mode==='navigate' || (req.headers.get('accept')||'').includes('text/html')){
    e.respondWith((async()=>{
      try{
        const res=await fetch(req);
        const cache=await caches.open(SHELL_CACHE);
        cache.put(req,res.clone());
        return res;
      }catch(err){
        const cache=await caches.open(SHELL_CACHE);
        return (await cache.match(req)) || (await cache.match('./namao_v3.html')) || new Response('offline',{status:503});
      }
    })());
    return;
  }

  // Demais (JS/CSS/fonte/CDN) — stale-while-revalidate
  e.respondWith((async()=>{
    const cache=await caches.open(RUNTIME_CACHE);
    const hit=await cache.match(req);
    const net=fetch(req).then(res=>{
      if(res && res.ok) cache.put(req,res.clone());
      return res;
    }).catch(()=>hit);
    return hit || net;
  })());
});

// Mensagens (forçar atualização do app)
self.addEventListener('message', e=>{
  if(e.data==='SKIP_WAITING') self.skipWaiting();
});
