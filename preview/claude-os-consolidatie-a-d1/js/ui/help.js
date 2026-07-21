// js/ui/help.js — keybinding-cheatsheet overlay (? of /-shortcut).
// Non-module script.
//
// Overlay toont alle keyboard-shortcuts gegroepeerd per categorie.
// Toggle: Shift+/ (= ?), of '/' alleen, of Escape om te sluiten.
// Sluiten kan ook door erbuiten te klikken.
//
// Keys-tabel hieronder is de single source of truth — als je een nieuwe
// shortcut in ui/input.js toevoegt, voeg 'm hier ook toe.

'use strict';

const HELP_BINDINGS = [
  { group: 'Rijden', keys: [
    ['↑ / W',          'Gas geven'],
    ['↓ / S',          'Remmen / achteruit'],
    ['← → / A D',      'Sturen'],
    ['Space',          'Handrem (drift) — of pauze buiten race'],
    ['N',              'Nitro'],
    ['H',              'Pit-stop (alleen op start/finish-rechte)'],
  ]},
  { group: 'Camera', keys: [
    ['C',              'Wissel camera-view (chase / heli / hood / bumper)'],
    ['V',              'Achteruitkijkspiegel aan/uit'],
  ]},
  { group: 'Game', keys: [
    ['P / Esc',        'Pauze tijdens race'],
    ['M',              'Geluid aan/uit'],
    ['L',              'Leaderboard volledig / compact'],
    ['Enter',          'Vanaf titel-scherm: doorgaan'],
  ]},
  { group: 'Controller (Xbox / PS / generic)', keys: [
    ['Left-stick / D-pad', 'Sturen (in race) · navigeren (in menu)'],
    ['RT / LT',            'Gas / Rem'],
    ['A · Cross',          'Nitro (race) · Bevestigen (menu)'],
    ['B · Circle',          'Drift / handrem (race) · Terug (menu)'],
    ['X · Square',         'Pit-stop'],
    ['Y · Triangle',       'Camera wisselen (race) · Help (menu)'],
    ['LB · L1',            'Spiegel · diff. lager (in select)'],
    ['RB · R1',            'Leaderboard · diff. hoger (in select)'],
    ['Start',              'Pauze (race) · Bevestigen (menu)'],
    ['Back · Share',       'Geluid aan/uit'],
    ['L3 (stick-klik)',    'Dag/nacht togglen'],
  ]},
  { group: 'Debug', keys: [
    ['?  /  /',        'Deze help-overlay'],
    ['Ctrl+Shift+E',   'Error-viewer (laatste 50 errors)'],
    ['Ctrl+Shift+P',   'Performance-overlay (FPS / memory / scene-stats)'],
    ['F3',             'FPS-teller in HUD aan/uit'],
  ]},
];

let _helpEl = null;

function _buildHelpOverlay(){
  const ov = document.createElement('div');
  ov.id = 'helpOverlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(8,8,14,.88);z-index:99997;display:none;flex-direction:column;align-items:center;justify-content:center;font-family:var(--font-body);padding:20px;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)';

  const panel = document.createElement('div');
  panel.style.cssText = 'position:relative;background:rgba(8,8,14,.96);border:1px solid var(--line-strong);border-radius:14px;padding:28px 32px;max-width:560px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 0 0 1px rgba(255,58,138,.18),0 20px 60px rgba(212,168,255,.18)';

  const title = document.createElement('div');
  title.style.cssText = 'font-family:var(--font-display);font-size:18px;font-weight:700;color:var(--text);letter-spacing:6px;text-align:center;margin-bottom:6px;text-shadow:-2px 0 rgba(255,58,138,.5),2px 0 rgba(0,224,255,.5),0 0 1px var(--text)';
  title.textContent = '⌨ KEYBOARD + 🎮 CONTROLLER';
  panel.appendChild(title);

  const sub = document.createElement('div');
  sub.style.cssText = 'font-family:var(--font-mono);font-size:10px;color:var(--text-dim);letter-spacing:3px;text-align:center;margin-bottom:22px;text-transform:uppercase';
  sub.textContent = 'Druk Esc, klik buiten of druk ? om te sluiten';
  panel.appendChild(sub);

  for (const grp of HELP_BINDINGS) {
    const gh = document.createElement('div');
    gh.style.cssText = 'font-family:var(--font-mono);font-size:10px;color:var(--peach);letter-spacing:4px;margin:14px 0 8px;border-bottom:1px solid var(--line);padding-bottom:4px;text-transform:uppercase';
    gh.textContent = grp.group.toUpperCase();
    panel.appendChild(gh);

    for (const [k, label] of grp.keys) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:14px;padding:6px 0;font-family:var(--font-body);font-size:13px;align-items:center';
      const kbd = document.createElement('span');
      kbd.style.cssText = 'flex:0 0 130px;font-family:var(--font-mono);font-size:11px;color:var(--blue);background:var(--surface);border:1px solid var(--line);border-radius:4px;padding:3px 8px;text-align:center;letter-spacing:1px';
      kbd.textContent = k;
      const desc = document.createElement('span');
      desc.style.cssText = 'flex:1;color:var(--text-mid)';
      desc.textContent = label;
      row.appendChild(kbd); row.appendChild(desc);
      panel.appendChild(row);
    }
  }

  ov.appendChild(panel);
  // Klik op overlay-achtergrond sluit; klik op panel zelf doet niets.
  ov.addEventListener('click', e => { if (e.target === ov) hideHelp(); });
  document.body.appendChild(ov);
  _helpEl = ov;
  return ov;
}

function showHelp(){
  if (!_helpEl) _buildHelpOverlay();
  _helpEl.style.display = 'flex';
}
function hideHelp(){
  if (_helpEl) _helpEl.style.display = 'none';
}
function toggleHelp(){
  if (_helpEl && _helpEl.style.display === 'flex') hideHelp();
  else showHelp();
}

// Keyboard shortcut: '?' (Shift+/) of '/'-only opent/sluit help.
// Esc sluit de overlay (zonder de pause-overlay te openen).
window.addEventListener('keydown', e => {
  // Negeer als gebruiker in een input typt
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  if (e.key === '?' || e.code === 'Slash') {
    e.preventDefault();
    toggleHelp();
    return;
  }
  if (e.code === 'Escape' && _helpEl && _helpEl.style.display === 'flex') {
    e.preventDefault();
    e.stopPropagation();
    hideHelp();
  }
}, true); // capture-phase zodat Escape niet eerst togglePause triggert

window.showHelp = showHelp;
window.hideHelp = hideHelp;
window.toggleHelp = toggleHelp;
