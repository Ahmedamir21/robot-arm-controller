"use strict";
var NAMES = ["Gripper", "Wrist pitch", "Wrist rotate", "Elbow", "Shoulder", "Base"];
var MIN = [30, 20, 20, 20, 20, 20];
var MAX = [120, 160, 160, 160, 160, 160];
var $ = function (s) { return document.querySelector(s); };
function store(k, v) {
  try { if (v === undefined) return JSON.parse(localStorage.getItem(k)); localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
  return null;
}

// ---------- الاتصال: جسر أندرويد، أو وضع تجريبي على اللابتوب ----------
var hasAndroid = typeof Android !== "undefined";
var demo = { sent: [] };
var Link = {
  devices: function () {
    if (!hasAndroid) return [{ name: "demo HC-05", mac: "00:00:00:00:00:00" }];
    if (!Android.hasPermission()) { Android.requestPermission(); return null; }
    return JSON.parse(Android.listDevices());
  },
  connect: function (mac) {
    if (hasAndroid) Android.connect(mac);
    else setTimeout(function () { window.onBtState("connected", "demo"); }, 100);
  },
  disconnect: function () { if (hasAndroid) Android.disconnect(); else window.onBtState("disconnected", ""); },
  write: function (s) {
    if (hasAndroid) Android.write(s);
    else {
      demo.sent.push(s.trim());
      if (s.trim() === "READ") setTimeout(function () { window.onBtLine("POS 90,91,92,93,94,95"); }, 30);
      if (s.trim() === "STATUS") setTimeout(function () { window.onBtLine("STATUS mode=JOY estop=0 pots=OK ir=1"); }, 30);
    }
  },
  vibrate: function (ms) { if (hasAndroid) Android.vibrate(ms); }
};

var connected = false, wantConn = false, mode = "?", estop = false, pos = null;
var devs = [], pending = 0, lastLine = "";

function log(t) {
  var el = $("#log");
  el.textContent += t + "\n";
  var l = el.textContent.split("\n");
  if (l.length > 60) el.textContent = l.slice(-50).join("\n");
  el.scrollTop = el.scrollHeight;
}
function refreshUI(msg) {
  $("#dot").className = connected ? "on" : "";
  $("#st").textContent = msg || (connected ? ("mode " + mode + (estop ? " | STOP" : "")) : "not connected");
  $("#estop").classList.toggle("active", estop);
  $("#conn").textContent = connected ? "Disconnect" : "Connect";
}
function send(line, droppable) {
  if (!connected) return;
  if (droppable && pending > 2) return;
  pending++;
  Link.write(line + "\n");
  setTimeout(function () { pending = Math.max(0, pending - 1); }, 40);   // 9600 baud: حوالي 35ms للفريم
}

window.onBtState = function (st, msg) {
  if (st === "connected") { connected = true; mode = "?"; estop = false; log("connected " + msg); refreshUI(); Link.vibrate(40); setTimeout(function () { send("PING"); send("STATUS"); }, 300); }
  else if (st === "connecting") { refreshUI("connecting..."); }
  else {
    connected = false; log(st + (msg ? ": " + msg : "")); refreshUI(st === "error" ? msg : null);
    if (wantConn && $("#auto").checked) setTimeout(connect, 3000);
  }
};
window.onBtPerm = function (ok) { log(ok ? "permission granted" : "bluetooth permission denied"); if (ok) loadDevices(); };
window.onBtLine = function (l) {
  if (l.indexOf("POS ") === 0) {
    var a = l.slice(4).split(",").map(Number);
    if (a.length === 6 && a.every(function (v) { return !isNaN(v); })) { pos = a; showPos(); }
    return;
  }
  var m = l.match(/^STATUS mode=(\w+) estop=(\d)/);
  if (m) {
    mode = m[1]; estop = m[2] === "1";
    var irm = l.match(/ir=(\d)/);
    $("#ir").classList.toggle("on", !!irm && irm[1] === "1");
    refreshUI();
    return;
  }
  log("< " + l);
};

function loadDevices() {
  var d = Link.devices();
  if (d === null) { log("allow bluetooth permission, then press Refresh"); return; }
  devs = d;
  var sel = $("#dev");
  sel.innerHTML = "";
  d.forEach(function (x) { var o = document.createElement("option"); o.value = x.mac; o.textContent = x.name; sel.appendChild(o); });
  var last = store("lastMac");
  if (last && d.some(function (x) { return x.mac === last; })) sel.value = last;
  if (!d.length) log("no paired devices: pair HC-05 first from Android Bluetooth settings (PIN 1234 or 0000)");
}
function connect() {
  var mac = $("#dev").value;
  if (!mac) { log("pick a paired device first"); return; }
  store("lastMac", mac);
  wantConn = true;
  Link.connect(mac);
}
$("#conn").onclick = function () {
  if (connected) { wantConn = false; Link.disconnect(); } else connect();
};
$("#refresh").onclick = loadDevices;

// ---------- المدخلات ----------
function makeStick(sel) {
  var el = $(sel), knob = el.querySelector(".knob"), s = { x: 0, y: 0 }, active = false;
  function upd(e) {
    var r = el.getBoundingClientRect(), R = r.width / 2;
    var dx = (e.clientX - (r.left + R)) / R, dy = (e.clientY - (r.top + R)) / R, l = Math.hypot(dx, dy);
    if (l > 1) { dx /= l; dy /= l; }
    s.x = Math.round(dx * 100); s.y = Math.round(-dy * 100);
    knob.style.transform = "translate(" + (dx * R * 0.74) + "px," + (dy * R * 0.74) + "px)";
  }
  function end() { active = false; s.x = 0; s.y = 0; knob.style.transform = ""; }
  el.addEventListener("pointerdown", function (e) { active = true; el.setPointerCapture(e.pointerId); upd(e); });
  el.addEventListener("pointermove", function (e) { if (active) upd(e); });
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
  return s;
}
var L = makeStick("#stickL"), Rr = makeStick("#stickR");
var hold = { rot: 0, grip: 0 };
function holdBtn(sel, key, val) {
  var b = $(sel);
  b.addEventListener("pointerdown", function (e) { b.setPointerCapture(e.pointerId); hold[key] = val; });
  var up = function () { hold[key] = 0; };
  b.addEventListener("pointerup", up); b.addEventListener("pointercancel", up);
}
holdBtn("#rotL", "rot", -1); holdBtn("#rotR", "rot", 1);
holdBtn("#gClose", "grip", -1); holdBtn("#gOpen", "grip", 1);

var inv = store("inv") || {};
function inputs() {
  var sg = function (n) { return inv[n] ? -1 : 1; };
  // ترتيب الفريم: base, shoulder, elbow, wrist pitch, wrist rotation, gripper (زي أبلكيشن يوسف)
  return [L.x * sg("base"), L.y * sg("shoulder"), Rr.y * sg("elbow"), Rr.x * sg("wrist"), hold.rot, hold.grip];
}

// ---------- الأوامر ----------
function ensureJoy() { if (mode !== "JOY") { send("MODE:JOY"); mode = "JOY"; refreshUI(); } }
function doEstop() {
  seqStop();
  estop = true; refreshUI(); Link.vibrate(120);
  send("X"); setTimeout(function () { send("X"); }, 60); setTimeout(function () { send("X"); }, 120);
  log("EMERGENCY STOP");
}
function doReset() { estop = false; send("R"); log("reset"); refreshUI(); }
function doHome() { if (estop) return; seqStop(); send("HOME"); mode = "CMD"; refreshUI(); }
$("#estop").onclick = doEstop;
$("#reset").onclick = doReset;
$("#mPot").onclick = function () { if (!estop) { seqStop(); send("MODE:POT"); mode = "POT"; refreshUI(); } };
$("#mJoy").onclick = function () { if (!estop) { send("MODE:JOY"); mode = "JOY"; refreshUI(); } };
$("#mHome").onclick = doHome;
$("#stopb").onclick = function () { seqStop(); send("STOP"); mode = "CMD"; refreshUI(); };
$("#speed").oninput = function (e) { $("#spv").textContent = e.target.value; };

var wasActive = false;
setInterval(function () {
  if (!connected || estop) return;
  var f = inputs(), act = f.some(function (v) { return v !== 0; });
  if (act || wasActive) { ensureJoy(); send("S," + f.join(",") + "," + $("#speed").value, true); }
  wasActive = act;
}, 100);
setInterval(function () { if (connected && !estop) send("READ", true); }, 600);
document.addEventListener("visibilitychange", function () {
  if (document.hidden) {
    L.x = L.y = Rr.x = Rr.y = 0; hold.rot = hold.grip = 0;
    if (connected) { seqStop(); send("STOP"); }     // الأبلكيشن راح في الخلفية: نثبّت الدراع
  }
});

// ---------- مفاصل ----------
var jw = $("#joints"), sliders = [], dragAt = [0, 0, 0, 0, 0, 0];
for (var i = 5; i >= 0; i--) (function (i) {
  var row = document.createElement("div");
  row.className = "joint";
  row.innerHTML = "<span>" + (i + 1) + " " + NAMES[i] + '</span><input type="range" min="' + MIN[i] + '" max="' + MAX[i] + '" value="90"><span>--</span>';
  var inp = row.children[1], val = row.children[2];
  inp.addEventListener("input", function () {
    dragAt[i] = Date.now(); val.textContent = inp.value;
    if (estop) return;
    send("S" + (i + 1) + ":" + inp.value, true); mode = "CMD";
  });
  jw.appendChild(row); sliders[i] = { inp: inp, val: val };
})(i);
function showPos() {
  for (var i = 0; i < 6; i++) {
    sliders[i].val.textContent = pos[i];
    if (Date.now() - dragAt[i] > 800) sliders[i].inp.value = pos[i];
  }
  drawArm();
}

// ---------- أوضاع وتسلسل ----------
var poses = store("poses") || {}, seq = store("seq") || [], playing = false, seqTimer = null, seqIdx = 0;
function savePoses() { store("poses", poses); store("seq", seq); }
function renderPoses() {
  var box = $("#poses"); box.innerHTML = "";
  Object.keys(poses).forEach(function (n) {
    var d = document.createElement("div"); d.className = "item";
    var b = document.createElement("b"); b.textContent = n;
    var go = document.createElement("button"); go.textContent = "Go";
    go.onclick = function () { if (!estop) { send("ALL:" + poses[n].join(",")); mode = "CMD"; refreshUI(); } };
    var add = document.createElement("button"); add.textContent = "+seq";
    add.onclick = function () { seq.push(n); savePoses(); renderSeq(); };
    var del = document.createElement("button"); del.textContent = "x";
    del.onclick = function () { delete poses[n]; savePoses(); renderPoses(); };
    d.appendChild(b); d.appendChild(go); d.appendChild(add); d.appendChild(del); box.appendChild(d);
  });
}
function renderSeq() {
  var box = $("#seq"); box.innerHTML = "";
  seq.forEach(function (n, k) {
    var d = document.createElement("div"); d.className = "item";
    d.innerHTML = "<b>" + (k + 1) + ". " + n + "</b>";
    var del = document.createElement("button"); del.textContent = "x";
    del.onclick = function () { seq.splice(k, 1); savePoses(); renderSeq(); };
    d.appendChild(del); box.appendChild(d);
  });
}
function seqStop() { playing = false; if (seqTimer) clearTimeout(seqTimer); seqTimer = null; motionStop(); chainStop(); }
function seqStep() {
  if (!playing || estop) return;
  if (seqIdx >= seq.length) { if ($("#sloop").checked && seq.length) seqIdx = 0; else { playing = false; return; } }
  var n = seq[seqIdx++];
  if (poses[n]) { send("ALL:" + poses[n].join(",")); mode = "CMD"; refreshUI(); }
  var d = Math.max(0.5, parseFloat($("#sdelay").value) || 2);
  seqTimer = setTimeout(seqStep, d * 1000);
}
$("#splay").onclick = function () { if (!seq.length || estop || !connected) return; seqStop(); playing = true; seqIdx = 0; seqStep(); };
$("#sstop").onclick = function () { seqStop(); send("STOP"); mode = "CMD"; refreshUI(); };
$("#sclear").onclick = function () { seq = []; savePoses(); renderSeq(); };
$("#psave").onclick = function () {
  var n = $("#pname").value.trim();
  if (!n) { log("type a pose name first"); return; }
  if (!pos) { log("no position yet: connect first"); return; }
  poses[n] = pos.slice(); savePoses(); $("#pname").value = ""; renderPoses();
};
$("#pexp").onclick = function () {
  var o = {};
  Object.keys(poses).forEach(function (n) { o[n] = {}; poses[n].forEach(function (a, i) { o[n][String(i + 1)] = a; }); });
  $("#pjson").value = JSON.stringify(o, null, 1);
};
$("#pimp").onclick = function () {
  try {
    var o = JSON.parse($("#pjson").value), c = 0;
    Object.keys(o).forEach(function (n) {
      var arr = [];
      for (var i = 1; i <= 6; i++) arr.push(o[n][String(i)] !== undefined ? o[n][String(i)] : (pos ? pos[i - 1] : 90));
      poses[n] = arr; c++;
    });
    savePoses(); renderPoses(); log("imported " + c + " poses");
  } catch (e) { log("bad json: " + e.message); }
};

// ---------- تبويبات وإعدادات ----------
document.querySelectorAll("#tabbar button").forEach(function (b) {
  b.onclick = function () {
    document.querySelectorAll("#tabbar button").forEach(function (x) { x.classList.toggle("on", x === b); });
    document.querySelectorAll(".pane").forEach(function (p) { p.classList.toggle("on", p.id === b.dataset.p); });
  };
});
document.querySelectorAll("[data-inv]").forEach(function (c) {
  c.checked = !!inv[c.dataset.inv];
  c.onchange = function () { inv[c.dataset.inv] = c.checked; store("inv", inv); };
});
var autoOn = store("auto"); $("#auto").checked = autoOn === null ? true : autoOn;
$("#auto").onchange = function () { store("auto", $("#auto").checked); };


// ---------- رسمة الدراع الحية ----------
function drawArm() {
  var p = pos || [90, 90, 90, 90, 90, 90], r = Math.PI / 180;
  var x = 70, y = 170, t = 0, pts = [x + "," + y];
  var links = [[62, p[4]], [52, p[3]], [28, p[1]]];
  for (var i = 0; i < 3; i++) {
    t += (links[i][1] - 90) * r;
    x += links[i][0] * Math.sin(t); y -= links[i][0] * Math.cos(t);
    pts.push(x.toFixed(1) + "," + y.toFixed(1));
  }
  $("#vArm").setAttribute("points", pts.join(" "));
  var open = (p[0] - 30) / 90 * 14, nx = Math.cos(t), ny = Math.sin(t), dx = Math.sin(t) * 16, dy = -Math.cos(t) * 16;
  [["#vG1", 1], ["#vG2", -1]].forEach(function (g) {
    var e = $(g[0]), sx = x + g[1] * nx * open, sy = y + g[1] * ny * open;
    e.setAttribute("x1", sx.toFixed(1)); e.setAttribute("y1", sy.toFixed(1));
    e.setAttribute("x2", (sx + dx).toFixed(1)); e.setAttribute("y2", (sy + dy).toFixed(1));
  });
  var b = (p[5] - 90) * r;
  $("#vBaseL").setAttribute("x2", (185 + 22 * Math.sin(b)).toFixed(1));
  $("#vBaseL").setAttribute("y2", (40 - 22 * Math.cos(b)).toFixed(1));
}

// ---------- الصوت (عربي / إنجليزي) ----------
var WORDS = {
  estop: ["emergency", "طوارئ"],
  stop: ["stop", "وقف", "قف", "استوب"],
  pick: ["pick", "امسك", "خد"],
  home: ["home", "بيت", "رجع", "ارجع"],
  up: ["up", "raise", "اطلع", "فوق", "ارفع"],
  down: ["down", "lower", "انزل", "تحت"],
  left: ["left", "شمال", "يسار"],
  right: ["right", "يمين"],
  grip_open: ["open", "افتح"],
  grip_close: ["close", "اقفل"],
  manual: ["manual", "pots", "يدوي"]
};
function norm(t) {
  return t.toLowerCase().replace(/[ً-ْ]/g, "").replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/[^\p{L}\p{N}\s]/gu, " ");
}
var LOOK = {};
Object.keys(WORDS).forEach(function (c) { WORDS[c].forEach(function (w) { LOOK[norm(w).trim()] = c; }); });
function matchCmd(text) {
  var found = norm(text).split(/\s+/).filter(function (t) { return LOOK[t]; }).map(function (t) { return LOOK[t]; });
  if (!found.length) return null;
  if (found.indexOf("estop") >= 0) return "estop";
  if (found.indexOf("stop") >= 0) return "stop";      // وقف ليها أولوية دايمًا
  return found[0];
}
function vlog(t) {
  var box = $("#vlog"), d = document.createElement("div");
  d.textContent = t; box.insertBefore(d, box.firstChild);
  while (box.children.length > 8) box.removeChild(box.lastChild);
}
var chainT = [];
function chainStop() { chainT.forEach(clearTimeout); chainT = []; }
function goPose(n) {
  if (!poses[n]) return false;
  send("ALL:" + poses[n].join(",")); mode = "CMD"; refreshUI(); return true;
}
function relMove(i, d) {
  if (!pos) { vlog("no position yet, wait for READ"); return; }
  var a = Math.max(MIN[i - 1], Math.min(MAX[i - 1], pos[i - 1] + d));
  send("S" + i + ":" + a); mode = "CMD"; refreshUI();
}
var FALLBACK = {
  up: function () { relMove(5, 15); }, down: function () { relMove(5, -15); },
  left: function () { relMove(6, -20); }, right: function () { relMove(6, 20); },
  grip_open: function () { relMove(1, 90); }, grip_close: function () { relMove(1, -90); }
};
function runCmd(c) {
  if (c === "estop") { doEstop(); return; }
  if (estop) { vlog("emergency stop is on: press RESET first"); return; }
  if (c === "stop") { seqStop(); send("STOP"); mode = "CMD"; refreshUI(); return; }
  if (c === "home") { doHome(); return; }
  if (c === "manual") { seqStop(); send("MODE:POT"); mode = "POT"; refreshUI(); return; }
  if (c === "pick") {
    var names = ["pick_ready", "grip_close", "pick_lift"];
    if (!names.every(function (n) { return poses[n]; })) { vlog("save poses pick_ready, grip_close, pick_lift first"); return; }
    chainStop();
    names.forEach(function (n, k) { chainT.push(setTimeout(function () { if (!estop) goPose(n); }, k * 2500)); });
    return;
  }
  if (goPose(c)) return;
  if (FALLBACK[c]) FALLBACK[c]();
}
function handleHeard(arr) {
  var cmd = null, txt = arr[0] || "";
  for (var i = 0; i < arr.length; i++) {
    var t = arr[i];
    if (norm(t).trim().split(/\s+/).length <= 4) { cmd = matchCmd(t); if (cmd) { txt = t; break; } }
  }
  vlog(txt + "  ->  " + (cmd || "not a command"));
  setStat(txt + "  ->  " + (cmd || "not a command"));
  if (cmd) runCmd(cmd);
}
var vlang = store("vlang") || "en-US";
function setStat(t) { document.querySelectorAll(".vstat").forEach(function (e) { e.textContent = t; }); }
document.querySelectorAll(".vlangsel").forEach(function (sel) {
  sel.value = vlang;
  sel.onchange = function () {
    vlang = sel.value; store("vlang", vlang);
    document.querySelectorAll(".vlangsel").forEach(function (x) { x.value = vlang; });
  };
});
function startMic() {
  if (!hasAndroid) { setStat("no microphone here (demo): type a command in Voice tab"); return; }
  if (!Android.hasMic()) { Android.requestMic(); return; }
  Android.startVoice(vlang);
}
document.querySelectorAll(".vmicbtn").forEach(function (b) { b.onclick = startMic; });
$("#vsend").onclick = function () {
  var t = $("#vtext").value.trim();
  if (t) { handleHeard([t]); $("#vtext").value = ""; }
};
window.onMicPerm = function (ok) { if (ok) Android.startVoice(vlang); else vlog("microphone permission denied"); };
window.onVoiceState = function (s, code) { setStat(s + (code ? " (" + code + ")" : "")); };
window.onVoice = function (arr) { handleHeard(arr); };

