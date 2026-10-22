/* ==========================================================================
   DAVFX kit (Studio): window.Kit
   Plain browser JS, no dependencies, no Store globals. Works in a page and in
   an iframe (every piece lives in the document that loaded this file).
   Pair with kit.css. Source of the look and of the behaviours: app/store/index.html.

     Kit.icons                    name -> path data (16x16 grid, stroke style)
     Kit.icon(name)               -> <svg class="ic">
     Kit.iconHtml(name)           -> the same as an HTML string
     Kit.paintIcons(root)         puts the icon in front of every [data-ic] element
     Kit.addIcons({name: path})   add or replace icons ("stroke|fill" for a filled part)
     Kit.config({stage, avoid})   default place of the toast (see toast)
     Kit.toast(msg, opts)         bottom-left notice; opts: kind 'err'|'warn', ms, sticky,
                                  action {label, fn}, undo fn, anchor element|selector,
                                  align 'left'|'center'|'right', avoid [el|selector]
     Kit.dialog({title,text,body,buttons,focus,onOpen,canClose,dismiss,width}) -> Promise<id|null>
     Kit.confirm(text, {ok, cancel, danger, title}) -> Promise<boolean>
     Kit.prompt(title, {value, placeholder, text, ok, cancel, validate}) -> Promise<string|null>
     Kit.keys(groups, {on, button, title})   toggle the shortcuts popover
     Kit.row(spec)                one settings row (see row)
     Kit.rows(specs)              a <div> with the rows and .sync() (re-reads every get(), applies when())
     Kit.section({title, icon, open, count, rows|body, onToggle}) collapsible section
     Kit.tabs({items, value, onChange})     the tab strip
     Kit.drop(el, {accept, onFiles, overlayText})  files dropped anywhere on the window
     Kit.save(blob, name)         download (the Electron save dialog asks where)
     Kit.persist(key)             {get, set, getAll, setAll, watchControls(root, notKept)}
   ========================================================================== */
