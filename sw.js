// Spencer's Race Club — service worker.
//
// Doel: tweede bezoek vrijwel-instant booten door zware assets uit de cache
// te serveren. Eerste bezoek (cold load) is ongewijzigd; netwerk-fail blijft
// netwerk-fail (geen offline-modus). Cache-strategie:
//
//   - Vendor + per-world JS chunks → cache-first, lange TTL. Versie-bumps
//     via filename query-string (?v=N) of dist-hash invalideren automatisch.
//   - Statische assets (HDRI, textures, GLTF, audio) → cache-first.
//   - index.html + CSS → network-first met cache-fallback zodat code-deploys
//     niet vastlopen op stale shell HTML.
//
// Versie bump: verander SW_VERSION wanneer caching-logica zelf wijzigt
// (niet voor elke content-update). Een gewijzigde SW_VERSION invalideert
// de oude cache en triggert een nieuwe pre-fetch op activate.

'use strict';

const SW_VERSION='src-v11-2026-05-28';
const CACHE_NAME='src-cache-'+SW_VERSION;

// Pre-cache de absolute essentials. Rest wordt on-demand gecached via fetch
// handler. Klein houden — deze lijst moet 100% beschikbaar zijn anders fail
// the install.
//
// QW3 2026-05-28: pre-cache uitgebreid met dist-bundles (boot-critical
// JS, samen <60KB) + manifest.json + de twee meest-relevante world
// scripts (space = default world, guangzhou = zwaarste/grootste).
// Tweede bezoek serveert deze items direct uit cache i.p.v. een
// netwerk-roundtrip — meetbare versnelling op repeat-visits.
//
// Maintenance-note: shared-materials.bundle.js gebruikt een
// querystring-versie (`?v=YYYY-MM-DDx`) zoals geladen in index.html.
// SW behandelt querystring als andere URL, dus de exacte string moet
// hier overeenkomen met index.html. Bij bumps in index.html óók
// SW_VERSION hier bumpen, anders blijft de oude versie cache-hit.
const PRECACHE_URLS=[
  '/',
  '/index.html',
  '/assets/vendor/three-r160.min.js',
  // Menu-music MP3 — boot.js fetcht 'm direct na page-load voor instant
  // start op de 1e tap. Pre-cache zorgt dat herhaalbezoeken offline werken
  // en de pre-fetch uit cache komt (≈0ms i.p.v. een netwerk-round-trip).
  '/assets/audio/music/menu/grid-run.mp3',
  // dist bundles — boot-critical, samen <60KB.
  '/dist/device.bundle.js',
  '/dist/breadcrumb.bundle.js',
  '/dist/perf.bundle.js',
  '/dist/three-compat.bundle.js',
  '/dist/quality-tier.bundle.js',
  '/dist/shared-materials.bundle.js?v=2026-05-26b',
  // manifest + default world + heaviest world.
  '/assets/manifest.json',
  '/js/worlds/space.js',
  '/js/worlds/guangzhou.js',
];

// URL-patronen voor cache-first. Wereld-scripts + vendor + assets zijn
// onveranderlijk per build dus altijd uit cache als beschikbaar.
function isCacheFirstAsset(url){
  return /\/assets\/vendor\//.test(url)
      || /\/assets\/hdri\//.test(url)
      || /\/assets\/textures\//.test(url)
      || /\/assets\/models\//.test(url)
      || /\/assets\/audio\//.test(url)
      || /\/js\/worlds\//.test(url);
}

// Network-first met cache fallback: HTML + CSS waar deploy-rotatie belangrijk
// is. Bij offline of network-fail valt het terug op de laatst gecachte versie.
function isNetworkFirstShell(url){
  return /\.html?($|\?)/.test(url)
      || /\.css($|\?)/.test(url);
}

self.addEventListener('install',event=>{
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache=>cache.addAll(PRECACHE_URLS))
      .then(()=>self.skipWaiting())
      .catch(err=>{
        // Pre-cache failed (404, CSP) — log maar fail niet de install. Andere
        // assets worden alsnog on-demand gecached door de fetch handler.
        console.warn('[sw] precache failed:',err);
      })
  );
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(
      keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin)return; // skip cross-origin
  if(isCacheFirstAsset(url.pathname)){
    event.respondWith(cacheFirst(req));
    return;
  }
  if(isNetworkFirstShell(url.pathname)){
    event.respondWith(networkFirst(req));
    return;
  }
  // Default: stale-while-revalidate voor overige JS (core/effects/ui/etc).
  // Serveert direct uit cache als beschikbaar, ververst op de achtergrond.
  if(/\.js($|\?)/.test(url.pathname)){
    event.respondWith(staleWhileRevalidate(req));
  }
});

async function cacheFirst(req){
  const cache=await caches.open(CACHE_NAME);
  const cached=await cache.match(req);
  if(cached)return cached;
  try{
    const res=await fetch(req);
    if(res&&res.status===200&&res.type==='basic'){
      cache.put(req,res.clone()).catch(()=>{});
    }
    return res;
  }catch(err){
    // Network failed and no cache entry — return a synthetic error response
    // so the page can surface a meaningful failure instead of hanging.
    return new Response('asset unavailable offline',{status:503,statusText:'offline'});
  }
}

async function networkFirst(req){
  const cache=await caches.open(CACHE_NAME);
  try{
    const res=await fetch(req);
    if(res&&res.status===200&&res.type==='basic'){
      cache.put(req,res.clone()).catch(()=>{});
    }
    return res;
  }catch(err){
    const cached=await cache.match(req);
    if(cached)return cached;
    throw err;
  }
}

async function staleWhileRevalidate(req){
  const cache=await caches.open(CACHE_NAME);
  const cached=await cache.match(req);
  const networkPromise=fetch(req).then(res=>{
    if(res&&res.status===200&&res.type==='basic'){
      cache.put(req,res.clone()).catch(()=>{});
    }
    return res;
  }).catch(()=>cached); // bij netwerk-fail valt fetch-call door op cached
  return cached||networkPromise;
}
