// js/ui/gamepad.js — Gamepad API integration (Xbox / PS / generic standard).
// Non-module script, geladen na ui/input.js + ui/navigation.js.
//
// Strategie:
//  • Race-controls (gas/brake/steer/nitro/drift) schrijven direct naar de
//    `keys` global — zelfde pad dat keyboard + touch al gebruiken, dus
//    physics/AI/camera/visuals blijven één enkele input-bron lezen.
//  • One-shot toggles (camera, mirror, pause, mute, pit, leaderboard,
//    day/night) dispatchen een synthetische KeyboardEvent zodat de
//    bestaande handlers in ui/input.js + ui/help.js + ui/pause.js
//    één-op-één hergebruikt worden — geen logica-duplicatie.
//  • Menu-navigatie cyclet de visible cards (.worldBigCard / .carCard) via
//    edge-detection + .click() op de focus-card. A/B knoppen klikken de
//    primaire/secondary action-button per screen.
//
// Afhankelijkheden (script-globals):
//   keys (main.js), gameState (main.js), _hwKeyboardDetected (touch.js)
//   showPopup (ui/hud.js), Notify (ui/notifications.js, optional)
//
// Standard-layout buttons:
//   0=A/Cross  1=B/Circle  2=X/Square  3=Y/Triangle
//   4=LB       5=RB        6=LT(analog) 7=RT(analog)
//   8=Back     9=Start     10=L3        11=R3
//   12=DUp     13=DDown    14=DLeft     15=DRight

'use strict';

