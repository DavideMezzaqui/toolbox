'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, session, shell, net, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const pkg = require('./package.json');
const cfg = pkg.toolConfig || {};
let sceneSyncHost;
const testing = process.env.DAVFX_TOOLBOX_QA === '1';
if (testing && process.env.DAVFX_TOOLBOX_QA_DATA) app.setPath('userData', process.env.DAVFX_TOOLBOX_QA_DATA);

const APP_SCHEME = 'app';
const APP_HOST = 'local';
const ROOT = path.join(__dirname, 'app');

// A tool may ship a preload.js to reach the few desktop capabilities a page
// cannot have on its own. Most do not, so its absence is normal.
const PRELOAD = path.join(__dirname, 'preload.js');
const HAS_PRELOAD = fs.existsSync(PRELOAD);

// `fileSystem` backs the File System Access API (showOpenFilePicker /
// showDirectoryPicker). The rest are cheap to allow and commonly wanted.
const ALLOWED_PERMISSIONS = new Set([
  'fileSystem',
  'clipboard-read',
  'clipboard-sanitized-write',
  'fullscreen',
  'pointerLock'
]);

// Interface scale. cfg.zoom is the tool's own baseline; Ctrl +/- adjusts from
// there and the result is remembered.
const BASE_ZOOM = Number(cfg.zoom) > 0 ? Number(cfg.zoom) : 1;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.1;

// A custom standard+secure scheme gives the page a stable origin. Under plain
// file:// Chromium hands out an opaque origin, which breaks localStorage,
// IndexedDB, any secure-context API (WebCodecs, File System Access) and ES
// module import(). Serving app/ over app:// avoids all of it.
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      codeCache: true
    }
  }
]);

// ---------------------------------------------------------------------------
// Static file serving from ./app
// ---------------------------------------------------------------------------
function resolveInRoot(pathname) {
  let rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  if (rel === '') rel = 'index.html';
  const abs = path.resolve(ROOT, rel);
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) return null;
  return abs;
}

function registerProtocol() {
  protocol.handle(APP_SCHEME, (request) => {
    const abs = resolveInRoot(new URL(request.url).pathname);
    if (!abs) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(abs).toString());
  });
}

// ---------------------------------------------------------------------------
// Window bounds and interface scale, remembered between sessions
// ---------------------------------------------------------------------------
const STATE_FILE = path.join(app.getPath('userData'), 'window-state.json');

function readState() {
  try {
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (!saved || typeof saved !== 'object') return null;

    // A window restored onto a monitor that is no longer attached would open
    // off-screen and look like the app failed to start.
    if (typeof saved.x === 'number' && typeof saved.y === 'number' &&
        typeof saved.width === 'number' && typeof saved.height === 'number') {
      const onScreen = screen.getAllDisplays().some((d) => {
        const a = d.workArea;
        return saved.x < a.x + a.width && saved.x + saved.width > a.x &&
               saved.y < a.y + a.height && saved.y + saved.height > a.y;
      });
      if (!onScreen) { delete saved.x; delete saved.y; }
    }
    return saved;
  } catch {
    return null; // absent or corrupt - fall back to the configured defaults
  }
}

function applySavedBounds(win, saved) {
  if (!saved || typeof saved.width !== 'number' || typeof saved.height !== 'number') return;
  // Applied here rather than through the constructor: on Windows the
  // constructor's width/height are not the exact inverse of getBounds(), and
  // bounds set before the window is shown can be overridden when it appears.
  const rect = { width: saved.width, height: saved.height };
  if (typeof saved.x === 'number' && typeof saved.y === 'number') {
    rect.x = saved.x;
    rect.y = saved.y;
  }
  win.setBounds(rect);
  if (saved.maximized) win.maximize();
}

function makeStateWriter(win, getZoom) {
  let timer = null;
  let boundsChanged = false;
  const base = win.getBounds();

  // Showing a window on a DPI-scaled display emits a late resize a pixel or two
  // off from the requested size. That is noise, not the user resizing anything,
  // and writing it back would drift the window on every launch.
  const reallyMoved = () => {
    const b = win.getBounds();
    return Math.abs(b.width - base.width) > 2 || Math.abs(b.height - base.height) > 2 ||
           Math.abs(b.x - base.x) > 2 || Math.abs(b.y - base.y) > 2;
  };

  const write = () => {
    if (win.isDestroyed()) return;
    const maximized = win.isMaximized();
    // Store the restored size, not the maximized one, so un-maximizing later
    // returns to a sensible window rather than a screen-sized "restore".
    const bounds = boundsChanged
      ? (maximized ? win.getNormalBounds() : win.getBounds())
      : null;
    try {
      const prev = readState() || {};
      const next = Object.assign({}, prev, bounds ? Object.assign({}, bounds, { maximized }) : {}, {
        zoom: getZoom()
      });
      fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
      fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2));
    } catch {
      // Persisting window state is a convenience; never fail the app over it.
    }
  };

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(write, 400);
  };

  win.on('resize', () => { if (boundsChanged || reallyMoved()) { boundsChanged = true; schedule(); } });
  win.on('move', () => { if (boundsChanged || reallyMoved()) { boundsChanged = true; schedule(); } });
  win.on('close', () => { clearTimeout(timer); write(); });

  return schedule;
}

