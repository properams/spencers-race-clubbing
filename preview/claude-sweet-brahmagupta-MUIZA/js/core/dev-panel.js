// js/core/dev-panel.js — live tuning panel for graphics uniforms.
//
// Activated by `?dev=1` URL param or `localStorage.src_dev='1'`. Builds a
// floating panel top-right with sliders for the visual knobs that matter
// during world tuning: exposure, bloom, godrays, horizon haze. Edits
// uniforms live so a designer can iterate on values without rebuilding,
// then click "Print Config" to dump the current per-world values to the
// console for paste-back into _WORLD_ATMOSPHERE_TUNE / _BLOOM_WORLD_MUL.
//
// Replaces the planned lil-gui dependency — we couldn't vendor it from
// the sandbox (CDN proxy blocks unpkg/jsdelivr) so we hand-rolled a
// minimal HTML form. Same patterns: slider + number readout, grouped by
// section, save-to-console button.
//
// Never loaded in production runs (gate is checked before any DOM work).

'use strict';

(function(){
  function _devEnabled(){
    try {
      const url = new URLSearchParams(location.search);
      if(url.get('dev') === '1') return true;
    } catch(_) {}
    try {
      if(localStorage.getItem('src_dev') === '1') return true;
    } catch(_) {}
    return false;
  }

  if(!_devEnabled()) return;

  // Wait for postfx + atmosphere + renderer to be ready before drawing
  // the panel. The boot order is renderer → postfx → atmosphere → loop,
  // so a single setTimeout after DOMContentLoaded is enough.
  let _waitTries = 0;
  function _build(){
    if(!window.renderer){
      if(++_waitTries < 240) requestAnimationFrame(_build); // ~4s budget
      return;
    }
    // postfx / atmosphere can legitimately stay un-ready on mobile, on
    // ?lq=1 / `src_fx=0`, or when the renderer init failed. In those
    // cases we still want the dev panel to exist as a status surface
    // (so a designer doesn't think the panel itself is broken), but the
    // sliders that drive uniforms must not run their getValue() — that
    // dereferences null .matExtract / .matCompositeExt and crashes.
    const postfxReady    = !!(window._postfx && window._postfx.ready && window._postfx.matExtract);
    const atmosphereReady= !!(window._atmo   && window._atmo.ready   && window._atmo.matCompositeExt);
    _injectStyles();
    if(!postfxReady || !atmosphereReady){
      _renderStatusPanel(postfxReady, atmosphereReady);
      return;
    }
    _renderPanel();
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', () => requestAnimationFrame(_build));
  } else {
    requestAnimationFrame(_build);
  }

  // Status-only panel when postfx / atmosphere aren't available (mobile,
  // low-quality, FX-toggle persistent OFF). Tells the designer what the
  // device state is so they understand why no sliders show.
  function _renderStatusPanel(postfxReady, atmosphereReady){
    if(document.getElementById('devPanel')) return;
    const p = document.createElement('div');
    p.id = 'devPanel';
    const reasons = [];
    if(window._isMobile)                      reasons.push('mobile path (postfx skipped)');
    try { if(localStorage.getItem('src_fx')==='0') reasons.push('FX-toggle persistent OFF'); } catch(_){}
    if(window._lowQuality)                    reasons.push('auto-quality engaged');
    if(!reasons.length)                       reasons.push('postfx / atmosphere did not initialise');
    p.innerHTML =
      '<h3>SRC dev panel <span class="min">_</span></h3>'+
      '<div class="body">'+
      '<div class="world">world: '+ (window.activeWorld||'?') +'</div>'+
      '<div style="color:#ff8866;font-size:10px;line-height:1.5;margin-bottom:6px">'+
        'Sliders unavailable — reason:<br>· '+ reasons.join('<br>· ') +
      '</div>'+
      '<div style="color:#9aa6b8;font-size:10px;line-height:1.4">'+
        'postfx.ready: '+(postfxReady?'<span style="color:#7fd97f">yes</span>':'<span style="color:#ff8866">no</span>')+'<br>'+
        'atmosphere.ready: '+(atmosphereReady?'<span style="color:#7fd97f">yes</span>':'<span style="color:#ff8866">no</span>')+
      '</div>'+
      '</div>';
    p.querySelector('.min').addEventListener('click', e => {
      e.stopPropagation();
      p.classList.toggle('collapsed');
      p.querySelector('.min').textContent = p.classList.contains('collapsed') ? '+' : '_';
    });
    document.body.appendChild(p);
  }

  function _injectStyles(){
    if(document.getElementById('devPanelStyles')) return;
    const s = document.createElement('style');
    s.id = 'devPanelStyles';
    s.textContent = [
      '#devPanel{position:fixed;top:8px;right:8px;width:280px;background:rgba(8,10,18,0.92);',
      '  color:#cfd6e4;font:11px/1.4 Menlo,Consolas,monospace;border:1px solid #2a3548;',
      '  border-radius:6px;padding:8px;z-index:99999;backdrop-filter:blur(6px);',
      '  box-shadow:0 4px 16px rgba(0,0,0,0.45);pointer-events:auto;user-select:none}',
      '#devPanel h3{margin:0 0 6px 0;font-size:11px;letter-spacing:1.4px;color:#7fb6ff;',
      '  text-transform:uppercase;border-bottom:1px solid #1c2638;padding-bottom:4px}',
      '#devPanel .group{margin:6px 0 8px 0}',
      '#devPanel label{display:flex;justify-content:space-between;align-items:center;',
      '  margin-bottom:3px;font-size:10px;color:#9aa6b8}',
      '#devPanel label .val{color:#fff;font-variant-numeric:tabular-nums}',
      '#devPanel input[type=range]{width:100%;height:14px;background:transparent;',
      '  -webkit-appearance:none;margin:0;padding:0}',
      '#devPanel input[type=range]::-webkit-slider-runnable-track{height:3px;background:#1e2a40;border-radius:2px}',
      '#devPanel input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:11px;height:11px;',
      '  background:#7fb6ff;border-radius:50%;margin-top:-4px;cursor:pointer}',
      '#devPanel button{background:#1e2a40;color:#cfd6e4;border:1px solid #2a3548;',
      '  padding:4px 8px;border-radius:3px;cursor:pointer;font:10px/1.2 Menlo,Consolas,monospace;',
      '  letter-spacing:0.5px;margin-right:4px;margin-top:2px}',
      '#devPanel button:hover{background:#2a3548;color:#fff}',
      '#devPanel .world{color:#ffaa66;font-size:10px;margin-bottom:6px}',
      '#devPanel .min{cursor:pointer;float:right;color:#7fb6ff;font-size:14px;line-height:1}',
      '#devPanel.collapsed .body{display:none}'
    ].join('\n');
    document.head.appendChild(s);
  }

  function _slider(label, min, max, step, getValue, setValue){
    const wrap = document.createElement('label');
    const lab = document.createElement('span'); lab.textContent = label;
    const val = document.createElement('span'); val.className = 'val';
    val.textContent = (+getValue()).toFixed(step < 0.01 ? 3 : 2);
    wrap.appendChild(lab); wrap.appendChild(val);
    const slider = document.createElement('input');
    slider.type = 'range'; slider.min = min; slider.max = max; slider.step = step;
    slider.value = getValue();
    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      setValue(v);
      val.textContent = v.toFixed(step < 0.01 ? 3 : 2);
    });
    const container = document.createElement('div');
    container.appendChild(wrap); container.appendChild(slider);
    // Public update so the panel can refresh after a world-switch
    container._refresh = () => {
      slider.value = getValue();
      val.textContent = (+getValue()).toFixed(step < 0.01 ? 3 : 2);
    };
    return container;
  }

  function _renderPanel(){
    const p = document.createElement('div');
    p.id = 'devPanel';
    p.innerHTML = '<h3>SRC dev panel <span class="min">_</span></h3><div class="body"></div>';
    const body = p.querySelector('.body');
    const worldRow = document.createElement('div');
    worldRow.className = 'world';
    worldRow.textContent = 'world: '+ (window.activeWorld||'?');
    body.appendChild(worldRow);

    // Group: Renderer
    const g0 = document.createElement('div'); g0.className = 'group';
    g0.innerHTML = '<div style="color:#7fb6ff;font-size:10px;letter-spacing:1px;margin-bottom:2px">RENDER</div>';
    const exposureSlider = _slider('Exposure', 0.3, 2.2, 0.01,
      () => window.renderer.toneMappingExposure,
      v => { window.renderer.toneMappingExposure = v; }
    );
    g0.appendChild(exposureSlider);
    body.appendChild(g0);

    // Group: Bloom
    const g1 = document.createElement('div'); g1.className = 'group';
    g1.innerHTML = '<div style="color:#7fb6ff;font-size:10px;letter-spacing:1px;margin-bottom:2px">BLOOM</div>';
    const bloomThresh = _slider('Threshold', 0.0, 1.2, 0.01,
      () => window._postfx.matExtract.uniforms.threshold.value,
      v => { window._postfx.matExtract.uniforms.threshold.value = v; }
    );
    const bloomStr = _slider('Strength', 0.0, 2.0, 0.01,
      () => window._postfx.matComposite.uniforms.strength.value,
      v => { window._postfx.matComposite.uniforms.strength.value = v; }
    );
    g1.appendChild(bloomThresh); g1.appendChild(bloomStr);
    body.appendChild(g1);

    // Group: Atmosphere
    const g2 = document.createElement('div'); g2.className = 'group';
    g2.innerHTML = '<div style="color:#7fb6ff;font-size:10px;letter-spacing:1px;margin-bottom:2px">ATMOSPHERE</div>';
    const u = () => window._atmo.matCompositeExt.uniforms;
    const godS = _slider('Godrays', 0.0, 1.5, 0.01,
      () => u().godrayStrength.value,
      v => { u().godrayStrength.value = v; }
    );
    const hazeS = _slider('Haze', 0.0, 0.6, 0.01,
      () => u().hazeStrength.value,
      v => { u().hazeStrength.value = v; }
    );
    const hazeY = _slider('Haze Y', 0.30, 0.80, 0.01,
      () => u().hazeY.value,
      v => { u().hazeY.value = v; }
    );
    const grade = _slider('Grade', 0.0, 0.4, 0.01,
      () => u().gradeAmount.value,
      v => { u().gradeAmount.value = v; }
    );
    const vign = _slider('Vignette', 0.0, 1.2, 0.01,
      () => u().vignette.value,
      v => { u().vignette.value = v; }
    );
    // Cinematic camera filters (Option D-C)
    const caS = _slider('Chrom-Ab', 0.0, 0.020, 0.0001,
      () => u().caStrength.value,
      v => { u().caStrength.value = v; }
    );
    const grainS = _slider('Film Grain', 0.0, 0.10, 0.001,
      () => u().grainAmount.value,
      v => { u().grainAmount.value = v; }
    );
    g2.appendChild(godS); g2.appendChild(hazeS); g2.appendChild(hazeY);
    g2.appendChild(grade); g2.appendChild(vign);
    g2.appendChild(caS); g2.appendChild(grainS);
    body.appendChild(g2);

    // Actions
    const actions = document.createElement('div');
    actions.style.marginTop = '6px';
    actions.innerHTML = '';
    const btnPrint = document.createElement('button');
    btnPrint.textContent = 'Print Config';
    btnPrint.addEventListener('click', () => {
      const w = window.activeWorld || '?';
      const cfg = {
        world: w,
        exposure: +window.renderer.toneMappingExposure.toFixed(3),
        bloom: {
          threshold: +window._postfx.matExtract.uniforms.threshold.value.toFixed(3),
          strength:  +window._postfx.matComposite.uniforms.strength.value.toFixed(3)
        },
        atmosphere: {
          godrays:  +u().godrayStrength.value.toFixed(3),
          hazeStr:  +u().hazeStrength.value.toFixed(3),
          hazeY:    +u().hazeY.value.toFixed(3),
          grade:    +u().gradeAmount.value.toFixed(3),
          vignette: +u().vignette.value.toFixed(3)
        }
      };
      console.log('[SRC dev-panel]', JSON.stringify(cfg, null, 2));
    });
    actions.appendChild(btnPrint);

    const btnRebake = document.createElement('button');
    btnRebake.textContent = 'Rebake Env';
    btnRebake.addEventListener('click', () => {
      if(typeof window._rebakeSceneEnv === 'function'){
        window._rebakeSceneEnv();
        console.log('[SRC dev-panel] env rebaked');
      } else {
        console.warn('[SRC dev-panel] no _rebakeSceneEnv (mobile or missing module)');
      }
    });
    actions.appendChild(btnRebake);

    const btnFps = document.createElement('button');
    btnFps.textContent = 'FPS';
    btnFps.addEventListener('click', () => {
      const ov = document.getElementById('fpsOverlay');
      if(ov) ov.style.display = (ov.style.display === 'block' ? 'none' : 'block');
    });
    actions.appendChild(btnFps);

    body.appendChild(actions);

    // Collapse toggle (header underscore)
    p.querySelector('.min').addEventListener('click', e => {
      e.stopPropagation();
      p.classList.toggle('collapsed');
      p.querySelector('.min').textContent = p.classList.contains('collapsed') ? '+' : '_';
    });

    document.body.appendChild(p);

    // Refresh sliders + world readout when active world changes. The
    // game emits no formal event for this, but buildScene() is the only
    // path that mutates activeWorld so we poll once per second (cheap).
    let _lastWorld = window.activeWorld;
    setInterval(() => {
      if(window.activeWorld !== _lastWorld){
        _lastWorld = window.activeWorld;
        worldRow.textContent = 'world: '+ (window.activeWorld||'?');
        // Refresh slider values to match the new world's tune
        [exposureSlider, bloomThresh, bloomStr, godS, hazeS, hazeY, grade, vign]
          .forEach(s => s._refresh && s._refresh());
      }
    }, 1000);
  }
})();