(function(){
  // Feature detect — getGamepads is widely supported but not in old WebView.
  if(typeof navigator==='undefined'||typeof navigator.getGamepads!=='function')return;

  // Per-frame state. Steer/trigger axes write to keys[]; one-shots use edge.
  // STEER_DEAD + TRIG_THRESH are tunable from the Settings → Controls panel
  // (ui/settings.js) so are `let` rather than `const`. Sensible defaults:
  let STEER_DEAD=0.18;         // ignore stick noise inside ±18%
  let TRIG_THRESH=0.10;        // trigger pull > 10% counts as press
  const MENU_DEAD=0.55;        // higher dead-zone for menu nav (avoid skip)
  const MENU_REPEAT_MS=220;    // hold-to-repeat interval on menus

  // Settings hooks — clamp to a sane range so an over-driven slider can't
  // make the stick unresponsive or the trigger fire on rest position.
  window._gamepadSetDeadzone=(v)=>{STEER_DEAD=Math.max(0,Math.min(0.5,+v||0));};
  window._gamepadSetTrigThresh=(v)=>{TRIG_THRESH=Math.max(0,Math.min(0.5,+v||0));};

  const _prevBtn={};           // edge-detect store: code → wasDown
  let _connected=false;        // any gamepad seen this session
  let _menuRepeatAt=0;         // wall-clock ms for next menu auto-repeat
  let _stickWasNeutral=true;   // true when last frame stick was inside dead-zone

  // Holds the keys[] flags WE set last frame, so we don't clobber keyboard
  // input. Only release a key if WE were the one holding it.
  const _ourKeys={ArrowLeft:false,ArrowRight:false,ArrowUp:false,ArrowDown:false,
                  KeyN:false,Space:false};

  function _setKey(code,on){
    if(on){
      if(!keys[code]){keys[code]=true;_ourKeys[code]=true;}
    }else if(_ourKeys[code]){
      keys[code]=false;_ourKeys[code]=false;
    }
  }

  // Synthetic KeyboardEvent so existing keydown handlers (input.js, help.js,
  // boot.js Enter→goToSelect) trigger without us re-implementing the logic.
  // Send a paired keyup so keys[code] doesn't stick true in the global input
  // map (input.js sets keys[e.code]=true for every keydown; harmless for the
  // toggle-keys we route here, but keeps state clean).
  function _fireKey(code,key){
    const opts={code:code,key:key||code,bubbles:true,cancelable:true};
    window.dispatchEvent(new KeyboardEvent('keydown',opts));
    window.dispatchEvent(new KeyboardEvent('keyup',opts));
  }

  // First gamepad input → trigger the existing hardware-keyboard detector in
  // ui/input.js (which mutates the script-scope `_hwKeyboardDetected` let
  // and hides #touchControls). KeyI is in _HW_KB_KEYS but has no game-side
  // handler, so the synthetic press has no side effects beyond detection.
  // We send a paired keyup so keys['KeyI'] doesn't stay set in the input map.
  function _markDetected(){
    if(_connected)return;
    _connected=true;
    try{
      window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyI',key:'i',bubbles:true}));
      window.dispatchEvent(new KeyboardEvent('keyup',  {code:'KeyI',key:'i',bubbles:true}));
    }catch(_){}
    const tc=document.getElementById('touchControls');if(tc)tc.style.display='none';
    if(typeof showPopup==='function')showPopup('🎮 CONTROLLER CONNECTED','#88ddff',1400);
  }

  // ─── Menu navigation helpers ───────────────────────────────────────
  // Cycle visible cards in the active screen. dir = -1 prev, +1 next.
  function _cycleWorldCard(dir){
    const cards=Array.from(document.querySelectorAll('#sWorld .worldBigCard'));
    if(!cards.length)return;
    // 2D grid: 'up'/'down' jump by row width (cards that share offsetTop
    // with card 0). Numeric dir keeps the linear ±1 path for left/right.
    const top0=cards[0].offsetTop;
    const cols=cards.filter(c=>c.offsetTop===top0).length||1;
    let idx=cards.findIndex(c=>c.classList.contains('wBigSel'));
    if(idx<0)idx=0;
    const step=(dir==='up')?-cols:(dir==='down')?+cols:(dir|0);
    idx=(idx+step+cards.length)%cards.length;
    cards.forEach(c=>c.classList.remove('wBigSel'));
    cards[idx].classList.add('wBigSel');
    cards[idx].scrollIntoView({behavior:'smooth',block:'nearest',inline:'center'});
    if(typeof window._updateWorldSelFooter==='function') window._updateWorldSelFooter();
  }
  function _activateWorldCard(){
    // Enter-CTA is the explicit "go" affordance; fall back to clicking
    // the highlighted card (which now enters on a single click).
    const enterBtn=document.getElementById('worldSelEnter');
    if(enterBtn && !enterBtn.disabled){ enterBtn.click(); return; }
    const sel=document.querySelector('#sWorld .worldBigCard.wBigSel')||
              document.querySelector('#sWorld .worldBigCard');
    if(sel)sel.click();
  }

  function _cycleCarCard(dir){
    // Desktop carCard grid OR mobile selM-card carousel — cycle whichever is visible.
    // .selMobile is hidden via @media on desktop, so its computed display
    // tells us which UI is active. Fall back to "no carousel" if .selMobile
    // isn't in the DOM yet.
    const selMobile=document.querySelector('.selMobile');
    const isMobile=selMobile&&getComputedStyle(selMobile).display!=='none'&&
                   document.querySelector('.selM-card');
    if(isMobile){
      // Carousel is horizontal-only — vertical input is a no-op so a stray
      // ArrowUp/Down from the keyboard handler doesn't fight scroll-snap.
      if(dir==='up'||dir==='down')return;
      const cards=Array.from(document.querySelectorAll('.selM-carousel .selM-card'));
      if(!cards.length)return;
      let idx=cards.findIndex(c=>c.classList.contains('selM-cardActive'));
      if(idx<0)idx=0;
      idx=(idx+(dir|0)+cards.length)%cards.length;
      // Scroll the carousel — the existing scroll-snap observer (select.js)
      // detects center-most card and updates selCarId + .selM-cardActive.
      const carousel=document.querySelector('.selM-carousel');
      if(carousel&&cards[idx]){
        const target=cards[idx].offsetLeft - (carousel.clientWidth-cards[idx].clientWidth)/2;
        carousel.scrollTo({left:target,behavior:'smooth'});
      }
    }else{
      // Desktop: cycle .carCard:not(.locked) and trigger its native click,
      // which select.js wires to update selCarId + sel-class. 2D grid: detect
      // column-count from cards sharing offsetTop with card 0 so 'up'/'down'
      // jumps a row instead of one card linearly.
      const cards=Array.from(document.querySelectorAll('#sSelect .carCard:not(.locked)'));
      if(!cards.length)return;
      const top0=cards[0].offsetTop;
      const cols=cards.filter(c=>c.offsetTop===top0).length||1;
      let idx=cards.findIndex(c=>c.classList.contains('sel'));
      if(idx<0)idx=0;
      const step=(dir==='up')?-cols:(dir==='down')?+cols:(dir|0);
      idx=(idx+step+cards.length)%cards.length;
      cards[idx].click();
      cards[idx].scrollIntoView({behavior:'smooth',block:'nearest'});
    }
  }
  function _cycleLaps(dir){
    // Find currently-selected lap chip and move to neighbour. Works on both
    // desktop .setOpt[data-lap] and mobile .selM-chip[data-val] inside #selMLaps.
    const desk=Array.from(document.querySelectorAll('#sSelect .setOpts .setOpt[data-lap]'));
    const mob=Array.from(document.querySelectorAll('#selMLaps .selM-chip[data-val]'));
    const list=desk.length?desk:mob;
    if(!list.length)return;
    let idx=list.findIndex(b=>b.classList.contains('setOptSel')||b.classList.contains('selM-chipActive'));
    if(idx<0)idx=1;
    idx=Math.max(0,Math.min(list.length-1,idx+dir));
    list[idx].click();
  }
  function _cycleDiff(dir){
    const desk=Array.from(document.querySelectorAll('#sSelect .diffBtn'));
    const mob=Array.from(document.querySelectorAll('#selMDiff .selM-chip'));
    const list=desk.length?desk:mob;
    if(!list.length)return;
    let idx=list.findIndex(b=>b.classList.contains('setOptSel')||b.classList.contains('diffSel')||b.classList.contains('selM-chipActive'));
    if(idx<0)idx=1;
    idx=Math.max(0,Math.min(list.length-1,idx+dir));
    list[idx].click();
  }

  // Click a button by id if it's visible. Returns true if clicked.
  function _clickIfVisible(id){
    const el=document.getElementById(id);
    if(!el)return false;
    const r=el.getBoundingClientRect();
    if(r.width<=0||r.height<=0)return false;
    el.click();return true;
  }

  // A-button (confirm) routed to current screen's primary action.
  function _confirm(){
    // Pause overlay first — it covers other screens when open.
    const pause=document.getElementById('pauseOverlay');
    if(pause&&getComputedStyle(pause).display!=='none'){_clickIfVisible('btnResume');return;}
    // Help overlay open — close it.
    const help=document.getElementById('helpOverlay');
    if(help&&help.style.display==='flex'){if(typeof hideHelp==='function')hideHelp();return;}
    // Game-state routing.
    if(gameState==='TITLE'){_clickIfVisible('btnStart');return;}
    if(gameState==='WORLD_SELECT'){_activateWorldCard();return;}
    if(gameState==='SELECT'){
      // Mobile and desktop have separate race buttons; try both.
      if(_clickIfVisible('selMRace'))return;
      _clickIfVisible('btnRace');return;
    }
    if(gameState==='FINISH'){
      // A-button = primary CTA (Race Again)
      const b=document.querySelector('#sFinish .finBtnPrimary')
            ||document.querySelector('#sFinish .finBtn');
      if(b)b.click();
    }
  }
  // B-button (back/cancel) per screen.
  function _back(){
    const pause=document.getElementById('pauseOverlay');
    if(pause&&getComputedStyle(pause).display!=='none'){_clickIfVisible('btnQuit');return;}
    const help=document.getElementById('helpOverlay');
    if(help&&help.style.display==='flex'){if(typeof hideHelp==='function')hideHelp();return;}
    if(gameState==='WORLD_SELECT'){if(typeof goToTitle==='function')goToTitle();return;}
    if(gameState==='SELECT'){
      if(_clickIfVisible('selMBack'))return;
      _clickIfVisible('btnBackTitle');return;
    }
    if(gameState==='FINISH'){
      // B-button = back / cancel (Main Menu)
      const b=document.querySelector('#sFinish .finBtnSecondary');
      if(b){b.click();return;}
      const btns=document.querySelectorAll('#sFinish .finBtn');
      if(btns[1])btns[1].click();
    }
  }

  // Edge-detect: was this button up last frame and down now?
  function _pressed(code,down){
    const was=_prevBtn[code]||false;
    _prevBtn[code]=down;
    return down&&!was;
  }

  // ─── Main poll ───────────────────────────────────────────────────────
  function _poll(){
    requestAnimationFrame(_poll);
    const pads=navigator.getGamepads&&navigator.getGamepads();
    if(!pads)return;
    let pad=null;
    for(let i=0;i<pads.length;i++){if(pads[i]&&pads[i].connected){pad=pads[i];break;}}
    if(!pad){
      // Release any of our held keys when controller drops out.
      if(_ourKeys.ArrowLeft||_ourKeys.ArrowRight||_ourKeys.ArrowUp||_ourKeys.ArrowDown||
         _ourKeys.KeyN||_ourKeys.Space){
        _setKey('ArrowLeft',false);_setKey('ArrowRight',false);
        _setKey('ArrowUp',false);_setKey('ArrowDown',false);
        _setKey('KeyN',false);_setKey('Space',false);
      }
      return;
    }
    // Any input on this pad → mark detected.
    if(!_connected){
      const anyBtn=pad.buttons.some(b=>b&&b.pressed);
      const anyAxis=pad.axes.some(a=>Math.abs(a)>STEER_DEAD);
      if(anyBtn||anyAxis)_markDetected();
    }

    // Pause overlay open during RACE → treat as menu (A=resume, B=quit, etc.)
    const pauseOv=document.getElementById('pauseOverlay');
    const isPaused=pauseOv&&getComputedStyle(pauseOv).display!=='none';
    // FINISH stays out of inRace so the menu branch (A=Race Again, B=Main Menu)
    // can fire — physics no longer needs gas/brake/steer input on the finish screen.
    const inRace=!isPaused&&(gameState==='RACE'||gameState==='COUNTDOWN');
    const ax=pad.axes[0]||0;        // left stick X
    const ay=pad.axes[1]||0;        // left stick Y
    const btn=i=>pad.buttons[i]||{pressed:false,value:0};
    const dpadL=btn(14).pressed, dpadR=btn(15).pressed;
    const dpadU=btn(12).pressed, dpadD=btn(13).pressed;

    if(inRace){
      // ─ Steering: stick OR D-pad. Stick wins if past dead-zone. ─
      let steerL=false,steerR=false;
      if(ax<-STEER_DEAD)steerL=true;
      else if(ax>STEER_DEAD)steerR=true;
      if(dpadL)steerL=true;
      if(dpadR)steerR=true;
      _setKey('ArrowLeft',steerL);
      _setKey('ArrowRight',steerR);
      // ─ Triggers (analog) for gas/brake. Buttons 6=LT, 7=RT. ─
      const rt=btn(7).value||(btn(7).pressed?1:0);
      const lt=btn(6).value||(btn(6).pressed?1:0);
      // D-pad U/D as bumper-fallback for controllers without analog triggers.
      _setKey('ArrowUp',  rt>TRIG_THRESH || dpadU);
      _setKey('ArrowDown',lt>TRIG_THRESH || dpadD);
      // ─ Hold actions: A=nitro, B=drift ─
      _setKey('KeyN', btn(0).pressed);
      _setKey('Space',btn(1).pressed);
      // ─ Edge actions ─
      if(_pressed('btn2',btn(2).pressed))_fireKey('KeyH','h');   // X = pit stop
      if(_pressed('btn3',btn(3).pressed))_fireKey('KeyC','c');   // Y = camera
      if(_pressed('btn4',btn(4).pressed))_fireKey('KeyV','v');   // LB = mirror
      if(_pressed('btn5',btn(5).pressed))_fireKey('KeyL','l');   // RB = leaderboard
      if(_pressed('btn8',btn(8).pressed))_fireKey('KeyM','m');   // Back = mute
      if(_pressed('btn9',btn(9).pressed))_fireKey('KeyP','p');   // Start = pause
      if(_pressed('btn10',btn(10).pressed))_fireKey('KeyJ','j'); // L3 = day/night
    }else{
      // Outside RACE: release any hold-state we had.
      _setKey('ArrowLeft',false);_setKey('ArrowRight',false);
      _setKey('ArrowUp',false);_setKey('ArrowDown',false);
      _setKey('KeyN',false);_setKey('Space',false);

      // ─ Menu navigation ─
      const now=performance.now();
      const navL=ax<-MENU_DEAD || dpadL;
      const navR=ax>MENU_DEAD  || dpadR;
      const navU=ay<-MENU_DEAD || dpadU;
      const navD=ay>MENU_DEAD  || dpadD;
      const anyNav=navL||navR||navU||navD;
      // First-press fires immediately, then auto-repeat at MENU_REPEAT_MS.
      let fire=false;
      if(anyNav){
        if(_stickWasNeutral){fire=true;_menuRepeatAt=now+MENU_REPEAT_MS*1.6;}
        else if(now>=_menuRepeatAt){fire=true;_menuRepeatAt=now+MENU_REPEAT_MS;}
        _stickWasNeutral=false;
      }else{
        _stickWasNeutral=true;
      }
      if(fire){
        if(gameState==='WORLD_SELECT'){
          if(navL)_cycleWorldCard(-1);
          else if(navR)_cycleWorldCard(+1);
          else if(navU)_cycleWorldCard('up');
          else if(navD)_cycleWorldCard('down');
        }else if(gameState==='SELECT'){
          // Only L/R navigates car carousel — D-pad U/D is reserved for the
          // lap-count chips below to avoid double-fire on the same frame.
          if(navL)_cycleCarCard(-1);
          else if(navR)_cycleCarCard(+1);
        }
      }
      // LB/RB on SELECT screen tweak laps/difficulty so settings can be
      // reached without leaving the carousel.
      if(gameState==='SELECT'){
        if(_pressed('btn4',btn(4).pressed))_cycleDiff(-1);
        if(_pressed('btn5',btn(5).pressed))_cycleDiff(+1);
        if(_pressed('btn12u',dpadU))_cycleLaps(-1);
        if(_pressed('btn13d',dpadD))_cycleLaps(+1);
      }
      // Confirm / back / start / select on menus.
      if(_pressed('btn0',btn(0).pressed))_confirm();
      if(_pressed('btn1',btn(1).pressed))_back();
      if(_pressed('btn9',btn(9).pressed))_confirm();   // Start = primary on menus
    }

    // Always-available toggles regardless of screen.
    // 'btn3any' is a separate edge-state from 'btn3' (race-side camera) so
    // both gates can fire independently — only one is ever reachable per
    // frame because of the !inRace guard. If you ever remove that guard,
    // a single Y-press will both toggle camera AND help.
    if(_pressed('btn3any',btn(3).pressed)&&!inRace){
      if(typeof toggleHelp==='function')toggleHelp();
    }
  }

  // Connection events — also work as "press any button → connect" trigger.
  window.addEventListener('gamepadconnected',e=>{
    if(window.dbg)dbg.log('input','gamepad connected: '+e.gamepad.id);
    _markDetected();
  });
  window.addEventListener('gamepaddisconnected',e=>{
    if(window.dbg)dbg.log('input','gamepad disconnected: '+e.gamepad.id);
  });

  // Start polling. Cheap (one rAF tick + small array scan) — runs even on
  // TITLE/SELECT so the controller works for menu navigation.
  requestAnimationFrame(_poll);

  // Expose menu-nav helpers so the keyboard handler in boot.js can share
  // the cycling implementation (no duplicate logic for keyboard vs pad).
  window._menuCycleWorld    = _cycleWorldCard;
  window._menuActivateWorld = _activateWorldCard;
  window._menuCycleCar      = _cycleCarCard;
  window._menuConfirm       = _confirm;

  // Expose a tiny status helper for debugging from devtools.
  window._gamepadStatus=()=>{
    const pads=navigator.getGamepads&&navigator.getGamepads();
    if(!pads)return 'no pads array';
    const list=[];
    for(let i=0;i<pads.length;i++)if(pads[i])list.push(i+':'+pads[i].id+' connected='+pads[i].connected);
    return list.length?list.join('\n'):'no controller detected — press a button';
  };
})();