// ---------------------------------------------------------------------------
// Exports: always ask where to write
// ---------------------------------------------------------------------------
function registerDownloadHandler() {
  session.defaultSession.on('will-download', (_event, item) => {
    const name = item.getFilename() || 'export';
    const ext = path.extname(name).replace('.', '');
    item.setSaveDialogOptions({
      title: 'Save file',
      defaultPath: name,
      filters: ext
        ? [{ name: ext.toUpperCase(), extensions: [ext] }, { name: 'All files', extensions: ['*'] }]
        : [{ name: 'All files', extensions: ['*'] }]
    });
  });
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
function createWindow() {
  const saved = readState();

  let zoom = (saved && typeof saved.zoom === 'number' && saved.zoom >= ZOOM_MIN && saved.zoom <= ZOOM_MAX)
    ? saved.zoom
    : BASE_ZOOM;

  const win = new BrowserWindow({
    width: cfg.width || 1400,
    height: cfg.height || 900,
    minWidth: cfg.minWidth || 800,
    minHeight: cfg.minHeight || 600,
    backgroundColor: cfg.background || '#191a1c',
    autoHideMenuBar: true,
    show: false,
    webPreferences: Object.assign(HAS_PRELOAD ? { preload: PRELOAD } : {}, {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: !testing,
      offscreen: testing,
      // Without these, Chromium's generic families fall back to the
      // proportional default here, so a page asking for bare `monospace`
      // renders in a serif face. These mirror Chrome's own Windows defaults.
      defaultFontFamily: {
        standard: 'Times New Roman',
        serif: 'Times New Roman',
        sansSerif: 'Arial',
        monospace: 'Consolas'
      }
    })
  });

  // Closing mid-operation can leave a half-applied change on disk, so the
  // first attempt only warns. But the "running" flag is cleared by the engine
  // itself: if the engine ever stops responding, nothing clears it and the
  // window can never be closed again. So the warning offers a way out.
  // Closing this way deliberately leaves the worker alone to finish its write
  // rather than killing it half-way through.
  let closeAsked = false;
  win.on('close', event => {
    if (!sceneSyncHost || !sceneSyncHost.running) return;
    event.preventDefault();
    if (closeAsked) return;              // the question is already on screen
    closeAsked = true;
    dialog.showMessageBox(win, {
      type: 'warning',
      title: 'Scene Sync is working',
      message: 'A Scene Sync operation is still running.',
      detail: 'Closing now can leave a change half applied. Wait unless the engine ' +
              'has stopped responding. If you close anyway, the operation is left ' +
              'to finish on its own in the background.',
      buttons: ['Wait', 'Close anyway'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    }).then(res => {
      closeAsked = false;
      if (res.response === 1) win.destroy();
    }).catch(() => { closeAsked = false; });
  });
  let saveState = () => {};

  win.once('ready-to-show', () => {
    applySavedBounds(win, saved);
    if (!testing) win.show();
    // Start tracking only once the restore has settled, so the restore is never
    // itself recorded as if the user had resized the window.
    setTimeout(() => {
      if (!win.isDestroyed()) saveState = makeStateWriter(win, () => zoom);
    }, 600);
  });

  win.loadURL(`${APP_SCHEME}://${APP_HOST}/index.html`);

  function applyZoom() {
    if (win.isDestroyed()) return;
    win.webContents.setZoomFactor(zoom);
    saveState();
  }

  win.webContents.on('did-finish-load', () => {
    // Pinch and ctrl-wheel zoom are pinned: interface scale changes through
    // Ctrl +/- only, so it cannot drift from a stray trackpad gesture.
    win.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {});
    win.webContents.setZoomFactor(zoom);
  });

  // With no application menu there are no default accelerators, so the few we
  // want are wired by hand. Reload is deliberately Ctrl+Shift+R: these tools
  // hold unsaved work in the page, and a browser-reflex Ctrl+R would bin it.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = (input.key || '').toLowerCase();

    if (key === 'f12' || (input.control && input.shift && key === 'i')) {
      win.webContents.toggleDevTools();
      event.preventDefault();
      return;
    }
    if (input.control && input.shift && key === 'r') {
      win.webContents.reload();
      event.preventDefault();
      return;
    }
    if (input.control && (key === '=' || key === '+' || key === 'add')) {
      zoom = Math.min(ZOOM_MAX, Math.round((zoom + ZOOM_STEP) * 100) / 100);
      applyZoom();
      event.preventDefault();
      return;
    }
    if (input.control && (key === '-' || key === '_' || key === 'subtract')) {
      zoom = Math.max(ZOOM_MIN, Math.round((zoom - ZOOM_STEP) * 100) / 100);
      applyZoom();
      event.preventDefault();
      return;
    }
    if (input.control && key === '0') {
      zoom = BASE_ZOOM;
      applyZoom();
      event.preventDefault();
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    // Drop the default menu outright. autoHideMenuBar only hides it, leaving
    // its accelerators live - Ctrl+R would reload and bin unsaved work.
    Menu.setApplicationMenu(null);

    const ses = session.defaultSession;
    ses.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(ALLOWED_PERMISSIONS.has(permission));
    });
    ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));

    // ---- file operations for tools that ship a preload --------------------
    // Unreachable without one, since nothing else can call these channels.
    // Everything is validated here rather than trusted from the page.

    const isDir = (p) => {
      try { return typeof p === 'string' && !!p && fs.statSync(p).isDirectory(); }
      catch { return false; }
    };
    // A rename must stay inside its folder: plain file names only, no
    // separators and no walking upwards.
    const isPlainName = (n) =>
      typeof n === 'string' && n.length > 0 && n.length < 255 &&
      !/[\\/:*?"<>|]/.test(n) && n !== '.' && n !== '..';

    ipcMain.handle('desktop:pick-folder', async (event) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const res = await dialog.showOpenDialog(win, {
        title: 'Choose a folder',
        properties: ['openDirectory']
      });
      return (res.canceled || !res.filePaths.length) ? '' : res.filePaths[0];
    });

    ipcMain.handle('desktop:list-files', async (_event, dir) => {
      if (!isDir(dir)) return { error: 'no such folder', files: [] };
      try {
        const names = fs.readdirSync(dir, { withFileTypes: true })
          .filter((d) => d.isFile())
          .map((d) => d.name);
        return { error: '', files: names };
      } catch (err) {
        return { error: err.message, files: [] };
      }
    });

    ipcMain.handle('desktop:rename-many', async (_event, dir, ops) => {
      if (!isDir(dir)) return { error: 'no such folder', done: [] };
      if (!Array.isArray(ops) || !ops.length) return { error: 'nothing to do', done: [] };
      for (const op of ops) {
        if (!op || !isPlainName(op.from) || !isPlainName(op.to)) {
          return { error: 'invalid file name in the request', done: [] };
        }
      }

      const full = (n) => path.join(dir, n);
      const sources = new Set(ops.map((o) => o.from.toLowerCase()));

      // Refuse to clobber a file that is not part of this batch.
      for (const op of ops) {
        const target = op.to.toLowerCase();
        if (target === op.from.toLowerCase()) continue;
        if (!sources.has(target) && fs.existsSync(full(op.to))) {
          return { error: 'a file called "' + op.to + '" already exists', done: [] };
        }
      }

      // If any target is still occupied by another file in this batch, go
      // through temporary names so an A -> B, B -> A swap cannot lose a file.
      const needsTwoPass = ops.some(
        (o) => sources.has(o.to.toLowerCase()) && o.to.toLowerCase() !== o.from.toLowerCase()
      );

      const done = [];
      try {
        if (needsTwoPass) {
          const temps = ops.map((o, i) => '__tp_tmp_' + process.pid + '_' + i + '__');
          ops.forEach((o, i) => fs.renameSync(full(o.from), full(temps[i])));
          ops.forEach((o, i) => {
            fs.renameSync(full(temps[i]), full(o.to));
            done.push({ from: o.from, to: o.to });
          });
        } else {
          for (const o of ops) {
            fs.renameSync(full(o.from), full(o.to));
            done.push({ from: o.from, to: o.to });
          }
        }
        return { error: '', done };
      } catch (err) {
        return { error: err.message, done };
      }
    });

    // Opens a folder in the file manager. Validated as an existing directory
    // rather than trusted blindly, even though the only caller is our own page.
    ipcMain.handle('desktop:open-folder', async (_event, folderPath) => {
      if (!isDir(folderPath)) return 'no such folder';
      return shell.openPath(folderPath);
    });

    sceneSyncHost = require('./scene-sync-host.cjs').registerSceneSync({app,ipcMain,dialog,BrowserWindow,shell});
    registerProtocol();
    registerDownloadHandler();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
