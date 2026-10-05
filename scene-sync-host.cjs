'use strict';
// Desktop-only adapter. The tested engine runs in its own bundled Node process;
// renderer pages never receive Node, filesystem handles or shell commands.

const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');

// The page can ask for these and nothing else. Anything not on this list is
// refused before a process is started.
const ACTIONS = new Set(['scenes', 'open-projects', 'compare', 'apply', 'restore']);

// Paths pasted from Explorer arrive wrapped in quotes.
const clean = (p) => (typeof p === 'string' ? p.trim().replace(/^"|"$/g, '') : '');

class EngineHost {
  constructor(root, data) {
    this.root = root;
    this.data = data;
    this.running = false;
    this.plans = new Map();     // plan file -> the action that produced it
  }

  async run(req) {
    if (!req || !ACTIONS.has(req.action)) throw Error('Unsupported Scene Sync action.');
    if (this.running) throw Error('Wait for the current Scene Sync operation.');

    // Applying is only allowed against a plan this session previewed, so a
    // stale plan file cannot be replayed against changed scenes.
    const isApply = req.action === 'apply';
    if (isApply && this.plans.get(req.planPath) !== 'compare') {
      throw Error('Create a fresh preview before applying changes.');
    }

    this.running = true;
    let job;
    try {
      // The request travels as a file, never as command line arguments: no
      // page content is ever parsed by a shell.
      fs.mkdirSync(this.data, { recursive: true });
      job = path.join(this.data, crypto.randomUUID() + '.json');
      fs.writeFileSync(job, JSON.stringify(req), { flag: 'wx' });

      const result = await new Promise((resolve, reject) => {
        const proc = cp.spawn(
          path.join(this.root, 'runtime/node.exe'),
          [path.join(this.root, 'backend/api.cjs'), job],
          { cwd: this.root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
        );
        let output = '';
        let error = '';
        proc.stdout.setEncoding('utf8');
        proc.stderr.setEncoding('utf8');
        proc.stdout.on('data', (s) => { output += s; });
        // Keep only the tail: a runaway engine must not fill memory here.
        proc.stderr.on('data', (s) => { error = (error + s).slice(-16000); });
        proc.on('error', reject);
        proc.on('close', (code) => {
          try {
            const reply = JSON.parse(output);
            if (!reply.ok || code !== 0) {
              throw Error(reply.error || error || 'The sync engine failed.');
            }
            resolve(reply);
          } catch (e) {
            reject(Error(output ? e.message : 'The sync engine did not respond. ' + error));
          }
        });
      });

      if (result.planPath) this.plans.set(result.planPath, req.action);
      return result;
    } finally {
      // A plan is good for one apply only.
      if (isApply) this.plans.delete(req.planPath);
      if (job && fs.existsSync(job)) fs.unlinkSync(job);
      this.running = false;
    }
  }
}

// A portable build unpacks into a temporary folder that disappears on exit, so
// the engine is copied somewhere stable first - Unity may still be holding job
// paths afterwards. Every file is checked against the manifest on the way in
// and on every later launch.
function stableEngine(source, cache) {
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'));
  if (!/^[a-f0-9]{64}$/.test(manifest.version) || !Array.isArray(manifest.entries)) {
    throw Error('Invalid engine manifest. Rebuild Toolbox.');
  }
  for (const e of manifest.entries) {
    if (typeof e.file !== 'string' || path.isAbsolute(e.file) ||
        e.file.split(/[\\/]/).includes('..') || !/^[a-f0-9]{64}$/.test(e.sha256)) {
      throw Error('Invalid engine file entry.');
    }
  }

  const root = path.join(cache, manifest.version);
  const digest = (file) =>
    crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

  if (fs.existsSync(root)) {
    const intact = manifest.entries.every(
      (e) => fs.existsSync(path.join(root, e.file)) && digest(path.join(root, e.file)) === e.sha256);
    if (intact) return root;
    throw Error('The cached Scene Sync engine was modified. Rebuild or restore the engine cache: ' + root);
  }

  // Build it aside and move it into place in one step, so a half-copied engine
  // can never be found by the next launch.
  fs.mkdirSync(cache, { recursive: true });
  const stage = fs.mkdtempSync(path.join(cache, 'install-'));
  for (const e of manifest.entries) {
    const target = path.join(stage, e.file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(source, e.file), target);
    if (digest(target) !== e.sha256) throw Error('Engine copy could not be verified: ' + e.file);
  }
  fs.renameSync(stage, root);
  return root;
}

function registerSceneSync({ app, ipcMain, dialog, BrowserWindow, shell }) {
  const source = app.isPackaged
    ? path.join(process.resourcesPath, 'scene-sync')
    : path.join(__dirname, 'scene-sync');

  // Portable Electron extracts into a temporary folder. Keep job paths valid
  // even if Unity is still using the bridge when that folder is removed.
  const cacheBase = process.env.DAVFX_TOOLBOX_QA === '1'
    ? app.getPath('userData')
    : (process.env.LOCALAPPDATA || app.getPath('userData'));
  const cache = path.join(cacheBase, 'DAVFX/Toolbox/scene-sync-engine');
  const root = app.isPackaged ? stableEngine(source, cache) : source;

  const state = path.join(app.getPath('userData'), 'scene-sync.json');
  const host = new EngineHost(root, path.join(app.getPath('userData'), 'scene-sync-jobs'));

  // Every channel answers {ok, value} or {ok, error}, and only to the tool's
  // own page: a frame that is not app://local gets nothing.
  function handle(name, fn) {
    ipcMain.handle('scene-sync:' + name, async (event, ...args) => {
      try {
        const url = new URL(event.senderFrame.url);
        if (url.protocol !== 'app:' || url.hostname !== 'local') {
          throw Error('Untrusted Scene Sync page.');
        }
        return { ok: true, value: await fn(event, ...args) };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    });
  }

  handle('run', (_e, req) => host.run(req));

  // First run falls back to the standalone app's settings, so profiles and
  // backup paths carry over. From then on only Toolbox's own file is written.
  handle('load-settings', () => {
    let file = state;
    if (!fs.existsSync(file)) {
      file = path.join(process.env.LOCALAPPDATA || '', 'DAVFX/SceneSync/settings.json');
    }
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
    } catch {
      return {};
    }
  });

  handle('save-settings', (_e, value) => {
    const text = JSON.stringify(value);
    if (text.length > 2e6) throw Error('Settings are too large.');
    fs.mkdirSync(path.dirname(state), { recursive: true });
    // Write aside and rename: a crash mid-write must not leave an unreadable
    // settings file behind.
    const temp = state + '.tmp';
    fs.writeFileSync(temp, text);
    fs.renameSync(temp, state);
    return true;
  });

  handle('pick', async (event, kind, initial) => {
    if (!['folder', 'backup', 'scene'].includes(kind)) {
      throw Error('Unsupported file picker.');
    }
    // Open as close to the remembered path as still exists.
    let start = clean(initial);
    while (start && !fs.existsSync(start)) {
      const parent = path.dirname(start);
      if (parent === start) { start = ''; break; }
      start = parent;
    }
    const title = kind === 'folder' ? 'Choose a folder'
      : kind === 'backup' ? 'Choose a backup manifest'
      : 'Choose a Unity scene';
    const options = {
      title,
      defaultPath: start || undefined,
      properties: [kind === 'folder' ? 'openDirectory' : 'openFile']
    };
    if (kind === 'backup') options.filters = [{ name: 'Backup manifest', extensions: ['json'] }];
    if (kind === 'scene') options.filters = [{ name: 'Unity scene', extensions: ['unity'] }];

    const reply = await dialog.showOpenDialog(
      BrowserWindow.fromWebContents(event.sender), options);
    return reply.canceled ? '' : reply.filePaths[0];
  });

  handle('open-backup', async (_e, manifest) => {
    if (typeof manifest !== 'string' || !fs.existsSync(manifest) ||
        !fs.statSync(manifest).isFile()) {
      throw Error('Backup not found.');
    }
    const error = await shell.openPath(path.dirname(manifest));
    if (error) throw Error(error);
    return true;
  });

  handle('help', () => fs.readFileSync(path.join(root, 'README.md'), 'utf8'));

  return host;
}

module.exports = { EngineHost, stableEngine, registerSceneSync };