// ---------- تسجيل حركة وإعادتها ----------
var motions = store("motions") || {}, lastRec = [], recTimer = null, playT = [];
function saveMotions() { store("motions", motions); }
function motionStop() { playT.forEach(clearTimeout); playT = []; }
function playMotion(fr) {
  motionStop();
  if (!fr || !fr.length || estop || !connected) return;
  send("SPEED:" + $("#speed").value);
  mode = "CMD"; refreshUI();
  fr.forEach(function (f) { playT.push(setTimeout(function () { if (!estop) send("ALL:" + f.p.join(",")); }, f.t)); });
  playT.push(setTimeout(function () { if ($("#sloop").checked) playMotion(fr); }, fr[fr.length - 1].t + 800));
}
function renderMotions() {
  var box = $("#motions"); box.innerHTML = "";
  Object.keys(motions).forEach(function (n) {
    var d = document.createElement("div"); d.className = "item";
    var b = document.createElement("b"); b.textContent = n + " (" + motions[n].length + ")";
    var go = document.createElement("button"); go.textContent = "Play";
    go.onclick = function () { playMotion(motions[n]); };
    var del = document.createElement("button"); del.textContent = "x";
    del.onclick = function () { delete motions[n]; saveMotions(); renderMotions(); };
    d.appendChild(b); d.appendChild(go); d.appendChild(del); box.appendChild(d);
  });
}
$("#mrec").onclick = function () {
  if (!connected) { log("connect first"); return; }
  if (recTimer) return;
  lastRec = []; var t0 = Date.now();
  recTimer = setInterval(function () {
    if (pos) {
      var last = lastRec[lastRec.length - 1];
      if (!last || last.p.join() !== pos.join()) lastRec.push({ t: Date.now() - t0, p: pos.slice() });
    }
    send("READ", true);
  }, 300);
  $("#mst").textContent = "recording...";
};
$("#mstop").onclick = function () {
  if (recTimer) { clearInterval(recTimer); recTimer = null; }
  motionStop();
  $("#mst").textContent = lastRec.length + " frames";
};
$("#mplay").onclick = function () { playMotion(lastRec); };
$("#msave").onclick = function () {
  var n = $("#mname").value.trim();
  if (!n) { log("type a motion name first"); return; }
  if (!lastRec.length) { log("record something first"); return; }
  motions[n] = lastRec.slice(); saveMotions(); $("#mname").value = ""; renderMotions();
};

// ---------- حالة IR وثيم ----------
setInterval(function () { if (connected) send("STATUS", true); }, 1500);
function applyTheme(t) { document.documentElement.setAttribute("data-theme", t); }
var theme = store("theme") || "dark";
applyTheme(theme); $("#theme").value = theme;
$("#theme").onchange = function () { theme = $("#theme").value; store("theme", theme); applyTheme(theme); };

renderMotions(); drawArm();

renderPoses(); renderSeq(); refreshUI();
setTimeout(function () {
  loadDevices();
  if ($("#auto").checked && $("#dev").value && store("lastMac") === $("#dev").value) connect();
}, 400);