(function (global) {
  'use strict';
  var doc = global.document;
  var NS = 'http://www.w3.org/2000/svg';

  /* ------------------------------------------------------------------ icons
     Every icon sits on a 16x16 grid: outlines between 2 and 14, stroke 1.35,
     round caps and joins, no fill. "stroke|fill": the part after | is filled
     (only for small dots, e.g. the record button). */
  var ICONS = {
    /* --- the Store set --- */
    image:  'M2 3h12v10H2z M2 10.5l3.5-3 2.5 2.5 3-3L14 9.5',
    file:   'M3.5 2h5.5l3.5 3.5V14h-9z M9 2v3.5h3.5',
    folder: 'M2 4h4.5L8 5.5H14V13H2z',
    logo:   'M3 3h6.5L13 6.5V13H3z M6 6h3.5v4H6z',
    type:   'M3.5 3.5h9 M8 3.5V13 M5.5 13h5',
    open:   'M2 13V4h4.5L8 5.5h6V7 M2 13l1.6-5.5H15L13.4 13z',
    save:   'M3 2.5h8.5l2 2v9H3z M5.5 2.5v3.5h5V2.5 M5.5 13.5V9.5h5v4',
    saveas: 'M2.5 2.5h7.5l2.5 2.5V8 M2.5 2.5v11H8 M4.5 2.5v3.5h4V2.5 M11.5 9.5v4 M9.5 11.5h4',
    layoutall: 'M2 5.5h5v5H2z M7 8h1.5 M8.5 4.3v7.4 M8.5 4.3H10 M8.5 11.7H10 M10 2.8h4v3h-4z M10 10.2h4v3h-4z',
    copy:   'M5.5 2.5h8v8h-8z M2.5 5.5v8h8',
    desktop:'M2 3h12v8H2z M6 13.5h4 M8 11v2.5',
    down:   'M8 2.5v7 M5.5 7L8 9.5 10.5 7 M2.5 13.5h11',
    zip:    'M2.5 4h11v3h-11z M3.5 7v6.5h9V7 M6.5 9.5h3',
    key:    'M1.5 4.5h13v7h-13z M4 7v.02 M6.5 7v.02 M9 7v.02 M11.5 7v.02 M4.5 9.5h7',
    undo:   'M5.5 4.5L2.5 7.5l3 3 M2.5 7.5h6.5c2 0 3.5 1.5 3.5 3.5v1.5',
    redo:   'M10.5 4.5l3 3-3 3 M13.5 7.5H7c-2 0-3.5 1.5-3.5 3.5v1.5',
    reset:  'M13 3.5v3.5h-3.5 M13 7A5.2 5.2 0 1 0 12.4 10.2',
    fit:    'M2.5 6V2.5h3.5 M13.5 6V2.5H10 M2.5 10v3.5h3.5 M13.5 10v3.5H10',
    grid:   'M2.5 6.5h11 M2.5 9.5h11 M6.5 2.5v11 M9.5 2.5v11',
    eye:    'M2 8s2.4-3.5 6-3.5S14 8 14 8s-2.4 3.5-6 3.5S2 8 2 8z M6.5 8h3',
    eyeoff: 'M2.5 2.5l11 11 M2 8s2.4-3.5 6-3.5c1 0 1.9.2 2.6.6 M12.4 6.6c1 .8 1.6 1.4 1.6 1.4s-2.4 3.5-6 3.5c-.6 0-1.2-.1-1.7-.2',
    up:     'M8 13V4 M4.5 7.5L8 4l3.5 3.5',
    close:  'M4 4l8 8 M12 4l-8 8',
    trash:  'M2.5 4h11 M5.5 4V2h5v2 M4 4l.8 9.5h6.4L12 4',
    compare:'M2.5 2.5h5v11h-5z M8.5 2.5h5v11h-5z',
    lock:   'M4 7V5a4 4 0 0 1 8 0v2 M3 7h10v7H3z M8 9.5v2',
    unlock: 'M4 7V5a4 4 0 0 1 7.2-2.4 M3 7h10v7H3z M8 9.5v2',
    magnet2:'M3 2.5h3.5v6a1.5 1.5 0 0 0 3 0v-6H13v6a5 5 0 0 1-10 0z M3 5.5h3.5 M9.5 5.5H13',
    wheel:  'M9.5 2.5h4v4 M13.5 2.5L9 7 M6.5 13.5h-4v-4 M2.5 13.5L7 9',
    unused: 'M2.5 3.5h11v9h-11z M6 6.5l4 3 M10 6.5l-4 3',
    zin:    'M7 2.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9z M10.4 10.4l3.1 3.1 M7 5v4 M5 7h4',
    zout:   'M7 2.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9z M10.4 10.4l3.1 3.1 M5 7h4',
    layers: 'M8 2.5L2.5 5.5 8 8.5l5.5-3z M2.5 9L8 12l5.5-3',
    branch: 'M2.5 4.5h4.5v7h-4.5z M9 4.5h4.5v7h-4.5z',
    drop:   'M8 2.6c0 0 4 4.3 4 6.6a4 4 0 0 1-8 0c0-2.3 4-6.6 4-6.6z',
    sliders:'M2.5 5.5h11 M2.5 10.5h11 M6 4v3 M10.5 9v3',
    blur:   'M8 2.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11z M8 5.2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6z',
    tint:   'M8 2.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11z M8 2.5v11',
    fade:   'M2.5 2.5h11v11h-11z M4.5 11.5h7 M5.5 9h5 M6.5 6.5h3',
    band:   'M2.5 2.5h11v11h-11z M2.5 10.5h11',
    rule:   'M2.5 7.5h11 M2.5 11h7',
    tag:    'M8.8 2.5h4.7v4.7L7.8 12.9 3.1 8.2z M11.2 4.9v.02',
    badge:  'M5.5 4.5h8v5l-3 3h-8v-5z',
    frame:  'M2.5 2.5h11v11h-11z M5 5h6v6H5z',
    naming: 'M2.5 4.5h11v7h-11z M5 8h6',
    clock:  'M8 2.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11z M8 5v3.2l2.2 1.6',

    /* --- media: transport --- */
    play:     'M5 2.8v10.4L13 8z',
    pause:    'M4.5 3h2.6v10H4.5z M8.9 3h2.6v10H8.9z',
    stop:     'M3.5 3.5h9v9h-9z',
    record:   'M8 2.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11z|M8 5.6a2.4 2.4 0 1 1 0 4.8 2.4 2.4 0 0 1 0-4.8z',
    stepback: 'M3.5 3v10 M12.5 3.2L6 8l6.5 4.8z',
    stepfwd:  'M12.5 3v10 M3.5 3.2L10 8l-6.5 4.8z',
    tostart:  'M2.5 3v10 M9 3.5L5 8l4 4.5 M13.5 3.5L9.5 8l4 4.5',
    toend:    'M13.5 3v10 M7 3.5L11 8l-4 4.5 M2.5 3.5L6.5 8l-4 4.5',
    loop:     'M3 7V6a2 2 0 0 1 2-2h7.5 M10.5 2l2 2-2 2 M13 9v1a2 2 0 0 1-2 2H3.5 M5.5 14l-2-2 2-2',
    sound:    'M2.5 6h2.5L8.5 3v10L5 10H2.5z M11 5.7a3.5 3.5 0 0 1 0 4.6 M12.6 4.3a5 5 0 0 1 0 7.4',
    mute:     'M2.5 6h2.5L8.5 3v10L5 10H2.5z M10.8 6l3.4 4 M14.2 6l-3.4 4',

    /* --- media: edit --- */
    scissors: 'M4.5 9.9a1.9 1.9 0 1 1 0 3.8 1.9 1.9 0 0 1 0-3.8z M11.5 9.9a1.9 1.9 0 1 1 0 3.8 1.9 1.9 0 0 1 0-3.8z M5.4 10.2L11.6 2.5 M10.6 10.2L4.4 2.5',
    crop:     'M4.5 2v9.5H14 M2 4.5h9.5V14',
    rotate:   'M2.8 8a5.2 5.2 0 0 1 9.2-3.3 M12.4 2.4v2.9H9.5 M13.2 8a5.2 5.2 0 0 1-9.2 3.3 M3.6 13.6v-2.9h2.9',
    flip:     'M8 2.5v11 M6 4.8L2.5 12.5H6z M10 4.8l3.5 7.7H10z',
    join:     'M2 5h4.5v6H2z M9.5 5H14v6H9.5z M6.5 8h3',

    /* --- media: places and kinds --- */
    film:     'M2.5 2.5h11v11h-11z M5.5 2.5v11 M10.5 2.5v11 M2.5 5.5h3 M2.5 8h3 M2.5 10.5h3 M10.5 5.5h3 M10.5 8h3 M10.5 10.5h3',
    video:    'M2.5 3.5h11v9h-11z M7 6v4l3.5-2z',
    folderopen: 'M2.5 13V4h4L8 5.5h5.5V7 M2.5 13l1.5-5.5h10l-1.5 5.5z',
    grid4:    'M2.5 2.5h4.5v4.5H2.5z M9 2.5h4.5v4.5H9z M2.5 9h4.5v4.5H2.5z M9 9h4.5v4.5H9z',
    sheet:    'M2.5 2.5h11v11h-11z M2.5 6.2h11 M2.5 9.8h11 M6.2 2.5v11 M9.8 2.5v11',
    flipbook: 'M2.5 5.5h8v8h-8z M5 3h8.5v8.5 M4.8 9.5h3.4',
    annotate: 'M2.5 13.5l.8-3.2L10.6 3l2.4 2.4-7.3 7.3z M9 4.6l2.4 2.4 M8.5 13.5h5',
    rename:   'M2.5 4h11v8h-11z M8 6.2v3.6 M6.7 6.2h2.6 M6.7 9.8h2.6',
    texture:  'M2.5 2.5h11v11h-11z M2.5 8L8 2.5 M2.5 13.5L13.5 2.5 M8 13.5L13.5 8',
    sparkle:  'M7.5 2.5l1.3 3.7L12.5 7.5 8.8 8.8 7.5 12.5 6.2 8.8 2.5 7.5l3.7-1.3z M12.5 2.5v2.4 M11.3 3.7h2.4 M12.2 11v2.4 M11 12.2h2.4',
    send:     'M13.5 2.5L2.5 7l4.6 2 1.9 4.5z M7.1 9l6.4-6.5',
    tray:     'M2.5 9l1.8-5.5h7.4L13.5 9v4h-11z M2.5 9h3.5l1 1.5h2L10 9h3.5',

    /* --- small helpers --- */
    plus:     'M8 3v10 M3 8h10',
    minus:    'M3 8h10',
    check:    'M3 8.5l3.2 3.2L13 4.5',
    info:     'M8 2.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11z M8 7.2v3.6 M8 5.2v.02'
  };

  function mkIcon(name) {
    var spec = ICONS[name] || ICONS.grid;
    var parts = spec.split('|');
    var sv = doc.createElementNS(NS, 'svg');
    sv.setAttribute('class', 'ic');
    sv.setAttribute('viewBox', '0 0 16 16');
    sv.setAttribute('aria-hidden', 'true');
    var p = doc.createElementNS(NS, 'path');
    p.setAttribute('d', parts[0]);
    sv.appendChild(p);
    if (parts[1]) {
      var f = doc.createElementNS(NS, 'path');
      f.setAttribute('class', 'f');
      f.setAttribute('d', parts[1]);
      sv.appendChild(f);
    }
    return sv;
  }
  function iconHtml(name) { return mkIcon(name).outerHTML; }
  function paintIcons(root) {
    var list = (root || doc).querySelectorAll('[data-ic]');
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (b.querySelector('svg.ic')) continue;
      b.insertBefore(mkIcon(b.getAttribute('data-ic')), b.firstChild);
    }
  }
  function addIcons(map) {
    Object.keys(map || {}).forEach(function (k) { ICONS[k] = String(map[k]); });
  }

  /* ---------------------------------------------------------------- helpers */
  function el(tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function resolveEl(x) {
    if (!x) return null;
    if (typeof x === 'function') { try { return resolveEl(x()); } catch (e) { return null; } }
    if (typeof x === 'string') { try { return doc.querySelector(x); } catch (e) { return null; } }
    return x.getBoundingClientRect ? x : null;
  }
  function decimals(step) {
    var s = String(step === undefined ? 1 : step);
    if (/e-/.test(s)) return parseInt(s.split('e-')[1], 10) || 0;
    var i = s.indexOf('.');
    return i < 0 ? 0 : s.length - i - 1;
  }
  var cfg = { stage: null, avoid: [] };
  function config(o) {
    if (!o) return cfg;
    if ('stage' in o) cfg.stage = o.stage;
    if ('avoid' in o) cfg.avoid = o.avoid || [];
    return cfg;
  }

  /* ------------------------------------------------------------------ toast
     One notice at a time, bottom-left of `anchor` (or of the configured stage
     element, or of the window). It hops above the `avoid` elements (info lines
     under a canvas, for instance) so it never covers text or controls. Undo is
     a callback: Kit knows nothing about whose history it is. */
  var toastEl = null, toastTimer = 0;
  function ensureToast() {
    if (toastEl && toastEl.isConnected) return toastEl;
    toastEl = el('div', 'kit-toast');
    toastEl.setAttribute('aria-live', 'polite');
    doc.body.appendChild(toastEl);
    return toastEl;
  }
  function placeToast(t, o) {
    var vw = global.innerWidth, vh = global.innerHeight;
    var anchor = resolveEl(o.anchor) || resolveEl(cfg.stage);
    var align = o.align || 'left';
    var left, maxW, bottom;
    t.style.left = t.style.right = 'auto';
    if (anchor) {
      var r = anchor.getBoundingClientRect();
      maxW = Math.max(220, Math.min(640, r.width - 28));
      bottom = Math.max(12, vh - Math.min(r.bottom, vh) + 12);
      t.style.maxWidth = maxW + 'px';
      if (align === 'right') t.style.right = Math.max(8, vw - r.right + 14) + 'px';
      else if (align === 'center') t.style.left = Math.max(8, r.left + r.width / 2 - Math.min(maxW, t.offsetWidth || maxW) / 2) + 'px';
      else t.style.left = Math.max(8, r.left + 14) + 'px';
    } else {
      maxW = Math.min(640, vw - 32);
      bottom = 20;
      t.style.maxWidth = maxW + 'px';
      if (align === 'right') t.style.right = '14px';
      else if (align === 'center') t.style.left = Math.max(8, (vw - Math.min(maxW, t.offsetWidth || maxW)) / 2) + 'px';
      else t.style.left = '14px';
    }
    t.style.bottom = bottom + 'px';
    var tb = t.getBoundingClientRect();
    var cap = Infinity;
    (cfg.avoid || []).concat(o.avoid || []).forEach(function (x) {
      var e = resolveEl(x);
      if (!e) return;
      var c = e.getBoundingClientRect();
      if (c.width < 1 || c.height < 1) return;
      if (e.textContent === '' && !e.children.length) return;
      if (tb.left < c.right + 6 && tb.right > c.left - 6 && tb.top < c.bottom + 6 && tb.bottom > c.top - 6)
        cap = Math.min(cap, c.top);
    });
    if (cap < Infinity) t.style.bottom = Math.max(12, vh - cap + 8) + 'px';
  }
  function toast(msg, o) {
    o = o || {};
    var t = ensureToast();
    var m = String(msg);
    t.textContent = '';
    t.classList.remove('toast-err', 'toast-warn');
    var kind = o.kind || (/^(Could not|Couldn't|Export failed|Failed|Error)/.test(m) ? 'err' : '');
    if (kind) t.classList.add('toast-' + kind);
    t.setAttribute('role', kind === 'err' ? 'alert' : 'status');
    t.appendChild(el('span', 'kit-toast-msg', m));
    var az = o.action || null;
    if (!az && typeof o.undo === 'function') az = { label: 'Undo', fn: o.undo };
    if (az) {
      var b = el('button', '', az.label || 'OK');
      b.type = 'button';
      b.onclick = function () {
        clearTimeout(toastTimer); t.classList.remove('on');
        try { az.fn && az.fn(); } catch (e) { if (global.console) console.error(e); }
      };
      t.appendChild(b);
    }
    placeToast(t, o);
    t.classList.add('on');
    clearTimeout(toastTimer);
    if (!o.sticky) toastTimer = setTimeout(function () { t.classList.remove('on'); }, o.ms || clamp(2800 + 40 * m.length, 2800, 9000));
    return { close: function () { clearTimeout(toastTimer); t.classList.remove('on'); } };
  }
  toast.hide = function () { clearTimeout(toastTimer); if (toastEl) toastEl.classList.remove('on'); };

  /* ----------------------------------------------------------------- dialog
     dialog({title, text, body, buttons:[{id,label,primary,danger,def,focus}]})
     Resolves with the id of the button, or null on Esc / click outside. Enter
     presses the primary (or `def`) button. `body` is a node or an HTML string
     written by us. `focus` (selector or element inside the box) gets the focus
     instead of the primary button. `canClose(id)` returning false keeps it
     open (used by prompt validation). A new dialog closes the previous one with null. */
  var dlgHost = null;
  function ensureDlgHost() {
    if (dlgHost && dlgHost.isConnected) return dlgHost;
    dlgHost = el('div', 'kit-dlg-host');
    dlgHost.hidden = true;
    doc.body.appendChild(dlgHost);
    return dlgHost;
  }
  function dialogOpen() { return !!(dlgHost && dlgHost.isConnected && !dlgHost.hidden); }
  function dialog(o) {
    o = o || {};
    var host = ensureDlgHost();
    if (host._close) host._close(null);
    var before = doc.activeElement;
    return new Promise(function (resolve) {
      host.textContent = '';
      var scrim = el('div', 'kit-dlg-scrim');
      var box = el('div', 'kit-dlg');
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      if (o.width) box.style.width = typeof o.width === 'number' ? Math.min(o.width, 4000) + 'px' : o.width;
      if (o.title) { box.appendChild(el('h3', '', o.title)); box.setAttribute('aria-label', o.title); }
      var body = el('div', 'kit-dlg-body');
      if (o.text) {
        var p = el('div', '', o.text);
        p.style.whiteSpace = 'pre-line';
        body.appendChild(p);
      }
      if (o.body) {
        if (typeof o.body === 'string') { var w = el('div'); w.innerHTML = o.body; body.appendChild(w); }
        else body.appendChild(o.body);
      }
      box.appendChild(body);
      var bar = el('div', 'kit-dlg-btns');
      var list = (o.buttons && o.buttons.length) ? o.buttons : [{ id: 'ok', label: 'OK', primary: true }];
      var buttons = list.map(function (d) {
        var b = el('button', '', d.label || d.id);
        b.type = 'button';
        if (d.primary) b.classList.add('primary');
        if (d.danger) b.classList.add('danger');
        b.onclick = function () { finish(d.id); };
        bar.appendChild(b);
        return b;
      });
      box.appendChild(bar);
      scrim.appendChild(box);
      host.appendChild(scrim);
      host.hidden = false;
      var closed = false, down = null;
      function finish(id) {
        if (closed) return;
        if (o.canClose && o.canClose(id) === false) return;
        closed = true;
        global.removeEventListener('keydown', onKey, true);
        host._close = null;
        host.hidden = true; host.textContent = '';
        try { if (before && before.isConnected && before.focus) before.focus(); } catch (e) { /* gone */ }
        resolve(id);
      }
      host._close = function (id) { var c = o.canClose; o.canClose = null; finish(id); o.canClose = c; };
      function enterIndex() {
        var i = list.findIndex(function (d) { return d.primary; });
        return i >= 0 ? i : list.findIndex(function (d) { return d.def; });
      }
      function onKey(e) {
        if (!box.isConnected) { finish(null); return; }
        if (e.key === 'Escape' && o.dismiss !== false) { e.preventDefault(); e.stopPropagation(); finish(null); return; }
        if (e.key === 'Enter') {
          var tag = e.target && e.target.tagName;
          if (tag === 'BUTTON' || tag === 'TEXTAREA' || tag === 'SELECT') return;
          var i = enterIndex();
          if (i >= 0) { e.preventDefault(); e.stopPropagation(); finish(list[i].id); }
          return;
        }
        if (e.key === 'Tab') {
          var f = [].slice.call(box.querySelectorAll('button,input,select,textarea,[tabindex]'))
            .filter(function (x) { return !x.disabled && x.tabIndex >= 0 && x.offsetParent !== null; });
          if (!f.length) return;
          var k = f.indexOf(doc.activeElement);
          var n = e.shiftKey ? (k <= 0 ? f.length - 1 : k - 1) : (k < 0 || k === f.length - 1 ? 0 : k + 1);
          e.preventDefault(); e.stopPropagation(); f[n].focus();
        }
      }
      global.addEventListener('keydown', onKey, true);
      scrim.addEventListener('mousedown', function (e) { down = e.target; });
      scrim.addEventListener('click', function (e) { if (o.dismiss !== false && e.target === scrim && down === scrim) finish(null); });
      var target = null;
      if (o.focus) target = typeof o.focus === 'string' ? box.querySelector(o.focus) : o.focus;
      if (!target) {
        var fi = list.findIndex(function (d) { return d.focus; });
        if (fi < 0) fi = list.findIndex(function (d) { return d.primary; });
        target = buttons[fi] || buttons[buttons.length - 1];
      }
      if (typeof o.onOpen === 'function') { try { o.onOpen(box); } catch (e) { if (global.console) console.error(e); } }
      if (target) target.focus();
    });
  }
  function confirmBox(text, o) {
    o = o || {};
    return dialog({
      title: o.title, text: text,
      buttons: [
        { id: 'cancel', label: o.cancel || 'Cancel', focus: !!o.danger },
        { id: 'ok', label: o.ok || 'OK', primary: !o.danger, danger: !!o.danger, def: true }
      ]
    }).then(function (id) { return id === 'ok'; });
  }
  /* window.prompt() returns null in Electron; this is a real dialog with a field.
     Resolves with the text (maybe empty) or null when cancelled. */
  function promptBox(title, o) {
    o = o || {};
    var wrap = el('div');
    var inp = el('input', 'kit-prompt');
    inp.type = 'text';
    inp.value = o.value === undefined || o.value === null ? '' : String(o.value);
    if (o.placeholder) inp.placeholder = o.placeholder;
    inp.setAttribute('aria-label', title || 'Value');
    var err = el('div', 'kit-prompt-err');
    err.setAttribute('role', 'alert');
    wrap.appendChild(inp); wrap.appendChild(err);
    inp.addEventListener('input', function () { err.textContent = ''; });
    return dialog({
      title: title, text: o.text, body: wrap, focus: inp,
      buttons: [{ id: 'cancel', label: o.cancel || 'Cancel' }, { id: 'ok', label: o.ok || 'OK', primary: true }],
      onOpen: function () { inp.select(); },
      canClose: function (id) {
        if (id !== 'ok' || typeof o.validate !== 'function') return true;
        var msg = o.validate(inp.value);
        if (msg) { err.textContent = String(msg); inp.focus(); return false; }
        return true;
      }
    }).then(function (id) { return id === 'ok' ? inp.value : null; });
  }

  /* ------------------------------------------------------------------- keys
     keys(groups) opens (or closes) the shortcuts popover. groups:
     [[title, [[keys, what], ...]], ...]  (or [{title, items}]). Call keys()
     with no groups to toggle the last ones. Esc, a click outside and the X close it. */
  var keysEl = null, keysGroups = [], keysBtn = null;
  function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
  function keysBuild(title) {
    keysEl.textContent = '';
    var head = el('div', 'khead');
    head.appendChild(el('b', '', title || 'Keyboard shortcuts'));
    head.appendChild(el('span', '', 'Esc to close'));
    var x = el('button', 'kx');
    x.type = 'button'; x.title = 'Close (Esc)'; x.setAttribute('aria-label', 'Close the list');
    x.appendChild(mkIcon('close'));
    x.onclick = function () { keysSet(false); };
    head.appendChild(x);
    keysEl.appendChild(head);
    keysGroups.forEach(function (g) {
      var name = Array.isArray(g) ? g[0] : g.title, items = Array.isArray(g) ? g[1] : g.items;
      keysEl.appendChild(el('h4', '', name));
      var grid = el('div', 'kgrid');
      (items || []).forEach(function (k) {
        var row = el('div');
        row.innerHTML = '<b>' + esc(Array.isArray(k) ? k[0] : k.keys) + '</b><span>' + esc(Array.isArray(k) ? k[1] : k.text) + '</span>';
        grid.appendChild(row);
      });
      keysEl.appendChild(grid);
    });
  }
  function keysOnKey(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); keysSet(false); } }
  function keysOnDown(e) {
    if (!keysEl || keysEl.hidden || keysEl.contains(e.target)) return;
    if (keysBtn && keysBtn.contains(e.target)) return;
    keysSet(false);
  }
  function keysSet(on, title) {
    if (!keysEl || !keysEl.isConnected) {
      keysEl = el('div', 'kit-keys');
      keysEl.hidden = true;
      keysEl.setAttribute('role', 'dialog');
      keysEl.setAttribute('aria-label', 'Keyboard shortcuts');
      doc.body.appendChild(keysEl);
    }
    if (on) {
      if (dialogOpen()) return;
      keysBuild(title);
      keysEl.hidden = false;
      doc.addEventListener('mousedown', keysOnDown, true);
      global.addEventListener('keydown', keysOnKey, true);
    } else {
      keysEl.hidden = true;
      doc.removeEventListener('mousedown', keysOnDown, true);
      global.removeEventListener('keydown', keysOnKey, true);
    }
    if (keysBtn) keysBtn.setAttribute('aria-expanded', on ? 'true' : 'false');
  }
  function keys(groups, o) {
    if (groups && !Array.isArray(groups)) { o = groups; groups = null; }
    o = o || {};
    if (groups) keysGroups = groups;
    if (o.button) keysBtn = o.button;
    var open = !!(keysEl && keysEl.isConnected && !keysEl.hidden);
    keysSet(o.on === undefined ? !open : !!o.on, o.title);
    return !!(keysEl && !keysEl.hidden);
  }
  keys.close = function () { if (keysEl) keysSet(false); };
  keys.isOpen = function () { return !!(keysEl && keysEl.isConnected && !keysEl.hidden); };

  /* -------------------------------------------------------------------- row
     row(spec) -> element.row with the Store look.
       type     range | number | check | color | select | text | area | button | seg | group | note
       label    text on the left (group / note: the title / the text)
       get()    current value;  set(v) on every change;  commit(v) when the gesture ends
       min max step           range / number
       options  select / seg: ['a','b'] or [{value,label}] or [[value,label]]
       tip      tooltip;  def  value restored by Alt+click on the row
       id       id of the main control (persist(...).watchControls keeps controls with an id)
       placeholder, disabled, when (function: false hides the row on sync), text (button text,
       note text, check text), icon, click (button), buttons [{text, icon, click, tip, primary}],
       hard: true keeps a typed number inside min..max (default: up to twice the slider range)
     The element has .sync() (re-read get()), .input (main control), .valInput (range number box),
     .setDisabled(bool). */
  function normOptions(opts) {
    return (opts || []).map(function (x) {
      if (Array.isArray(x)) return { value: x[0], label: x[1] === undefined ? String(x[0]) : String(x[1]) };
      if (x && typeof x === 'object') return { value: x.value, label: x.label === undefined ? String(x.value) : String(x.label) };
      return { value: x, label: String(x) };
    });
  }
  function colorHex(t) {
    var h = String(t || '').trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(h)) h = h.replace(/./g, function (c) { return c + c; });
    return /^[0-9a-f]{6}$/i.test(h) ? '#' + h.toLowerCase() : null;
  }
  function row(spec) {
    var s = spec || {};
    var type = s.type || 'text';
    var get = typeof s.get === 'function' ? s.get : function () { return s.value; };
    var set = typeof s.set === 'function' ? s.set : function () {};
    var commit = typeof s.commit === 'function' ? s.commit : function () {};
    var d;
    if (type === 'group') {
      d = el('div', 'grp2');
      d.appendChild(el('span', '', s.label || s.text || ''));
      if (s.tip) d.title = s.tip;
      d.sync = function () {}; d.setDisabled = function () {};
      return d;
    }
    if (type === 'note') {
      d = el('div', 'hint', s.text || s.label || '');
      if (s.tip) d.title = s.tip;
      d.sync = function () {}; d.setDisabled = function () {};
      return d;
    }
    var r = el('div', 'row' + (type === 'area' ? ' full' : ''));
    if (s.tip) r.title = s.tip;
    var syncers = [], inp = null, valEl = null, disabled = [];
    function addLabel() {
      if (s.label === undefined || s.label === null) return null;
      var lb = el('label', '', s.label);
      r.appendChild(lb);
      return lb;
    }
    function reg(c) { disabled.push(c); }

    if (type === 'button') {
      var list = s.buttons || [{ text: s.text || s.label, icon: s.icon, click: s.click || s.run, tip: s.tip, primary: s.primary, danger: s.danger }];
      var holder = list.length > 1 ? el('div', 'btnrow') : r;
      list.forEach(function (bd) {
        var b = el('button', '' + (bd.primary ? 'acc' : '') + (bd.danger ? ' danger' : ''));
        b.type = 'button';
        if (bd.icon) { b.classList.add('ib'); b.appendChild(mkIcon(bd.icon)); }
        b.appendChild(el('span', '', bd.text || bd.label || ''));
        if (bd.tip) b.title = bd.tip;
        b.style.flex = '1';
        b.onclick = function (e) { if (bd.click) bd.click(e); };
        holder.appendChild(b);
        reg(b);
        if (!inp) inp = b;
      });
      if (holder !== r) r.appendChild(holder);
    } else if (type === 'range') {
      addLabel();
      inp = el('input'); inp.type = 'range';
      inp.min = s.min; inp.max = s.max; inp.step = s.step === undefined ? 1 : s.step;
      valEl = el('input', 'val'); valEl.type = 'number'; valEl.step = inp.step; valEl.title = 'Type an exact value';
      var dec = decimals(s.step);
      var fmt = function (v) { return Number(v).toFixed(dec); };
      var lo = s.hard ? s.min : Math.min(s.min, s.min < 0 ? s.min * 2 : 0);
      var hi = s.hard ? s.max : s.max * 2;
      inp.oninput = function () { var v = parseFloat(inp.value); set(v); valEl.value = fmt(v); };
      inp.onchange = function () { commit(parseFloat(inp.value)); };
      valEl.onchange = function () {
        var v = parseFloat(valEl.value);
        if (isNaN(v)) { valEl.value = fmt(get()); return; }
        v = clamp(v, lo, hi);
        set(v); commit(v);
        valEl.value = fmt(v); inp.value = v;
      };
      valEl.onkeydown = function (e) { if (e.key === 'Enter') valEl.blur(); e.stopPropagation(); };
      r.appendChild(inp); r.appendChild(valEl);
      reg(inp); reg(valEl);
      syncers.push(function () { var v = get(); if (v === undefined || v === null || isNaN(v)) return; inp.value = v; valEl.value = fmt(v); });
    } else if (type === 'number') {
      addLabel();
      inp = el('input'); inp.type = 'number';
      if (s.min !== undefined) inp.min = s.min;
      if (s.max !== undefined) inp.max = s.max;
      if (s.step !== undefined) inp.step = s.step;
      if (s.placeholder) inp.placeholder = s.placeholder;
      inp.oninput = function () { if (inp.value !== '' && isFinite(inp.valueAsNumber)) set(inp.valueAsNumber); };
      inp.onchange = function () {
        var v = inp.valueAsNumber;
        if (!isFinite(v)) { syncers[0](); return; }
        if (s.min !== undefined) v = Math.max(s.min, v);
        if (s.max !== undefined) v = Math.min(s.max, v);
        inp.value = v; set(v); commit(v);
      };
      inp.onkeydown = function (e) { if (e.key === 'Enter') inp.blur(); e.stopPropagation(); };
      r.appendChild(inp); reg(inp);
      syncers.push(function () { var v = get(); inp.value = (v === undefined || v === null) ? '' : v; });
    } else if (type === 'check') {
      addLabel();
      inp = el('input'); inp.type = 'checkbox';
      inp.onchange = function () { set(inp.checked); commit(inp.checked); };
      r.appendChild(inp); reg(inp);
      if (s.text) {
        var tx = el('span', 'rtext', s.text);
        tx.style.cursor = 'pointer';
        tx.onclick = function () { if (!inp.disabled) inp.click(); };
        r.appendChild(tx);
      }
      syncers.push(function () { inp.checked = !!get(); });
    } else if (type === 'color') {
      addLabel();
      inp = el('input'); inp.type = 'color';
      var hex = null;
      inp.oninput = function () { set(inp.value); if (hex) hex.textContent = inp.value.toUpperCase(); };
      inp.onchange = function () { commit(inp.value); };
      r.appendChild(inp); reg(inp);
      if (s.hex !== false) {
        hex = el('button', 'hex'); hex.type = 'button';
        hex.title = 'Click: copy. Double-click: type a colour code';
        var wait = 0;
        hex.onclick = function (e) {
          if (e.detail > 1) return;
          clearTimeout(wait);
          wait = setTimeout(function () {
            var v = String(inp.value).toUpperCase();
            var ok = function () { toast(v + ' copied'); };
            if (global.navigator && navigator.clipboard && navigator.clipboard.writeText)
              navigator.clipboard.writeText(v).then(ok, function () { toast('Could not reach the clipboard'); });
          }, 250);
        };
        hex.ondblclick = function () {
          clearTimeout(wait);
          var f = el('input', 'inl hexinl'); f.type = 'text'; f.value = inp.value.toUpperCase();
          hex.replaceWith(f); f.focus(); f.select();
          var done = false;
          var end = function (apply) {
            if (done) return; done = true;
            var v = colorHex(f.value);
            f.replaceWith(hex);
            if (apply && v && v !== inp.value.toLowerCase()) { inp.value = v; set(v); commit(v); }
            else if (apply && !v) toast('Not a colour code');
            hex.textContent = inp.value.toUpperCase();
          };
          f.onkeydown = function (e) { e.stopPropagation(); if (e.key === 'Enter') end(true); else if (e.key === 'Escape') end(false); };
          f.onblur = function () { end(true); };
        };
        r.appendChild(hex);
      }
      syncers.push(function () { var v = get(); if (v) inp.value = v; if (hex) hex.textContent = String(inp.value).toUpperCase(); });
    } else if (type === 'select') {
      addLabel();
      inp = el('select');
      var opts = normOptions(typeof s.options === 'function' ? s.options() : s.options);
      opts.forEach(function (o) { var op = el('option', '', o.label); op.value = String(o.value); inp.appendChild(op); });
      inp.onchange = function () {
        var o = opts.filter(function (x) { return String(x.value) === inp.value; })[0];
        var v = o ? o.value : inp.value;
        set(v); commit(v);
      };
      r.appendChild(inp); reg(inp);
      syncers.push(function () { var v = get(); if (v !== undefined && v !== null) inp.value = String(v); });
    } else if (type === 'seg') {
      addLabel();
      inp = el('div', 'seg');
      inp.setAttribute('role', 'group');
      var sopts = normOptions(s.options), btns = [];
      sopts.forEach(function (o) {
        var b = el('button', '', o.label); b.type = 'button';
        b.onclick = function () { set(o.value); commit(o.value); paint(); };
        inp.appendChild(b); btns.push(b); reg(b);
      });
      var paint = function () {
        var v = get();
        sopts.forEach(function (o, i) {
          var on = String(o.value) === String(v);
          btns[i].classList.toggle('on', on);
          btns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
        });
      };
      r.appendChild(inp);
      syncers.push(paint);
    } else if (type === 'area') {
      addLabel();
      inp = el('textarea');
      if (s.placeholder) inp.placeholder = s.placeholder;
      if (s.rows) inp.rows = s.rows;
      inp.oninput = function () { set(inp.value); };
      inp.onchange = function () { commit(inp.value); };
      r.appendChild(inp); reg(inp);
      syncers.push(function () { var v = get(); inp.value = v === undefined || v === null ? '' : v; });
    } else {
      addLabel();
      inp = el('input'); inp.type = 'text';
      if (s.placeholder) inp.placeholder = s.placeholder;
      inp.oninput = function () { set(inp.value); };
      inp.onchange = function () { commit(inp.value); };
      r.appendChild(inp); reg(inp);
      syncers.push(function () { var v = get(); inp.value = v === undefined || v === null ? '' : v; });
    }
    if (s.id && inp && type !== 'seg') inp.id = s.id;   /* a seg is a group of buttons, not a value control */

    /* Alt+click on a row puts the default value back (when the spec has one) */
    if (s.def !== undefined) {
      r.addEventListener('mousedown', function (e) {
        if (!e.altKey || e.button !== 0) return;
        var v = typeof s.def === 'function' ? s.def() : s.def;
        e.preventDefault(); e.stopPropagation();
        set(v); commit(v); r.sync();
        if (s.silent !== true) toast((s.label || 'Value') + ' back to ' + (typeof v === 'number' ? Math.round(v * 1000) / 1000 : (v === '' ? 'empty' : v)));
      }, true);
    }

    r.sync = function () {
      syncers.forEach(function (f) { try { f(); } catch (e) { if (global.console) console.error(e); } });
      if (typeof s.when === 'function') {
        var show = true;
        try { show = !!s.when(); } catch (e) { show = true; }
        r.hidden = !show;
      }
      var dis = typeof s.disabled === 'function' ? !!s.disabled() : !!s.disabled;
      r.setDisabled(dis);
    };
    r.setDisabled = function (b) {
      disabled.forEach(function (c) { c.disabled = !!b; });
      r.classList.toggle('dis', !!b);
    };
    r.input = inp; r.valInput = valEl; r.spec = s;
    r.sync();
    return r;
  }
  function rows(specs, wrap) {
    var w = wrap || el('div');
    var built = [];
    (specs || []).forEach(function (sp) { var e = (sp && sp.nodeType) ? sp : row(sp); w.appendChild(e); built.push(e); });
    w.rows = built;
    w.sync = function () { built.forEach(function (e) { if (e.sync) e.sync(); }); };
    return w;
  }

  /* --------------------------------------------------------------- section
     section({title, icon, open, count, rows | body, onToggle}) -> div.sec; .toggle(open) */
  function section(o) {
    o = o || {};
    var sec = el('div', 'sec' + (o.open ? ' open' : ''));
    var hd = el('div', 'hd');
    hd.tabIndex = 0; hd.setAttribute('role', 'button');
    if (o.icon) hd.appendChild(mkIcon(o.icon));
    hd.appendChild(el('b', '', o.title || ''));
    if (o.count !== undefined && o.count !== null) hd.appendChild(el('span', 'cnt', String(o.count)));
    hd.appendChild(el('span', 'sg'));
    var bd = el('div', 'bd');
    if (o.rows) bd.appendChild(rows(o.rows));
    if (o.body) { if (typeof o.body === 'string') bd.innerHTML = o.body; else bd.appendChild(o.body); }
    sec.appendChild(hd); sec.appendChild(bd);
    function toggle(on) {
      var open = on === undefined ? !sec.classList.contains('open') : !!on;
      sec.classList.toggle('open', open);
      hd.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) { var rr = bd.firstChild; if (rr && rr.sync) rr.sync(); }
      if (typeof o.onToggle === 'function') o.onToggle(open);
    }
    hd.setAttribute('aria-expanded', sec.classList.contains('open') ? 'true' : 'false');
    hd.onclick = function () { toggle(); };
    hd.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } };
    sec.toggle = toggle; sec.body = bd; sec.head = hd;
    return sec;
  }

  /* ------------------------------------------------------------------ tabs */
  function tabs(o) {
    o = o || {};
    var t = el('div', 'tabs');
    t.setAttribute('role', 'tablist');
    var btns = {};
    var cur = o.value !== undefined ? o.value : (o.items && o.items[0] && o.items[0].id);
    function paint() {
      Object.keys(btns).forEach(function (k) {
        var on = k === String(cur);
        btns[k].classList.toggle('on', on);
        btns[k].setAttribute('aria-selected', on ? 'true' : 'false');
      });
    }
    (o.items || []).forEach(function (it) {
      var b = el('button'); b.type = 'button'; b.setAttribute('role', 'tab');
      if (it.icon) b.appendChild(mkIcon(it.icon));
      b.appendChild(el('span', 'tl', it.label || it.id));
      if (it.tip) b.title = it.tip;
      b.onclick = function () { t.set(it.id, true); };
      t.appendChild(b); btns[String(it.id)] = b;
    });
    t.set = function (id, user) {
      cur = id; paint();
      if (user && typeof o.onChange === 'function') o.onChange(id);
    };
    t.value = function () { return cur; };
    paint();
    return t;
  }

  /* ------------------------------------------------------------------- drop
     drop(el, {accept, onFiles, overlayText, onReject, enabled, within})
     Files dragged over the WINDOW show a veil over `el`; dropping anywhere
     calls onFiles(acceptedFiles, event, rejectedFiles). `accept`: 'image/*,.json'
     | ['video/*', '.gif'] | function(file). overlayText: string or function(event).
     within:true reacts only when the pointer is inside `el`. Returns {destroy, setText, overlay}. */
  function acceptTest(accept) {
    if (!accept) return function () { return true; };
    if (typeof accept === 'function') return accept;
    var parts = (Array.isArray(accept) ? accept : String(accept).split(',')).map(function (x) { return String(x).trim().toLowerCase(); }).filter(Boolean);
    return function (f) {
      var type = String(f.type || '').toLowerCase(), name = String(f.name || '').toLowerCase();
      return parts.some(function (p) {
        if (p === '*' || p === '*/*') return true;
        if (p.charAt(0) === '.') return name.slice(-p.length) === p;
        if (p.slice(-2) === '/*') return type.indexOf(p.slice(0, -1)) === 0;
        return type === p;
      });
    };
  }
  function hasFiles(e) {
    var dt = e.dataTransfer;
    if (!dt) return false;
    if (dt.types && [].indexOf.call(dt.types, 'Files') >= 0) return true;
    return !!(dt.files && dt.files.length);
  }
  function drop(target, o) {
    o = o || {};
    var host = resolveEl(target) || doc.body;
    var wholePage = host === doc.body || host === doc.documentElement;
    var ok = acceptTest(o.accept);
    var veil = el('div', 'kit-drop' + (wholePage ? ' fixed' : ''));
    var label = el('span', '', typeof o.overlayText === 'string' ? o.overlayText : 'Drop files here');
    veil.appendChild(label);
    var restore = null;
    if (!wholePage) {
      if (global.getComputedStyle(host).position === 'static') { host.style.position = 'relative'; restore = true; }
      host.appendChild(veil);
    } else doc.body.appendChild(veil);
    var depth = 0;
    function inside(e) {
      if (!o.within) return true;
      var r = host.getBoundingClientRect();
      return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    }
    function active() { return typeof o.enabled === 'function' ? !!o.enabled() : true; }
    /* while dragging only the mime type is known: say "no" only when it is certain */
    var accParts = typeof o.accept === 'function' || !o.accept ? null :
      (Array.isArray(o.accept) ? o.accept : String(o.accept).split(',')).map(function (x) { return String(x).trim().toLowerCase(); });
    function itemsOk(e) {
      var it = e.dataTransfer && e.dataTransfer.items;
      if (!it || !it.length || !accParts) return true;
      var hasExt = accParts.some(function (p) { return p.charAt(0) === '.'; });
      return [].some.call(it, function (x) {
        if (x.kind !== 'file') return false;
        return x.type === '' || hasExt || ok({ type: x.type, name: '' });
      });
    }
    function show(on, e) {
      veil.classList.toggle('on', !!on);
      if (!on) return;
      var good = itemsOk(e);
      veil.classList.toggle('no', !good);
      label.textContent = !good ? (o.rejectText || 'This kind of file is not accepted here')
        : (typeof o.overlayText === 'function' ? o.overlayText(e) : (o.overlayText || 'Drop files here'));
    }
    var onEnter = function (e) {
      if (!hasFiles(e) || !active()) return;
      e.preventDefault(); depth++; show(inside(e), e);
    };
    var onOver = function (e) {
      if (!hasFiles(e) || !active()) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
      show(inside(e), e);
    };
    var onLeave = function (e) {
      if (!hasFiles(e)) return;
      if (--depth <= 0) { depth = 0; show(false); }
    };
    var onDrop = function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();      /* never let the window navigate to a dropped file */
      depth = 0; show(false);
      if (!active() || !inside(e)) return;
      var all = [].slice.call(e.dataTransfer.files || []);
      if (!all.length) return;
      var good = all.filter(function (f) { return ok(f); }), bad = all.filter(function (f) { return !ok(f); });
      if (good.length && typeof o.onFiles === 'function') o.onFiles(good, e, bad);
      else if (!good.length) {
        if (typeof o.onReject === 'function') o.onReject(bad, e);
        else toast('Nothing to add: this kind of file is not accepted here');
      }
    };
    var onEnd = function () { depth = 0; show(false); };
    global.addEventListener('dragenter', onEnter);
    global.addEventListener('dragover', onOver);
    global.addEventListener('dragleave', onLeave);
    global.addEventListener('drop', onDrop);
    global.addEventListener('dragend', onEnd);
    return {
      overlay: veil,
      setText: function (t) { o.overlayText = t; if (typeof t === 'string') label.textContent = t; },
      destroy: function () {
        global.removeEventListener('dragenter', onEnter);
        global.removeEventListener('dragover', onOver);
        global.removeEventListener('dragleave', onLeave);
        global.removeEventListener('drop', onDrop);
        global.removeEventListener('dragend', onEnd);
        veil.remove();
        if (restore) host.style.position = '';
      }
    };
  }

  /* ------------------------------------------------------------------- save
     save(blob, name): a normal download. In the desktop app main.js turns it
     into a Save dialog. Strings, typed arrays and plain objects (JSON) are wrapped. */
  function save(data, name, o) {
    o = o || {};
    var blob = data;
    if (!(data instanceof Blob)) {
      if (typeof data === 'string') blob = new Blob([data], { type: o.type || 'text/plain' });
      else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) blob = new Blob([data], { type: o.type || 'application/octet-stream' });
      else blob = new Blob([JSON.stringify(data, null, 2)], { type: o.type || 'application/json' });
    }
    var fname = String(name || 'download').replace(/[\\/:*?"<>|]+/g, '_');
    var url = URL.createObjectURL(blob);
    var a = el('a');
    a.href = url; a.download = fname; a.style.display = 'none';
    doc.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    return fname;
  }

  /* ---------------------------------------------------------------- persist
     persist(key): a small JSON object kept in localStorage under exactly `key`
     (e.g. 'toolbox.controls.video'). get(name, fallback) / set(name, value) touch one
     field; getAll() / setAll(obj) the whole object. Never throws (private mode).
     watchControls(root, notKept) is what the Toolbox shell does for tools that do not
     remember their settings: every input/select/textarea with an id (not file, button,
     submit, password, nor an id matching `notKept`) is stored 400 ms after a change and put
     back at start, firing input + change like a hand would. Returns {save, restore, stop}. */
  var NOT_KEPT_DEFAULT = /^(offset|speed|zoom|rot|panX|panY)[AB]$|^gv(Offset|Speed|Zoom|Rot|PanX|PanY)$|^(start|end|textEdit)$/;
  function persist(key) {
    function readAll() {
      try { var v = JSON.parse(global.localStorage.getItem(key) || '{}'); return v && typeof v === 'object' ? v : {}; }
      catch (e) { return {}; }
    }
    function writeAll(obj) { try { global.localStorage.setItem(key, JSON.stringify(obj)); return true; } catch (e) { return false; } }
    var api = {
      key: key,
      getAll: readAll,
      setAll: function (obj) { return writeAll(obj || {}); },
      get: function (name, fallback) { var a = readAll(); return name in a ? a[name] : fallback; },
      set: function (name, value) { var a = readAll(); a[name] = value; return writeAll(a); },
      remove: function (name) { var a = readAll(); delete a[name]; return writeAll(a); },
      watchControls: function (root, notKept) {
        var base = root || doc;
        var d = base.ownerDocument || base;
        var skip = notKept === undefined ? NOT_KEPT_DEFAULT : notKept;
        function controls() {
          return [].slice.call(base.querySelectorAll('input[id], select[id], textarea[id]')).filter(function (e) {
            return e.id && e.type !== 'file' && e.type !== 'button' && e.type !== 'submit' && e.type !== 'password' &&
              !(skip && skip.test(e.id));
          });
        }
        function restore() {
          var saved = readAll();
          controls().forEach(function (e) {
            if (!(e.id in saved)) return;
            var v = saved[e.id];
            if (e.type === 'checkbox' || e.type === 'radio') { if (e.checked === v) return; e.checked = v; }
            else { if (e.value === v) return; e.value = v; if (e.value !== v) return; }
            e.dispatchEvent(new Event('input', { bubbles: true }));
            e.dispatchEvent(new Event('change', { bubbles: true }));
          });
        }
        function store() {
          var all = {};
          controls().forEach(function (e) { all[e.id] = (e.type === 'checkbox' || e.type === 'radio') ? e.checked : e.value; });
          writeAll(all);
        }
        var timer = 0;
        function later() { clearTimeout(timer); timer = setTimeout(store, 400); }
        restore();
        d.addEventListener('input', later, true);
        d.addEventListener('change', later, true);
        return {
          save: store, restore: restore,
          stop: function () { clearTimeout(timer); d.removeEventListener('input', later, true); d.removeEventListener('change', later, true); }
        };
      }
    };
    return api;
  }
  persist.NOT_KEPT = NOT_KEPT_DEFAULT;

  /* ----------------------------------------------------------------- export */
  global.Kit = {
    version: 1,
    icons: ICONS, icon: mkIcon, iconHtml: iconHtml, paintIcons: paintIcons, addIcons: addIcons,
    config: config,
    toast: toast, dialog: dialog, dialogOpen: dialogOpen, confirm: confirmBox, prompt: promptBox,
    keys: keys,
    row: row, rows: rows, section: section, tabs: tabs,
    drop: drop, save: save, persist: persist
  };
})(typeof window !== 'undefined' ? window : this);
