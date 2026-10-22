'use strict';
/* Studio host.
   One page that owns the mode rail, the header (title, status, the actions the active mode registers,
   Shortcuts), one iframe per mode (created the first time the mode is opened, then kept and only
   hidden), the media tray and the shared toast / dialog. The modes are the existing tool pages loaded
   with ?embed=1; they talk to this file through window.Studio (see ../shared/embed.js, the other half
   of the contract). A mode page that never registers (a page not converted yet) still works: it keeps
   its own header and the action area stays empty. */
(function () {
  var MODES = [
    { id: 'join',     dir: 'clips',    group: 'Video', label: 'Join',     title: 'Join clips',         icon: 'join',     accepts: ['video/*'] },
    { id: 'compare',  dir: 'video',    q: 'mode=compare', group: 'Video', label: 'Compare', title: 'Compare videos', icon: 'compare', accepts: ['video/*'] },
    { id: 'grid',     dir: 'video',    q: 'mode=grid',    group: 'Video', label: 'Grid',    title: 'Video grid',     icon: 'grid4',   accepts: ['video/*'] },
    { id: 'sheet',    dir: 'frames',   group: 'Video', label: 'Sheet',    title: 'Contact sheet',      icon: 'sheet',    accepts: ['image/*', 'video/*'] },
    { id: 'flipbook', dir: 'flipbook', group: 'Image', label: 'Flipbook', title: 'Flipbook previewer', icon: 'flipbook', accepts: ['image/*'] },
    { id: 'annotate', dir: 'annotate', group: 'Image', label: 'Annotate', title: 'Annotate',           icon: 'annotate', accepts: ['image/*'] },
    { id: 'textures', dir: 'textures', group: 'Image', label: 'Textures', title: 'Texture names',       icon: 'texture',  accepts: [] },
    { id: 'texgen',   dir: 'texgen',   group: 'Image', label: 'TexGen',   title: 'TexGen',             icon: 'sparkle',  accepts: ['image/*'] }
  ];
  var BY = {};
  MODES.forEach(function (m, i) { m.n = i + 1; m.def = m.accepts; m.state = 'new'; m.actions = []; m.status = ''; m.pending = []; BY[m.id] = m; });

  var LS = { mode: 'studio.mode', rail: 'studio.rail', tray: 'studio.tray' };
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function safe(fn, what) { try { return fn(); } catch (err) { if (window.console) console.error('Studio: ' + what, err); } }

  Kit.addIcons({ sidebar: 'M2.5 2.5h11v11h-11z M6.5 2.5v11' });

  var app = $('app'), railList = $('railList'), head = $('head'), titleEl = $('title'), statusEl = $('status'),
      actionsEl = $('actions'), headSep = head.querySelector('.sep'), framesEl = $('frames'), keysBtn = $('bKeys');
  var active = null;
  Kit.config({ stage: framesEl });

  /* ----------------------------------------------------------- file kinds */
  var VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|avi|ogv|mpe?g)$/i;
  var IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|tga|tiff?|exr|hdr|dds|psd|svg|avif)$/i;
  function kindOf(f) {
    var t = String(f.type || '').toLowerCase();
    if (t.indexOf('video/') === 0 || VIDEO_EXT.test(f.name || '')) return 'video';
    if (t.indexOf('image/') === 0 || IMAGE_EXT.test(f.name || '')) return 'image';
    return 'file';
  }
  /* a dropped folder arrives as a typeless File with no extension: every mode may take it, the mode decides */
  function isDir(f) { return !f.type && !/\.[^.\\\/ ]+$/.test(f.name || ''); }
  function matches(patterns, f) {
    var type = String(f.type || '').toLowerCase(), name = String(f.name || '').toLowerCase(), k = kindOf(f);
    return (patterns || []).some(function (p) {
      p = String(p).trim().toLowerCase();
      if (p === '*' || p === '*/*') return true;
      if (p.charAt(0) === '.') return name.slice(-p.length) === p;
      if (p.slice(-2) === '/*') return type.indexOf(p.slice(0, -1)) === 0 || p.slice(0, -2) === k;
      return type === p;
    });
  }
  function acceptsOf(m) { return (m.spec && Array.isArray(m.spec.accepts)) ? m.spec.accepts : m.def; }
  function takes(m, f) { return isDir(f) || matches(acceptsOf(m), f); }
  function toArray(files) {
    if (!files) return [];
    if (typeof files.length === 'number' && typeof files !== 'string') return [].slice.call(files);
    return [files];
  }
  function prettySize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  /* -------------------------------------------------------------- toast etc.
     Everything a mode shows through Embed.* lands here, so it sits in one place whatever the mode. */
  function refocus() {
    setTimeout(function () {
      if (Kit.dialogOpen() || menuEl) return;
      focusActive();
    }, 0);
  }
  function toast(msg, opts) {
    opts = Object.assign({}, opts || {});
    delete opts.anchor; delete opts.avoid;      /* elements of another document: the host places it */
    return Kit.toast(msg, opts);
  }
  function dialog(spec) { return Kit.dialog(spec).then(function (v) { refocus(); return v; }); }
  function confirmBox(text, opts) { return Kit.confirm(text, opts).then(function (v) { refocus(); return v; }); }
  function promptBox(title, opts) { return Kit.prompt(title, opts).then(function (v) { refocus(); return v; }); }

  /* ----------------------------------------------------------------- frames */
  function lendDesktop(f) {
    try {
      var d = window.desktop || (window.parent !== window && window.parent.desktop);
      if (d && f.contentWindow && !f.contentWindow.desktop) f.contentWindow.desktop = d;
    } catch (err) { /* a mode without the bridge says so in its own UI */ }
  }

  /* Controls of the three tools that did not remember their own settings: same keys and same rule as the
     shell used to apply (toolbox.controls.<dir>, NOT_KEPT), so what Davide saved still comes back. Two
     frames can share one page (Compare and Grid are both video/): a frame writes only the controls that
     changed since it loaded, merged into the stored object, so one never wipes the other's values. */
  var KEEP = { video: 1, frames: 1, annotate: 1 };
  var NOT_KEPT = /^(offset|speed|zoom|rot|panX|panY)[AB]$|^gv(Offset|Speed|Zoom|Rot|PanX|PanY)$|^(start|end|textEdit)$/;
  function keepKey(dir) { return 'toolbox.controls.' + dir; }
  function controlsOf(doc) {
    return [].slice.call(doc.querySelectorAll('input[id], select[id], textarea[id]')).filter(function (e) {
      return e.type !== 'file' && e.type !== 'button' && e.type !== 'submit' && e.type !== 'password' && !NOT_KEPT.test(e.id);
    });
  }
  function valueOf(e) { return (e.type === 'checkbox' || e.type === 'radio') ? e.checked : e.value; }
  function readKeep(dir) { try { var v = JSON.parse(lsGet(keepKey(dir)) || '{}'); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; } }
  function keepControls(m) {
    var doc = m.win.document, dir = m.dir, saved = readKeep(dir);
    controlsOf(doc).forEach(function (e) {
      if (!(e.id in saved)) return;
      var v = saved[e.id];
      if (e.type === 'checkbox' || e.type === 'radio') { if (e.checked === v) return; e.checked = v; }
      else { if (e.value === v) return; e.value = v; if (e.value !== v) return; }
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true }));
    });
    var last = {}, timer = null;
    controlsOf(doc).forEach(function (e) { last[e.id] = valueOf(e); });
    function store() {
      var cur = readKeep(dir), changed = false;
      controlsOf(doc).forEach(function (e) {
        var v = valueOf(e);
        if (last[e.id] === v) return;
        last[e.id] = v; cur[e.id] = v; changed = true;
      });
      if (changed) lsSet(keepKey(dir), JSON.stringify(cur));
    }
    function later() { clearTimeout(timer); timer = setTimeout(store, 400); }
    doc.addEventListener('input', later, true);
    doc.addEventListener('change', later, true);
    m.keepStore = store;
  }

  function ensureFrame(m) {
    if (m.frame) return m.frame;
    var f = document.createElement('iframe');
    f.title = m.title;
    f.dataset.mode = m.id;
    f.hidden = true;
    /* a tool that only shows its own pages has no use for popups or for navigating the frame elsewhere */
    f.setAttribute('allow', 'clipboard-read; clipboard-write');
    f.addEventListener('load', function () { onFrameLoad(m); });
    m.frame = f;
    m.state = 'loading';
    f.src = '../' + m.dir + '/index.html?embed=1' + (m.q ? '&' + m.q : '');
    framesEl.insertBefore(f, $('sendveil'));
    return f;
  }

  function onFrameLoad(m) {
    var w;
    try { w = m.frame.contentWindow; void w.document; } catch (e) { return; }
    if (m.regDoc && m.regDoc !== w.document) {       /* the page was reloaded: what it registered is gone */
      m.spec = null; m.actions = []; m.status = ''; m.state = 'loading'; m.shown = false; m.regDoc = null;
    }
    m.win = w;
    clearTimeout(m.timer);
    lendDesktop(m.frame);
    wireKeys(w);
    wireDrop(m);
    if (KEEP[m.dir]) safe(function () { keepControls(m); }, 'controls of ' + m.dir);
    if (m.state !== 'ready') {
      /* a page without embed.js can never register; one with it gets 1.5 s */
      if (!w.Embed) legacy(m);
      else m.timer = setTimeout(function () { if (m.state !== 'ready') legacy(m); }, 1500);
    }
    if (m === active) { renderHeader(); focusActive(); }
  }

  function setEmbedClass(m, on) {
    safe(function () {
      var d = m.win.document;
      d.documentElement.classList.toggle('embed', on);
      if (d.body) d.body.classList.toggle('embed', on);
    }, 'embed class');
  }
  /* never registered: show the page as it is (its own header included) with no actions in the host */
  function legacy(m) {
    if (m.state === 'ready') return;
    m.state = 'legacy';
    if (m.win && m.win.Embed) setEmbedClass(m, false);
    flush(m);
    if (m === active) renderHeader();
  }

  function focusActive() {
    var m = active;
    if (!m || !m.frame || m.frame.hidden) return;
    setTimeout(function () { safe(function () { m.win && m.win.focus(); }, 'focus'); }, 0);
  }

  /* ------------------------------------------------------------------ keys */
  function onKey(e) {
    var c = e.code || '', d = /^Digit([1-8])$/.exec(c);
    if (d && MODES[+d[1] - 1]) {
      var ok = (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey) || (e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey);
      if (ok) { e.preventDefault(); e.stopPropagation(); show(MODES[+d[1] - 1].id); return; }
    }
    if (c === 'KeyB' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
      e.preventDefault(); e.stopPropagation(); toggleRail();
      return;
    }
    /* ? opens the shortcut list in every mode (typing in a field is left alone) */
    if (e.key === '?' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.defaultPrevented) {
      var t = e.target, tag = t && t.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
      if (Kit.dialogOpen()) return;
      e.preventDefault(); keysBtn.click();
    }
  }
  function wireKeys(w) {
    safe(function () {
      w.document.addEventListener('keydown', onKey, true);
      /* the shell's Ctrl+1..3 has to work from inside a nested frame too */
      if (window.parent !== window && typeof window.parent.onKey === 'function') w.document.addEventListener('keydown', window.parent.onKey, true);
    }, 'keys');
  }
  document.addEventListener('keydown', onKey, true);

  /* ----------------------------------------------------------------- rail */
  var railBtns = {};
  (function buildRail() {
    var group = '';
    MODES.forEach(function (m) {
      if (m.group !== group) {
        group = m.group;
        var g = el('div', 'rg', group);
        g.setAttribute('role', 'presentation');
        railList.appendChild(g);
      }
      var b = el('button', 'mode');
      b.type = 'button';
      b.dataset.id = m.id;
      b.title = m.title + '  (Alt+' + m.n + ')';
      b.appendChild(Kit.icon(m.icon));
      b.appendChild(el('span', 'l', m.label));
      b.appendChild(el('span', 'n', String(m.n)));
      b.onclick = function () { show(m.id); };
      railList.appendChild(b);
      railBtns[m.id] = b;
    });
  })();
  var railToggle = $('railToggle');
  function setRail(slim) {
    app.classList.toggle('slim', slim);
    railToggle.title = (slim ? 'Show the mode names' : 'Show only the icons') + '  (Ctrl+B)';
    railToggle.setAttribute('aria-label', railToggle.title);
    railToggle.textContent = '';
    railToggle.appendChild(Kit.icon('sidebar'));
    lsSet(LS.rail, slim ? 'slim' : '');
    setTimeout(fitHead, 0);
  }
  function toggleRail() { setRail(!app.classList.contains('slim')); }
  railToggle.onclick = toggleRail;
  setRail(lsGet(LS.rail) === 'slim');

  /* ---------------------------------------------------------------- header */
  keysBtn.appendChild(Kit.icon('key'));
  keysBtn.appendChild(el('span', 'l', 'Shortcuts'));
  keysBtn.className = 'ib';
  function shortcutGroups() {
    var g = [['Studio', [
      ['Ctrl+Shift+1..8', 'Switch mode (Alt+1..8 does the same)'],
      ['Ctrl+B', 'Show only the icons in the mode list, or the names again'],
      ['Ctrl+1..3', 'Switch Toolbox tab'],
      ['?', 'Show or hide this list']
    ]], ['Media tray', [
      ['Drop', 'Files anywhere in Studio: the current mode takes them, or they wait in the tray'],
      ['Tray file', 'Click to send it to a mode; dragging it onto a mode does the same']
    ]]];
    var m = active;
    if (m && m.spec && Array.isArray(m.spec.shortcuts)) g = g.concat(m.spec.shortcuts);
    return g;
  }
  keysBtn.onclick = function () { Kit.keys(shortcutGroups(), { button: keysBtn, title: 'Shortcuts: ' + (active ? titleOf(active) : 'Studio') }); };
  window.addEventListener('blur', function () { Kit.keys.close(); });   /* a click into a mode frame */

  function titleOf(m) { return (m.spec && m.spec.title) || m.title; }

  function paintAction(m, a) {
    var b = a._btn;
    if (!b) return;
    b.textContent = '';
    b.className = (a.primary ? 'primary ' : '') + (a.on ? 'on ' : '') + (a.icon ? 'ib' : '') + (a.short && a.icon ? ' short' : '');
    b.disabled = !!a.disabled;
    b.hidden = !!a.hidden;
    if (a.icon) b.appendChild(Kit.icon(a.icon));
    if (a.label) b.appendChild(el('span', 'l', a.label));
    if (!a.label && a.icon) b.classList.add('ibtn');
    if (a.short && a.icon) b.classList.add('ibtn');
    var tip = a.tip || a.label || '';
    if (a.key) tip += (tip ? '  (' : '(') + a.key + ')';
    b.title = tip;
    b.setAttribute('aria-label', a.label || a.tip || a.id || '');
    if (a.on !== undefined) b.setAttribute('aria-pressed', a.on ? 'true' : 'false');
  }
  function makeAction(m, a) {
    if (a.sep) { var s = el('div', 'sep'); a._btn = s; return s; }
    var b = el('button');
    b.type = 'button';
    b.dataset.action = a.id || '';
    a._btn = b;
    b.onclick = function (ev) {
      if (typeof a.run !== 'function') return;
      try {
        var r = a.run(ev);
        if (r && typeof r.catch === 'function') r.catch(function (err) { if (window.console) console.error(err); });
      } catch (err) { if (window.console) console.error(err); toast('Could not run "' + (a.label || a.id) + '": ' + (err && err.message || err), { kind: 'err' }); }
      refocus();
    };
    paintAction(m, a);
    return b;
  }
  function renderHeader() {
    var m = active;
    if (!m) return;
    titleEl.textContent = titleOf(m);
    statusEl.textContent = m.status || '';
    statusEl.title = m.status || '';
    actionsEl.textContent = '';
    m.actions.forEach(function (a) { actionsEl.appendChild(makeAction(m, a)); });
    headSep.hidden = !m.actions.length;
    if (Kit.keys.isOpen()) Kit.keys(shortcutGroups(), { on: true, button: keysBtn, title: 'Shortcuts: ' + titleOf(m) });
    fitHead();
  }
  /* narrow window: the labels of the icon buttons go first, then the word Shortcuts */
  function fitHead() {
    head.classList.remove('compact', 'tight');
    function pressed() { return head.scrollWidth > head.clientWidth + 1 || (statusEl.textContent && statusEl.clientWidth < 110); }
    if (pressed()) head.classList.add('compact');
    if (pressed()) head.classList.add('tight');
  }
  if (window.ResizeObserver) new ResizeObserver(function () { fitHead(); }).observe(head);

  /* -------------------------------------------------------------- switching */
  function show(id) {
    var m = BY[id];
    if (!m) return false;
    if (active === m) { focusActive(); return true; }
    var prev = active;
    if (prev) {
      if (prev.frame) prev.frame.hidden = true;
      if (prev.shown) { prev.shown = false; if (prev.spec && prev.spec.onHide) safe(function () { prev.spec.onHide(); }, 'onHide of ' + prev.id); }
    }
    active = m;
    ensureFrame(m);
    m.frame.hidden = false;
    lendDesktop(m.frame);
    Object.keys(railBtns).forEach(function (k) {
      railBtns[k].classList.toggle('on', k === id);
      if (k === id) railBtns[k].setAttribute('aria-current', 'page'); else railBtns[k].removeAttribute('aria-current');
    });
    lsSet(LS.mode, id);
    if (m.state === 'ready') {
      m.shown = true;
      if (m.spec && m.spec.onShow) safe(function () { m.spec.onShow(); }, 'onShow of ' + m.id);
    }
    renderHeader();
    focusActive();
    return true;
  }

  /* ----------------------------------------------------------- the contract */
  function findMode(win) {
    for (var i = 0; i < MODES.length; i++) { var f = MODES[i].frame; if (f && f.contentWindow === win) return MODES[i]; }
    return null;
  }
  function register(win, spec) {
    var m = findMode(win);
    if (!m || !spec) return;
    m.win = win;
    m.spec = spec;
    m.regDoc = win.document;
    m.actions = (spec.actions || []).map(function (a) { return Object.assign({}, a); });
    m.state = 'ready';
    clearTimeout(m.timer);
    setEmbedClass(m, true);
    if (m === active) {
      renderHeader();
      if (!m.shown) { m.shown = true; if (spec.onShow) safe(function () { spec.onShow(); }, 'onShow of ' + m.id); }
    }
    flush(m);
  }
  function updateAction(win, id, patch) {
    var m = findMode(win);
    if (!m || !patch) return;
    var a = m.actions.filter(function (x) { return x.id === id; })[0];
    if (!a) { a = { id: id }; m.actions.push(a); Object.assign(a, patch); if (m === active) renderHeader(); return; }
    Object.assign(a, patch);
    if (m === active) { paintAction(m, a); fitHead(); }
  }
  function status(win, text) {
    var m = findMode(win);
    if (!m) return;
    m.status = text || '';
    if (m === active) { statusEl.textContent = m.status; statusEl.title = m.status; fitHead(); }
  }

  /* ----------------------------------------------------------- sending files */
  /* Files made in the host (or in another mode) are rebuilt in the receiving frame's realm, so a mode that
     tests `x instanceof File` is not surprised. The bytes are shared, nothing is copied. */
  function toRealm(w, f) {
    try { return new w.File([f], f.name, { type: f.type, lastModified: f.lastModified }); } catch (e) { return f; }
  }
  function realmArray(w, files) {
    var a = new w.Array();
    files.forEach(function (f) { a.push(toRealm(w, f)); });
    return a;
  }
  /* a page that has no onReceive is handed the files the way the user would: as a drop on its document */
  function synthDrop(m, files) {
    var w = m.win;
    var dt = new w.DataTransfer();
    files.forEach(function (f) { dt.items.add(toRealm(w, f)); });
    var ev = new w.DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: Math.round(w.innerWidth / 2), clientY: Math.round(w.innerHeight / 2) });
    ev.__studio = true;
    (w.document.body || w.document).dispatchEvent(ev);
  }
  function deliver(m, files) {
    if (!files.length) return;
    if (m.state === 'ready' && m.spec && typeof m.spec.onReceive === 'function') {
      var arr = realmArray(m.win, files);
      safe(function () { m.spec.onReceive(arr); }, 'onReceive of ' + m.id);
    } else if (m.state === 'ready' || m.state === 'legacy') {
      safe(function () { synthDrop(m, files); }, 'drop into ' + m.id);
    } else {
      m.pending = m.pending.concat(files);      /* still loading: delivered when it registers (or turns out legacy) */
    }
  }
  function flush(m) {
    if (!m.pending.length) return;
    var p = m.pending; m.pending = [];
    deliver(m, p);
  }
  function send(modeId, files) {
    var m = BY[modeId];
    var list = toArray(files);
    if (!m || !list.length) return false;
    var ok = list.filter(function (f) { return takes(m, f); });
    if (!ok.length) {
      toast(m.label + ' does not take ' + (list.length === 1 ? 'this file' : 'these files') + '.', { kind: 'warn' });
      return false;
    }
    show(modeId);
    ensureFrame(m);
    deliver(m, ok);
    if (ok.length < list.length) toast(plural(ok.length, 'file', 'files') + ' sent to ' + m.label + '; ' + (list.length - ok.length) + ' not accepted there.', { kind: 'warn' });
    return true;
  }
  /* files from a drop: what the target mode takes goes to it, the rest waits in the tray with a suggestion */
  function routeFiles(files, target, fromTray) {
    var m = target || active;
    if (!m || !files.length) return;
    var ok = files.filter(function (f) { return takes(m, f); });
    var rest = files.filter(function (f) { return !takes(m, f); });
    if (ok.length) { show(m.id); ensureFrame(m); deliver(m, ok); }
    if (rest.length) {
      if (!fromTray) addToTray(rest);
      suggest(rest, m, fromTray);
    }
  }
  function suggest(files, from, fromTray) {
    var all = MODES.filter(function (x) { return x !== from && files.every(function (f) { return takes(x, f); }); });
    var some = all.length ? all : MODES.filter(function (x) { return x !== from && files.some(function (f) { return takes(x, f); }); });
    var what = files.length === 1 ? '"' + files[0].name + '"' : plural(files.length, 'file', 'files');
    var msg = from.label + ' does not take ' + what + (fromTray ? '.' : '; ' + (files.length === 1 ? 'it is' : 'they are') + ' in the tray.');
    if (some.length) msg += ' Try ' + some.slice(0, 3).map(function (x) { return x.label; }).join(', ') + '.';
    toast(msg, some.length ? { kind: 'warn', action: { label: 'Send to ' + some[0].label, fn: function () { send(some[0].id, files); } } } : { kind: 'warn' });
  }

  /* --------------------------------------------------------------- the tray */
  var tray = [], trayId = 0, TRAY_MAX = 80;
  var trayEl = $('tray'), trayBody = $('trayBody'), trayCnt = $('trayCnt'), trayTip = $('trayTip'),
      traySendBtn = $('traySend'), trayClearBtn = $('trayClear');
  trayEl.querySelector('.trayic').appendChild(Kit.icon('tray'));
  function setTray(open) {
    trayEl.classList.toggle('open', open);
    $('trayHead').setAttribute('aria-expanded', open ? 'true' : 'false');
    lsSet(LS.tray, open ? '1' : '');
  }
  $('trayHead').onclick = function (e) { if (e.target.closest('button')) return; setTray(!trayEl.classList.contains('open')); };
  $('trayHead').onkeydown = function (e) { if ((e.key === 'Enter' || e.key === ' ') && e.target === this) { e.preventDefault(); setTray(!trayEl.classList.contains('open')); } };
  setTray(lsGet(LS.tray) === '1');

  function trayItem(id) { return tray.filter(function (t) { return String(t.id) === String(id); })[0]; }
  function addToTray(files) {
    var list = toArray(files).filter(function (f) { return f && f.name && !isDir(f); });
    var added = [], capped = false;
    list.forEach(function (f) {
      var dup = tray.some(function (t) { return t.file.name === f.name && t.file.size === f.size && t.file.lastModified === f.lastModified; });
      if (dup) return;
      if (tray.length >= TRAY_MAX) { capped = true; return; }
      var it = { id: ++trayId, file: f, name: f.name, kind: kindOf(f), size: f.size, thumb: '', meta: '' };
      tray.push(it); added.push(it);
    });
    if (capped) toast('The tray holds ' + TRAY_MAX + ' files at most. Remove some first.', { kind: 'warn' });
    if (added.length) { setTray(true); renderTray(); added.forEach(queueThumb); }
    return added.length;
  }
  function removeFromTray(id) {
    tray = tray.filter(function (t) { return String(t.id) !== String(id); });
    renderTray();
  }

  /* thumbnails one at a time, so thirty 4K images do not all decode at once */
  var thumbChain = Promise.resolve();
  function queueThumb(it) { thumbChain = thumbChain.then(function () { return makeThumb(it); }).catch(function () {}); }
  function withTimeout(p, ms) { return Promise.race([p, new Promise(function (_, rej) { setTimeout(function () { rej(new Error('timeout')); }, ms); })]); }
  function scaled(src, sw, sh) {
    var s = Math.min(232 / sw, 130 / sh, 1), c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(sw * s)); c.height = Math.max(1, Math.round(sh * s));
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL('image/webp', 0.78);
  }
  function makeThumb(it) {
    if (!trayItem(it.id)) return Promise.resolve();
    var f = it.file;
    if (it.kind === 'image') {
      return withTimeout(createImageBitmap(f, { resizeWidth: 464, resizeQuality: 'medium' }), 15000).then(function (bm) {
        it.thumb = scaled(bm, bm.width, bm.height); it.meta = prettySize(it.size); bm.close && bm.close();
      }).catch(function () { it.meta = prettySize(it.size); }).then(function () { renderTray(); });
    }
    if (it.kind === 'video') {
      var v = document.createElement('video'), url = URL.createObjectURL(f);
      v.muted = true; v.preload = 'auto'; v.src = url;
      function once(type) { return new Promise(function (res, rej) { v.addEventListener(type, res, { once: true }); v.addEventListener('error', function () { rej(new Error('video')); }, { once: true }); }); }
      return withTimeout(once('loadeddata'), 8000).then(function () {
        var d = isFinite(v.duration) ? v.duration : 0;
        it.meta = prettySize(it.size) + (d ? ', ' + Math.floor(d / 60) + ':' + ('0' + Math.floor(d % 60)).slice(-2) : '');
        var seeked = once('seeked');
        v.currentTime = d ? Math.min(0.1, d / 2) : 0.1;
        return withTimeout(seeked, 5000);
      }).then(function () { it.thumb = scaled(v, v.videoWidth || 16, v.videoHeight || 9); })
        .catch(function () { it.meta = it.meta || prettySize(it.size); })
        .then(function () { v.removeAttribute('src'); v.load(); URL.revokeObjectURL(url); renderTray(); });
    }
    it.meta = prettySize(it.size); renderTray();
    return Promise.resolve();
  }

  function renderTray() {
    trayCnt.textContent = String(tray.length);
    traySendBtn.hidden = trayClearBtn.hidden = !tray.length;
    trayTip.textContent = tray.length
      ? 'Click a file to send it to a mode, or drag it onto one.'
      : 'Drop files anywhere in Studio to keep them here, then send them to any mode.';
    trayBody.textContent = '';
    if (!tray.length) { trayBody.appendChild(el('div', 'empty', 'Nothing here yet')); return; }
    tray.forEach(function (it) {
      var d = el('div', 'ti');
      d.tabIndex = 0; d.draggable = true; d.dataset.id = it.id;
      d.title = it.name + '\nClick to send to a mode';
      var th = el('div', 'th');
      if (it.thumb) { var im = el('img'); im.src = it.thumb; im.alt = ''; th.appendChild(im); }
      else th.appendChild(Kit.icon(it.kind === 'video' ? 'video' : it.kind === 'image' ? 'image' : 'file'));
      var acts = el('div', 'acts');
      var sb = el('button'); sb.type = 'button'; sb.title = 'Send to...'; sb.setAttribute('aria-label', 'Send ' + it.name + ' to a mode'); sb.appendChild(Kit.icon('send'));
      sb.onclick = function (e) { e.stopPropagation(); openMenu(d, [it.file], it.name); };
      var xb = el('button'); xb.type = 'button'; xb.title = 'Remove from the tray'; xb.setAttribute('aria-label', 'Remove ' + it.name); xb.appendChild(Kit.icon('close'));
      xb.onclick = function (e) { e.stopPropagation(); removeFromTray(it.id); };
      acts.appendChild(sb); acts.appendChild(xb);
      th.appendChild(acts);
      d.appendChild(th);
      d.appendChild(el('div', 'nm', it.name));
      d.appendChild(el('div', 'mt', it.meta || prettySize(it.size)));
      d.onclick = function () { openMenu(d, [it.file], it.name); };
      d.onkeydown = function (e) {
        if (e.target !== d) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMenu(d, [it.file], it.name); }
        else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeFromTray(it.id); }
      };
      d.ondragstart = function (e) {
        e.dataTransfer.setData('application/x-studio-tray', String(it.id));
        e.dataTransfer.effectAllowed = 'copy';
        try { e.dataTransfer.setDragImage(th, 20, 20); } catch (err) { /* default image */ }
        document.body.classList.add('dragtray');
        $('sendveilText').textContent = 'Drop to send to ' + (active ? active.label : 'the mode');
        closeMenu();
      };
      d.ondragend = function () { document.body.classList.remove('dragtray'); clearDropMarks(); };
      trayBody.appendChild(d);
    });
  }
  trayClearBtn.onclick = function () { tray = []; renderTray(); };
  traySendBtn.onclick = function () { openMenu(traySendBtn, tray.map(function (t) { return t.file; }), 'All ' + tray.length + ' files'); };
  renderTray();

  /* Send to menu: every mode, the ones that cannot take the file are dimmed */
  var menuEl = null;
  function closeMenu() {
    if (!menuEl) return;
    menuEl.remove(); menuEl = null;
    document.removeEventListener('mousedown', menuDown, true);
    window.removeEventListener('keydown', menuKey, true);
    window.removeEventListener('blur', closeMenu);
  }
  function menuDown(e) { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }
  function menuKey(e) {
    if (!menuEl) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); var back = menuEl._from; closeMenu(); safe(function () { back && back.focus(); }, 'focus'); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      var bs = [].slice.call(menuEl.querySelectorAll('button:not(:disabled)'));
      if (!bs.length) return;
      e.preventDefault();
      var i = bs.indexOf(document.activeElement);
      i = e.key === 'ArrowDown' ? (i + 1) % bs.length : (i <= 0 ? bs.length - 1 : i - 1);
      bs[i].focus();
    }
  }
  function openMenu(anchor, files, title) {
    closeMenu();
    var m = el('div', 'st-menu');
    m.setAttribute('role', 'menu');
    m._from = anchor;
    m.appendChild(el('div', 'mh', 'Send ' + (title || 'to') + ' to'));
    var group = '';
    MODES.forEach(function (md) {
      if (md.group !== group) { if (group) m.appendChild(el('div', 'mg')); group = md.group; }
      var n = files.filter(function (f) { return takes(md, f); }).length;
      var b = el('button');
      b.type = 'button'; b.setAttribute('role', 'menuitem'); b.dataset.id = md.id;
      b.disabled = !n;
      b.appendChild(Kit.icon(md.icon));
      b.appendChild(el('span', 'l', md.title));
      if (files.length > 1 && n && n < files.length) b.appendChild(el('span', 's', n + ' of ' + files.length));
      else if (!n) b.appendChild(el('span', 's', 'not for this type'));
      b.onclick = function () { closeMenu(); send(md.id, files); };
      m.appendChild(b);
    });
    document.body.appendChild(m);
    menuEl = m;
    var r = anchor.getBoundingClientRect(), mw = m.offsetWidth, mh = m.offsetHeight;
    var left = Math.max(8, Math.min(r.left, window.innerWidth - mw - 8));
    var top = r.top - mh - 6;
    if (top < 8) top = Math.min(window.innerHeight - mh - 8, r.bottom + 6);
    m.style.left = left + 'px'; m.style.top = Math.max(8, top) + 'px';
    document.addEventListener('mousedown', menuDown, true);
    window.addEventListener('keydown', menuKey, true);
    window.addEventListener('blur', closeMenu);
    var first = m.querySelector('button:not(:disabled)');
    if (first) first.focus();
  }

  /* ------------------------------------------------------------- dropping */
  function hasType(e, type) { var t = e.dataTransfer && e.dataTransfer.types; return !!t && [].indexOf.call(t, type) >= 0; }
  function isFilesDrag(e) { return hasType(e, 'Files'); }
  function isTrayDrag(e) { return hasType(e, 'application/x-studio-tray'); }
  function clearDropMarks() { [].forEach.call(document.querySelectorAll('.mode.drop'), function (b) { b.classList.remove('drop'); }); }
  var veil = $('veil'), veilText = $('veilText'), depth = 0;
  function showVeil(on, e) {
    veil.classList.toggle('on', !!on);
    if (!on) return;
    var m = active, items = [].slice.call((e && e.dataTransfer && e.dataTransfer.items) || []).filter(function (i) { return i.kind === 'file'; });
    var typed = items.length && items.every(function (i) { return i.type; });
    var all = typed && m && items.every(function (i) { return matches(acceptsOf(m), { type: i.type, name: '' }); });
    veilText.textContent = !m ? 'Drop files here' : all || !typed ? 'Drop files to use them in ' + titleOf(m) : 'Drop files: ' + m.label + ' does not take them, they go to the tray';
  }
  window.addEventListener('dragenter', function (e) {
    if (!isFilesDrag(e)) return;
    e.preventDefault(); depth++; showVeil(true, e);
  });
  window.addEventListener('dragover', function (e) {
    var files = isFilesDrag(e), tr = isTrayDrag(e);
    if (!files && !tr) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
    var b = e.target.closest && e.target.closest('.mode');
    clearDropMarks();
    if (b) b.classList.add('drop');
    if (files) showVeil(!b && !(e.target.closest && e.target.closest('#tray')), e);
  });
  window.addEventListener('dragleave', function (e) {
    if (!isFilesDrag(e)) return;
    if (--depth <= 0) { depth = 0; showVeil(false); clearDropMarks(); }
  });
  window.addEventListener('dragend', function () { depth = 0; showVeil(false); clearDropMarks(); document.body.classList.remove('dragtray'); });
  window.addEventListener('drop', function (e) {
    var files = isFilesDrag(e), tr = isTrayDrag(e);
    if (!files && !tr) return;
    e.preventDefault();
    depth = 0; showVeil(false); clearDropMarks(); document.body.classList.remove('dragtray');
    var b = e.target.closest && e.target.closest('.mode');
    var target = b ? BY[b.dataset.id] : active;
    if (tr) {
      var list = String(e.dataTransfer.getData('application/x-studio-tray') || '').split(',').map(trayItem).filter(Boolean).map(function (t) { return t.file; });
      routeFiles(list, target, true);
      return;
    }
    var dropped = toArray(e.dataTransfer.files);
    if (e.target.closest && e.target.closest('#tray')) { addToTray(dropped); return; }
    routeFiles(dropped, target, false);
  });

  /* Over a mode frame the mode's own drop handling stays in charge, with one exception: a drop with files that
     a converted mode says it does not take is not thrown at it but routed (tray + suggestion). */
  function wireDrop(m) {
    safe(function () {
      m.win.addEventListener('drop', function (e) {
        if (e.__studio || !m.spec || !Array.isArray(m.spec.accepts)) return;
        var list = toArray(e.dataTransfer && e.dataTransfer.files);
        if (!list.length || list.every(function (f) { return takes(m, f); })) return;
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        routeFiles(list, m, false);
      }, true);
    }, 'drop of ' + m.id);
  }

  /* ----------------------------------------------------------------- Studio */
  window.Studio = {
    register: register,
    updateAction: updateAction,
    status: status,
    toast: toast,
    dialog: dialog,
    confirm: confirmBox,
    prompt: promptBox,
    send: send,
    tray: function (files) { return addToTray(files); },
    /* host-side helpers (shell, tests) */
    show: show,
    focus: function () { focusActive(); },
    mode: function () { return active ? active.id : null; },
    modes: MODES,
    trayItems: function () { return tray.map(function (t) { return { id: t.id, name: t.name, kind: t.kind, size: t.size, thumb: !!t.thumb }; }); },
    openMenu: openMenu
  };

  var start = new URLSearchParams(location.search).get('mode') || lsGet(LS.mode);
  show(BY[start] ? start : 'join');
})();
