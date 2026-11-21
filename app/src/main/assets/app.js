// Mobile robot controller. The page talks to Kotlin through the Android bridge (Bluetooth, voice).
// Protocol (lines end with \n): S,b,sh,e,wp,wr,gr  D,left,right  A,1/A,0  X  R   -100..100
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var A = window.Android || null;
  var connected = false, locked = false, autoOn = false, sel = '';
  var held = [0, 0, 0, 0, 0, 0], inv = [0, 0, 0, 0, 0, 0];
  var drv = { l: 0, r: 0, on: false }, timer = null, autoTimer = null, voiceTimer = null;
  try { inv = JSON.parse(localStorage.getItem('inv') || '[0,0,0,0,0,0]'); } catch (e) {}

  function send(s) { if (A && connected) A.write(s + '\n'); }
  function chip(id, txt, cls) { var e = $(id); e.textContent = txt; e.className = 'chip' + (cls ? ' ' + cls : ''); }
  function clamp(v) { return Math.max(-100, Math.min(100, Math.round(v))); }

  // ---------- joints ----------
  var J = [
    { n: 'Base', neg: 'Left', pos: 'Right' }, { n: 'Shoulder', neg: 'Down', pos: 'Up' },
    { n: 'Elbow', neg: 'Down', pos: 'Up' }, { n: 'Wrist', neg: 'Down', pos: 'Up' },
    { n: 'Roll', neg: 'Left', pos: 'Right' }, { n: 'Gripper', neg: 'Close', pos: 'Open' }
  ];
  var box = $('joints');
  J.forEach(function (j, i) {
    var d = document.createElement('div'); d.className = 'joint';
    d.innerHTML = '<b>' + j.n + '</b><button data-i="' + i + '" data-d="-1">' + j.neg + '</button>' +
      '<button data-i="' + i + '" data-d="1">' + j.pos + '</button>' +
      '<label><input type="checkbox" data-v="' + i + '"' + (inv[i] ? ' checked' : '') + '> invert</label>';
    box.appendChild(d);
  });
  box.addEventListener('change', function (e) {
    var v = e.target.getAttribute('data-v'); if (v === null) return;
    inv[+v] = e.target.checked ? 1 : 0; try { localStorage.setItem('inv', JSON.stringify(inv)); } catch (x) {}
  });
  function press(e, down) {
    var b = e.target.closest('button[data-i]'); if (!b || locked) return;
    e.preventDefault();
    var i = +b.getAttribute('data-i');
    held[i] = down ? +b.getAttribute('data-d') : 0;
    if (down) cancelAuto();
    loop();
  }
  ['touchstart', 'mousedown'].forEach(function (t) { box.addEventListener(t, function (e) { press(e, true); }, { passive: false }); });
  ['touchend', 'touchcancel', 'mouseup', 'mouseleave'].forEach(function (t) { box.addEventListener(t, function (e) { press(e, false); }, { passive: false }); });

  function armVel() {
    var sp = +$('aspd').value, v = [];
    for (var i = 0; i < 6; i++) v.push(clamp(held[i] * (inv[i] ? -1 : 1) * sp));
    return v;
  }
  // one sender at 60 ms. Frames stop only after a few zero frames
  var zeros = 0;
  function loop() {
    if (timer) return;
    timer = setInterval(function () {
      if (locked) { stopLoop(); return; }
      var v = armVel(), any = v.some(function (x) { return x !== 0; });
      if (any) { send('S,' + v.join(',')); zeros = 0; }
      else if (zeros < 3) { send('S,0,0,0,0,0,0'); zeros++; }
      if (drv.on) send('D,' + drv.l + ',' + drv.r);
      else if (drv.z < 3) { send('D,0,0'); drv.z++; }
      if (!any && !drv.on && zeros >= 3 && drv.z >= 3) stopLoop();
    }, 60);
  }
  function stopLoop() { if (timer) { clearInterval(timer); timer = null; } }

  // ---------- drive joystick ----------
  var joy = $('joy'), knob = $('knob'), R = 110;
  function joyMove(e) {
    if (locked) return;
    var t = e.touches ? e.touches[0] : e, r = joy.getBoundingClientRect();
    var x = (t.clientX - r.left - R) / R, y = -(t.clientY - r.top - R) / R;
    var m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; }
    knob.style.left = (70 + x * 70) + 'px'; knob.style.top = (70 - y * 70) + 'px';
    if (Math.abs(x) < 0.12) x = 0; if (Math.abs(y) < 0.12) y = 0;
    var s = +$('spd').value / 100;
    var l = y + x, rr = y - x, k = Math.max(1, Math.abs(l), Math.abs(rr));
    drv.l = clamp(l / k * 100 * s); drv.r = clamp(rr / k * 100 * s);
    if (!drv.on) { cancelAuto(); drv.on = true; }
    drv.z = 0; loop(); e.preventDefault();
  }
  function joyEnd() { drv.on = false; drv.l = drv.r = 0; drv.z = 0; knob.style.left = '70px'; knob.style.top = '70px'; loop(); }
  drv.z = 3;
  ['touchstart', 'touchmove'].forEach(function (t) { joy.addEventListener(t, joyMove, { passive: false }); });
  ['touchend', 'touchcancel'].forEach(function (t) { joy.addEventListener(t, joyEnd); });
  joy.addEventListener('mousedown', function (e) { joyMove(e); var mv = joyMove; document.addEventListener('mousemove', mv); document.addEventListener('mouseup', function up() { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); joyEnd(); }); });

  // ---------- auto mode (obstacle avoidance) ----------
  function setAuto(on) {
    autoOn = on; $('auto').textContent = 'AUTO: ' + (on ? 'on' : 'off'); $('auto').className = on ? 'on' : '';
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
    if (on) { send('A,1'); autoTimer = setInterval(function () { send('A,1'); }, 200); }
    else { send('A,0'); send('A,0'); }
  }
  function cancelAuto() { if (autoOn) setAuto(false); }
  $('auto').onclick = function () { if (!locked) setAuto(!autoOn); };

  // ---------- emergency stop ----------
  function stopAll() {
    held = [0, 0, 0, 0, 0, 0]; drv.on = false; drv.l = drv.r = 0; drv.z = 3; zeros = 3;
    stopLoop(); if (voiceTimer) { clearInterval(voiceTimer); voiceTimer = null; }
    autoOn = false; if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
    $('auto').textContent = 'AUTO: off'; $('auto').className = '';
  }
  function estop() {
    stopAll(); locked = true; $('lock').classList.remove('hide');
    if (A) A.vibrate(300);
    var n = 0; var t = setInterval(function () { send('X'); if (++n >= 4) clearInterval(t); }, 80);
  }
  $('estop').onclick = estop;
  $('unlock').onclick = function () { locked = false; $('lock').classList.add('hide'); };
  document.addEventListener('visibilitychange', function () { if (document.hidden && connected) { stopAll(); send('X'); } });
  $('home').onclick = function () { if (!locked) { cancelAuto(); send('R'); } };

  // ---------- tabs ----------
  document.querySelector('nav').addEventListener('click', function (e) {
    var t = e.target.getAttribute('data-t'); if (!t) return;
    [].forEach.call(document.querySelectorAll('nav button'), function (b) { b.classList.toggle('on', b === e.target); });
    [].forEach.call(document.querySelectorAll('.tab'), function (s) { s.classList.toggle('on', s.id === t); });
  });

  // ---------- camera ----------
  var camOn = false;
  $('camBtn').onclick = function () {
    camOn = !camOn; var im = $('cam');
    if (camOn) im.src = 'http://192.168.4.1/stream?' + Date.now(); else { im.removeAttribute('src'); }
  };

  // ---------- Bluetooth ----------
  function fillDevices() {
    if (!A) return;
    if (!A.hasPermission()) { A.requestPermission(); return; }
    var list = []; try { list = JSON.parse(A.listDevices()); } catch (e) {}
    var s = $('dev'); s.innerHTML = '';
    list.forEach(function (d) { var o = document.createElement('option'); o.value = d.mac; o.textContent = d.name; s.appendChild(o); });
    var last = localStorage.getItem('mac'); if (last) s.value = last;
  }
  $('conn').onclick = function () {
    if (!A) return;
    if (connected) { A.disconnect(); return; }
    var mac = $('dev').value; if (!mac) { chip('st', 'pair the HC-05 first', 'warn'); return; }
    try { localStorage.setItem('mac', mac); } catch (e) {}
    A.connect(mac);
  };
  window.onBtPerm = function (ok) { if (ok) fillDevices(); else chip('st', 'permission denied', 'bad'); };
  window.onBtState = function (st, msg) {
    connected = st === 'connected';
    chip('st', connected ? 'connected' : (st === 'connecting' ? 'connecting...' : (msg || st)), connected ? 'ok' : (st === 'error' ? 'bad' : ''));
    $('conn').textContent = connected ? 'Disconnect' : 'Connect';
    if (!connected) stopAll();
  };
  window.onBtLine = function (line) {
    if (line.indexOf('ERR') === 0) { chip('err', line, 'bad'); if (A) A.vibrate(150); setTimeout(function () { $('err').className = 'chip hide'; }, 4000); }
    else if (line.indexOf('MODE,') === 0) {
      var a = line.indexOf('AUTO') > 0; chip('mode', a ? 'AUTO' : 'MAN', a ? 'ok' : '');
      if (!a && autoOn) setAuto(false);
    } else if (line.indexOf('DST,') === 0) chip('dist', line.slice(4).replace(',', '  ') + (line.indexOf('L') < 0 ? ' cm' : ''), '');
  };

  // ---------- voice: part + direction ----------
  function norm(s) {
    return s.toLowerCase().replace(/[ً-ٟ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[^a-z؀-ۿ0-9 ]/g, ' ');
  }
  var PARTS = {
    roll: ['roll', 'rotate', 'دوران', 'لف'], base: ['base', 'قاعده'], shoulder: ['shoulder', 'كتف'], elbow: ['elbow', 'كوع'],
    wrist: ['wrist', 'رسغ', 'معصم'], grip: ['hand', 'grip', 'gripper', 'claw', 'ايد', 'يد', 'كماشه'], car: ['car', 'robot', 'عربيه', 'روبوت']
  };
  var DIRS = {
    up: ['up', 'raise', 'فوق', 'اطلع', 'ارفع', 'اعلي'], down: ['down', 'lower', 'تحت', 'انزل', 'وطي'],
    left: ['left', 'شمال', 'يسار'], right: ['right', 'يمين'], open: ['open', 'افتح', 'فتح'], close: ['close', 'اقفل', 'قفل'],
    forward: ['forward', 'ahead', 'قدام', 'امام'], back: ['back', 'backward', 'ورا', 'خلف']
  };
  var OK = { base: ['left', 'right'], shoulder: ['up', 'down'], elbow: ['up', 'down'], wrist: ['up', 'down'], roll: ['left', 'right'], grip: ['open', 'close'], car: ['forward', 'back', 'left', 'right'] };
  var IDX = { base: 0, shoulder: 1, elbow: 2, wrist: 3, roll: 4, grip: 5 };
  var SIGN = { left: -1, right: 1, down: -1, up: 1, close: -1, open: 1 };
  var NAME = { base: 'The base', shoulder: 'The shoulder', elbow: 'The elbow', wrist: 'The wrist', roll: 'The roll', grip: 'The hand', car: 'The car' };
  function has(tokens, words) { return tokens.some(function (t) { return words.indexOf(t.replace(/^ال/, '')) >= 0 || words.indexOf(t) >= 0; }); }
  function find(tokens, map) { for (var k in map) if (has(tokens, map[k])) return k; return ''; }

  // returns {ok, msg, run}
  function parseVoice(text) {
    var tk = norm(text).split(/\s+/).filter(Boolean);
    if (!tk.length) return { ok: false, msg: 'nothing heard' };
    if (has(tk, ['stop', 'وقف', 'قف', 'استوب'])) return { ok: true, msg: 'stop', run: estop };
    if (has(tk, ['home', 'رجع', 'ارجع', 'بيت'])) return { ok: true, msg: 'arm home', run: function () { cancelAuto(); send('R'); } };
    if (has(tk, ['auto', 'اوتو', 'ذاتي', 'تلقائي'])) return { ok: true, msg: 'auto on', run: function () { setAuto(true); } };
    if (has(tk, ['manual', 'يدوي'])) return { ok: true, msg: 'manual', run: function () { setAuto(false); } };
    var part = find(tk, PARTS), dir = find(tk, DIRS);
    if (has(tk, ['select', 'choose', 'اختار', 'اختر']) && part) return { ok: true, msg: 'selected ' + part, run: function () { sel = part; chip('sel', 'part: ' + part); } };
    if (!part && sel) part = sel;
    if (!part) return { ok: false, msg: 'which part? (base, shoulder, elbow, wrist, roll, hand, car)' };
    if (!dir) return { ok: false, msg: NAME[part] + ' needs a direction: ' + OK[part].join(' / ') };
    if (OK[part].indexOf(dir) < 0) return { ok: false, msg: NAME[part] + ' moves ' + OK[part].join(' / ') + ' only' };
    var ms = has(tk, ['little', 'شويه']) ? 250 : (has(tk, ['much', 'كتير', 'كثير']) ? 1000 : 500);
    var sp = has(tk, ['slow', 'بطيء']) ? 40 : (has(tk, ['fast', 'سريع']) ? 80 : 60);
    return { ok: true, msg: part + ' ' + dir + ' ' + ms + ' ms', run: function () { timed(part, dir, ms, sp); } };
  }
  function timed(part, dir, ms, sp) {
    if (locked) return;
    cancelAuto(); if (voiceTimer) clearInterval(voiceTimer);
    var f;
    if (part === 'car') {
      var l = { forward: sp, back: -sp, left: -sp, right: sp }[dir], r = { forward: sp, back: -sp, left: sp, right: -sp }[dir];
      f = function () { send('D,' + l + ',' + r); };
    } else {
      var v = [0, 0, 0, 0, 0, 0]; v[IDX[part]] = clamp(SIGN[dir] * (inv[IDX[part]] ? -1 : 1) * sp);
      f = function () { send('S,' + v.join(',')); };
    }
    var t0 = Date.now();
    voiceTimer = setInterval(function () {
      if (locked || Date.now() - t0 >= ms) {
        clearInterval(voiceTimer); voiceTimer = null;
        if (part === 'car') { send('D,0,0'); send('D,0,0'); } else { send('S,0,0,0,0,0,0'); send('S,0,0,0,0,0,0'); }
        return;
      }
      f();
    }, 60);
  }
  window._parseVoice = parseVoice;
  function heard(txt, cls) { var h = $('heard'); h.textContent = txt; h.className = cls || ''; }
  window.onVoice = function (list) {
    var first = null;
    for (var i = 0; i < list.length; i++) {
      var p = parseVoice(list[i]); if (!first) first = { t: list[i], p: p };
      if (p.ok) { heard('Heard: "' + list[i] + '" -> ' + p.msg, 'ok'); p.run(); return; }
    }
    heard('Heard: "' + (first ? first.t : '') + '" -> ' + (first ? first.p.msg : 'nothing'), 'bad'); if (A) A.vibrate(120);
  };
  window.onVoiceState = function (s, code) { if (s === 'error') heard('Voice error ' + code, 'bad'); else heard(s); };
  window.onMicPerm = function (ok) { if (ok) $('mic').click(); else heard('microphone permission denied', 'bad'); };
  $('mic').onclick = function () {
    if (!A) return; if (locked) return;
    if (!A.hasMic()) { A.requestMic(); return; }
    A.startVoice($('lang').value);
  };
  $('help').innerHTML = 'Parts: base/قاعدة, shoulder/كتف, elbow/كوع, wrist/رسغ, roll/لف, hand/ايد, car/عربية<br>' +
    'Directions: up/فوق, down/تحت, left/شمال, right/يمين, open/افتح, close/اقفل, forward/قدام, back/ورا<br>' +
    'Extra: select/اختار + part, little/شوية, much/كتير, slow/بطيء, fast/سريع, stop/وقف, home/رجع, auto/اوتو, manual/يدوي';

  fillDevices();
})();
