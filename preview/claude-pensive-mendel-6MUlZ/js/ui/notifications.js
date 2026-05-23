// js/ui/notifications.js — non-module script. Centralised notification facade.
//
// Exposeert window.Notify als de enige plek waar in-race meldingen door
// gerenderd worden. Bestaande wrappers (showPopup / showBanner / showBannerTop
// in ui/hud.js, showAchievementToast in gameplay/achievements.js,
// showUnlockToast in persistence/progression.js) routeren via deze facade.
//
// Drie zones (zie NOTIFICATIONS_PLAN.md voor design):
//   A — top-right status flash (single slot, prio-driven replace/drop)
//   B — top-center subtle lap announce (single slot, debounced per (lap,total))
//   C — top-right achievement/unlock stack (max 3 zichtbaar, FIFO queue)
//
// Plus één out-of-band slot voor finish-screen banners (centraal, geen
// race-sight-line restricties want #hud is dan hidden).

'use strict';

(function(){
  if(typeof window.Notify !== 'undefined') return; // idempotent

  // Priority-tabel — zie NOTIFICATIONS_PLAN.md "Prioriteits- en queue-tabel".
  // Hogere waarde wint; gelijke vervangt; lagere wordt gedropt zolang er een
  // hogere actief is in zone A.
  const PRI = {
    LEADER:100, FASTEST_LAP:90, BANNER:80, WEATHER:70, OVERTAKE:60,
    PLAYER_LOST:50, DRIFT:50, DEFAULT:50, HAZARD:40, HINT:30,
  };

  // Module-local state — geen window.* globals (consumer pattern uit CLAUDE.md).
  let containerA=null, containerB=null, containerC=null, containerOOB=null;
  let activeA=null;            // {el, expiresAt, priority}
  let activeB=null;            // {el, expiresAt}
  let activeOOB=null;          // {el, expiresAt}
  const itemsC=[];             // [{el, expiresAt}] — visible toasts
  const queueC=[];             // overflow queue (FIFO)
  let lastLapKey='', lastLapT=0;
  let runningRAF=false, lastT=0, clock=0;
  let prevState='';

  function _dbg(level, ...args){
    if(window.dbg && typeof window.dbg[level]==='function') window.dbg[level]('notify', ...args);
    else (level==='error'?console.error:console.warn)('Notify:', ...args);
  }

  function ensureContainers(){
    try{
      if(!containerA){
        containerA=document.createElement('div'); containerA.id='ntfA';
        document.body.appendChild(containerA);
      }
      if(!containerB){
        containerB=document.createElement('div'); containerB.id='ntfB';
        document.body.appendChild(containerB);
      }
      if(!containerC){
        containerC=document.createElement('div'); containerC.id='ntfC';
        document.body.appendChild(containerC);
      }
      if(!containerOOB){
        containerOOB=document.createElement('div'); containerOOB.id='ntfOOB';
        document.body.appendChild(containerOOB);
      }
    }catch(e){ _dbg('warn', e, 'ensureContainers failed'); }
  }

  function _ensureRAF(){
    if(runningRAF) return;
    runningRAF=true; lastT=performance.now();
    requestAnimationFrame(_tick);
  }

  function _tick(now){
    try{
      // Cap dt zodat een terug-naar-tab event geen grote sprong in `clock`
      // veroorzaakt waarna alle toasts ineens verdwijnen.
      const rawDt=now-lastT; lastT=now;
      const dt=rawDt>100?16:rawDt;
      const paused=!!window.gamePaused;
      const gs=window.gameState||'';
      // Race-restart / quit → wis alle actieve toasts.
      if(gs!==prevState){
        if(gs==='COUNTDOWN'||gs==='TITLE'||gs==='SELECT'||gs==='WORLD_SELECT') _clearAllInternal();
        prevState=gs;
      }
      if(!paused) clock+=dt;

      if(activeA && clock>=activeA.expiresAt) _fadeOutA();
      if(activeB && clock>=activeB.expiresAt) _fadeOutB();
      if(activeOOB && clock>=activeOOB.expiresAt) _fadeOutOOB();
      for(let i=itemsC.length-1;i>=0;i--){
        if(clock>=itemsC[i].expiresAt) _fadeOutToast(i);
      }
      while(itemsC.length<3 && queueC.length){ _showToast(queueC.shift()); }

      if(activeA||activeB||activeOOB||itemsC.length||queueC.length){
        requestAnimationFrame(_tick);
      }else{
        runningRAF=false;
      }
    }catch(e){
      _dbg('error', e, 'tick crashed');
      runningRAF=false;
    }
  }

  // ─── Zone A — status (top-right, single slot) ───
  function _renderA(text, opts){
    ensureContainers();
    if(!containerA) return;
    const o=opts||{};
    const priority=(typeof o.priority==='number')?o.priority:PRI.DEFAULT;
    const dur=(typeof o.dur==='number')?o.dur:1500;
    const color=o.color||'#ffffff';
    const icon=o.icon||'';
    // Drop-rule: lager-pri event valt af zolang hogere actief is.
    if(activeA && activeA.priority>priority && clock<activeA.expiresAt){
      _dbg('log','drop',text,'pri='+priority,'<',activeA.priority);
      return;
    }
    let el=containerA.firstChild;
    if(!el){
      el=document.createElement('div'); el.className='ntfStatus';
      const ic=document.createElement('span'); ic.className='ntfIcon';
      const tx=document.createElement('span'); tx.className='ntfTxt';
      el.appendChild(ic); el.appendChild(tx);
      containerA.appendChild(el);
    }
    const ic=el.querySelector('.ntfIcon'), tx=el.querySelector('.ntfTxt');
    ic.textContent=icon||''; ic.style.display=icon?'inline':'none';
    tx.textContent=text||'';
    el.style.color=color;
    el.style.borderColor=color+'4d';
    el.style.boxShadow='0 0 18px '+color+'33, 0 6px 22px rgba(0,0,0,.5)';
    el.classList.remove('ntfShow'); void el.offsetWidth; el.classList.add('ntfShow');
    // dur===0 = "keep tot expliciet hideBanner()" — gebruikt door spacefx.js
    // FALLING-banner. Infinity zorgt dat _tick 'm nooit auto-dismist.
    activeA={el, expiresAt: dur===0 ? Infinity : clock+dur, priority};
    _ensureRAF();
  }
  function _fadeOutA(){
    if(!activeA) return;
    try{ activeA.el.classList.remove('ntfShow'); }catch(_){}
    activeA=null;
  }

  // ─── Zone B — lap announce (top-center, subtle) ───
  function _renderB(lap, total){
    ensureContainers();
    if(!containerB||!lap||!total) return;
    const key=lap+'/'+total, nowMs=performance.now();
    if(key===lastLapKey && (nowMs-lastLapT)<5000) return; // debounce same announcement
    lastLapKey=key; lastLapT=nowMs;
    let el=containerB.firstChild;
    if(!el){
      el=document.createElement('div'); el.className='ntfLap';
      containerB.appendChild(el);
    }
    el.textContent='LAP '+lap+' / '+total;
    el.classList.remove('ntfShow'); void el.offsetWidth; el.classList.add('ntfShow');
    activeB={el, expiresAt:clock+1800};
    _ensureRAF();
  }
  function _fadeOutB(){
    if(!activeB) return;
    try{ activeB.el.classList.remove('ntfShow'); }catch(_){}
    activeB=null;
  }

  // ─── Zone C — achievement / unlock stack ───
  // Icon-id detector: een symbol-ref voor de inline SVG sprite is een korte
  // ASCII identifier. Emoji-glyphs (legacy of unlock-flow) bevatten
  // non-ASCII codepoints → vallen terug op text-render.
  function _isIconId(s){
    return typeof s==='string' && s.length>0 && s.length<32 && /^[a-z][a-z0-9_-]*$/i.test(s);
  }
  function _showToast(payload){
    ensureContainers();
    if(!containerC) return;
    // Tier-driven kleur als tier is meegegeven, anders default per kind.
    const TIER_COLOR={bronze:'#c08457',silver:'#c8d0d8',gold:'#ffd000',platinum:'#9ad4ff'};
    const tier=payload.tier||null;
    const color=payload.color||(tier&&TIER_COLOR[tier])||(payload.kind==='unlock'?'#ffd000':'#d4a8ff');
    const el=document.createElement('div');
    // .ntfRace class = compact format during gameState==='RACE' (B4).
    // Owner reported mid-race achievements feeling visually heavy
    // ('midden in race-chaos'); narrower width + smaller padding +
    // milder shadow keeps the toast visible without grabbing
    // attention away from the track. Full-celebration format stays
    // for FINISH/post-race state.
    const isRace=(typeof gameState!=='undefined' && gameState==='RACE');
    el.className='ntfToast ntf-'+payload.kind+(isRace?' ntfRace':'');
    if(tier) el.setAttribute('data-tier',tier);
    el.style.borderColor=color+'55';
    el.style.boxShadow=isRace
      ? '0 0 10px '+color+'25, 0 8px 24px rgba(0,0,0,.45), inset 0 1px 0 rgba(212,168,255,.08)'
      : '0 0 16px '+color+'30, 0 10px 28px rgba(0,0,0,.5), inset 0 1px 0 rgba(212,168,255,.10)';
    const iconEl=document.createElement('span'); iconEl.className='ntfToastIcon';
    if(_isIconId(payload.icon)){
      // Inline SVG sprite reference — kleur via currentColor (CSS).
      iconEl.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#ach-'+payload.icon+'"/></svg>';
    } else {
      // Backwards-compat: emoji/text glyph (unlock 🔓, level-up ⭐ legacy).
      iconEl.textContent=payload.icon||'🏆';
    }
    const bodyEl=document.createElement('div'); bodyEl.className='ntfToastBody';
    const lblEl=document.createElement('div'); lblEl.className='ntfToastLabel';
    lblEl.style.color=color;
    lblEl.textContent=payload.label||(payload.kind==='unlock'?'UNLOCK':'ACHIEVEMENT');
    bodyEl.appendChild(lblEl);
    const titleEl=document.createElement('div'); titleEl.className='ntfToastTitle';
    titleEl.textContent=payload.title||'';
    bodyEl.appendChild(titleEl);
    if(payload.desc){
      const descEl=document.createElement('div'); descEl.className='ntfToastDesc';
      descEl.textContent=payload.desc;
      bodyEl.appendChild(descEl);
    }
    el.appendChild(iconEl); el.appendChild(bodyEl);
    containerC.appendChild(el);
    requestAnimationFrame(()=>{ try{ el.classList.add('ntfShow'); }catch(_){} });
    // Race-state defaults to a shorter visible duration (2400ms vs
    // 3500ms) so multiple in-race triggers don't stack-and-occlude.
    // Caller can still override via payload.dur. (B4)
    const dur=payload.dur||(isRace?2400:3500);
    itemsC.push({el, expiresAt:clock+dur});
    _ensureRAF();
  }
  function _fadeOutToast(idx){
    const it=itemsC[idx];
    if(!it) return;
    itemsC.splice(idx,1);
    try{ it.el.classList.remove('ntfShow'); }catch(_){}
    setTimeout(()=>{ try{ it.el.remove(); }catch(_){} }, 450);
  }
  function _enqueueC(kind, payload){
    payload.kind=kind;
    if(itemsC.length<3) _showToast(payload);
    else queueC.push(payload);
    _ensureRAF();
  }

  // ─── Out-of-band central banner (FINISH/COUNTDOWN/PAUSED) ───
  function _renderOOB(text, color, dur){
    ensureContainers();
    if(!containerOOB) return;
    const c=color||'#ffffff';
    let el=containerOOB.firstChild;
    if(!el){
      el=document.createElement('div'); el.className='ntfOOBInner';
      containerOOB.appendChild(el);
    }
    el.textContent=text||'';
    el.style.color=c;
    el.style.borderColor=c+'88';
    el.style.boxShadow='0 0 28px '+c+'66, 0 8px 30px rgba(0,0,0,.6)';
    el.classList.remove('ntfShow'); void el.offsetWidth; el.classList.add('ntfShow');
    // dur===0 = persistent (zelfde semantiek als _renderA) — wacht op hideBanner.
    activeOOB={el, expiresAt: dur===0 ? Infinity : clock+(dur||2200)};
    _ensureRAF();
  }
  function _fadeOutOOB(){
    if(!activeOOB) return;
    try{ activeOOB.el.classList.remove('ntfShow'); }catch(_){}
    activeOOB=null;
  }
  function _renderBanner(text, color, dur){
    const gs=window.gameState||'';
    // dur===0 doorgeven — _renderA respecteert het en houdt 'm persistent.
    const passDur = dur===0 ? 0 : (dur||2200);
    if(gs==='RACE') _renderA(text, {color, dur:passDur, priority:PRI.BANNER});
    else _renderOOB(text, color, passDur);
  }

  function _clearAllInternal(){
    try{
      if(activeA && activeA.el) activeA.el.classList.remove('ntfShow');
      activeA=null;
      if(activeB && activeB.el) activeB.el.classList.remove('ntfShow');
      activeB=null;
      if(activeOOB && activeOOB.el) activeOOB.el.classList.remove('ntfShow');
      activeOOB=null;
      // Force-remove Zone C elements immediately. The 450ms fade-out delay
      // we use on natural expiry leaves toasts on screen during a quick
      // race quit→retry; nuking the DOM right away is the cleaner fix.
      while(itemsC.length){
        const it=itemsC.shift();
        try{ it.el.remove(); }catch(_){}
      }
      queueC.length=0;
      lastLapKey=''; lastLapT=0;
    }catch(e){ _dbg('warn', e, '_clearAll failed'); }
  }

  window.Notify={
    status:function(text, opts){
      try{ _renderA(String(text||''), opts); }catch(e){ _dbg('warn', e, 'status'); }
    },
    lap:function(lap, total){
      try{ _renderB(+lap, +total); }catch(e){ _dbg('warn', e, 'lap'); }
    },
    achievement:function(ach){
      if(!ach) return;
      try{
        _enqueueC('achievement', {
          title: ach.title||ach.label||'',
          desc:  ach.desc||'',
          icon:  ach.icon||'trophy',
          tier:  ach.tier||'gold',
          color: ach.color||null,
          dur:   ach.dur||3500,
          label: 'ACHIEVEMENT',
        });
      }catch(e){ _dbg('warn', e, 'achievement'); }
    },
    unlock:function(carDef){
      if(!carDef) return;
      try{
        _enqueueC('unlock', {
          title: ((carDef.brand||'')+' '+(carDef.name||'')).trim(),
          desc:  'New car available',
          icon:  '🔓',
          color: '#ffd000',
          dur:   3500,
          label: 'UNLOCK',
        });
      }catch(e){ _dbg('warn', e, 'unlock'); }
    },
    banner:function(text, color, dur){
      try{ _renderBanner(String(text||''), color, dur); }catch(e){ _dbg('warn', e, 'banner'); }
    },
    // hideBanner: expliciet dismiss van een persistente banner (dur=0). Door
    // tracklimits.js + spacefx.js gebruikt na recovery-cooldown. Affecteert
    // alleen banner-class slots — andere status flashes blijven door-tikken.
    hideBanner:function(){
      try{
        if(activeA && activeA.priority===PRI.BANNER) _fadeOutA();
        if(activeOOB) _fadeOutOOB();
      }catch(e){ _dbg('warn', e, 'hideBanner'); }
    },
    _clearAll:_clearAllInternal,
    _PRI:PRI,
  };
})();
