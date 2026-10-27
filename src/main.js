'use strict';

const {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  Menu,
  Tray,
  nativeImage,
  shell
} = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { CodexWatcher } = require('./codex-watch');

const SNAPSHOT = process.argv.includes('--snapshot');
const SIZES = [180, 230, 290];
const LABELS = {
  idle: '待机',
  curious: '好奇',
  thinking: '思考中',
  working: '工作中',
  done: '完成',
  error: '出错',
  sleep: '睡着',
  happy: '开心',
  surprised: '惊讶'
};
const VALID = new Set(Object.keys(LABELS));
const STATUS_LINE = {
  idle: '待机 · 等你派活',
  curious: '好奇 · 盯着你',
  thinking: '思考中…',
  working: '工作中 · 敲代码',
  done: '完成 · 撒花',
  error: '出错了…',
  sleep: '睡着了',
  happy: '开心',
  surprised: '惊讶'
};

let win = null;
let tray = null;
let watcher = null;
let server = null;
let currentState = 'idle';
let manualUntil = 0;
let revertTimer = null;
let cursorTimer = null;
let dragTimer = null;
let dragOffset = { x: 0, y: 0 };
let dragMoved = false;
let dragStart = { x: 0, y: 0 };
let saveTimer = null;
let quitting = false;

const cfg = {
  pos: null,
  size: 1,
  follow: true,
  alwaysOnTop: true
};

app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.setName('Codex Pet');
if (process.env.CODEX_PET_HOME) {
  try {
    fs.mkdirSync(process.env.CODEX_PET_HOME, { recursive: true });
    app.setPath('userData', process.env.CODEX_PET_HOME);
  } catch {
    /* ignore */
  }
}
if (process.platform === 'darwin' && !SNAPSHOT) {
  try {
    app.dock.hide();
  } catch {
    /* dock is not available in every environment */
  }
}

/* ------------------------------------------------------------------ */
/* config                                                              */
/* ------------------------------------------------------------------ */

function configFiles() {
  const list = [];
  try {
    list.push(path.join(app.getPath('userData'), 'pet-state.json'));
  } catch {
    /* ignore */
  }
  list.push(path.join(__dirname, '..', '.data', 'pet-state.json'));
  return list;
}

function loadConfig() {
  for (const file of configFiles()) {
    try {
      Object.assign(cfg, JSON.parse(fs.readFileSync(file, 'utf8')));
      return;
    } catch {
      /* try next */
    }
  }
}

function saveConfig() {
  for (const file of configFiles()) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
      return;
    } catch {
      /* read-only location, try next */
    }
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveConfig, 450);
}

/* ------------------------------------------------------------------ */
/* window                                                              */
/* ------------------------------------------------------------------ */

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}

function visibleOnSomeScreen(pos) {
  if (!pos) return false;
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return (
      pos.x + 60 > a.x &&
      pos.x < a.x + a.width - 40 &&
      pos.y + 60 > a.y &&
      pos.y < a.y + a.height - 40
    );
  });
}

function defaultPosition(size) {
  const a = screen.getPrimaryDisplay().workArea;
  return {
    x: Math.round(a.x + a.width - size - 36),
    y: Math.round(a.y + a.height - size - 24)
  };
}

function createWindow() {
  const size = SIZES[clamp(cfg.size || 0, 0, SIZES.length - 1)];
  const pos = visibleOnSomeScreen(cfg.pos) ? cfg.pos : defaultPosition(size);

  win = new BrowserWindow({
    width: size,
    height: size,
    x: Math.round(pos.x),
    y: Math.round(pos.y),
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: !!cfg.alwaysOnTop,
    focusable: false,
    acceptFirstMouse: true,
    backgroundColor: '#00000000',
    show: false,
    type: process.platform === 'darwin' ? 'panel' : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false
    }
  });

  win.setAlwaysOnTop(!!cfg.alwaysOnTop, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (process.platform === 'darwin') win.setWindowButtonVisibility(false);

  win.loadFile(path.join(__dirname, 'orb', 'pet.html'));
  win.once('ready-to-show', () => {
    win.showInactive();
    sendState(currentState);
  });
  win.webContents.on('did-finish-load', () => sendState(currentState));
  win.on('closed', () => {
    win = null;
  });

  startCursorLoop();
}

function sendState(state) {
  if (win && !win.isDestroyed()) win.webContents.send('pet:state', state);
}

function startCursorLoop() {
  clearInterval(cursorTimer);
  cursorTimer = setInterval(() => {
    if (!win || win.isDestroyed() || !win.isVisible()) return;
    const p = screen.getCursorScreenPoint();
    const b = win.getBounds();
    win.webContents.send('pet:cursor', { x: p.x - b.x, y: p.y - b.y });
  }, 33);
}

function resizeWindow(nextSize) {
  if (!win) return;
  const size = SIZES[clamp(nextSize, 0, SIZES.length - 1)];
  const b = win.getBounds();
  const area = screen.getDisplayMatching(b).workArea;
  cfg.size = nextSize;
  win.setSize(size, size, true);
  win.setPosition(
    clamp(b.x, area.x, area.x + area.width - size),
    clamp(b.y, area.y, area.y + area.height - size),
    true
  );
  if (win.webContents) win.webContents.send('pet:scale', size);
  saveConfig();
}

/* ------------------------------------------------------------------ */
/* state machine                                                       */
/* ------------------------------------------------------------------ */

function setState(name, opts = {}) {
  if (!VALID.has(name)) return;
  const now = Date.now();
  const source = opts.source || 'auto';
  if (source === 'auto' && !opts.force && now < manualUntil) return;

  if (source === 'manual' || source === 'api') {
    const ttl = opts.ttl == null ? 8000 : opts.ttl;
    manualUntil = now + ttl;
  }

  currentState = name;
  sendState(name);
  updateTray();

  clearTimeout(revertTimer);
  const ttl = opts.ttl == null ? (name === 'done' || name === 'error' ? 7000 : 0) : opts.ttl;
  if (ttl > 0) {
    revertTimer = setTimeout(() => {
      if (currentState !== name) return;
      manualUntil = 0;
      const live = cfg.follow && watcher && watcher.state !== name ? watcher.state : 'idle';
      setState(live, { source: 'auto', force: true });
    }, ttl);
  }
}

function greet() {
  setState('happy', { source: 'manual', ttl: 2600 });
}

/* ------------------------------------------------------------------ */
/* Codex watcher                                                       */
/* ------------------------------------------------------------------ */

function startWatcher() {
  watcher = new CodexWatcher();
  watcher.on('state', (state) => {
    if (!cfg.follow) return;
    if (state === 'done' || state === 'error') {
      // one-shot celebrations / sad faces come with their own ttl
      setState(state, { source: 'auto', ttl: 7000 });
    } else {
      setState(state, { source: 'auto' });
    }
  });
  watcher.start();
}

/* ------------------------------------------------------------------ */
/* local control API                                                   */
/* ------------------------------------------------------------------ */

function startServer() {
  const port = Number(process.env.CODEX_PET_PORT || 47821);
  server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }

    let url;
    try {
      url = new URL(req.url, 'http://127.0.0.1');
    } catch {
      res.writeHead(400).end('bad request');
      return;
    }
    const reply = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };

    if (url.pathname === '/ping') {
      reply(200, {
        ok: true,
        state: currentState,
        codex: watcher ? watcher.state : null,
        pet: 'Codex Pet'
      });
      return;
    }
    if (url.pathname === '/state') {
      const name = url.searchParams.get('name');
      const ttl = url.searchParams.has('ttl') ? Number(url.searchParams.get('ttl')) : undefined;
      if (!VALID.has(name)) {
        reply(400, { ok: false, error: 'unknown state', valid: [...VALID] });
        return;
      }
      setState(name, { source: 'api', ttl: ttl == null ? 6000 : ttl });
      reply(200, { ok: true, state: name });
      return;
    }
    if (url.pathname === '/poke') {
      greet();
      reply(200, { ok: true });
      return;
    }
    reply(404, { ok: false });
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[codex-pet] port ${port} busy; local control API disabled`);
    } else {
      console.warn('[codex-pet] control server error:', err.message);
    }
  });
  server.listen(port, '127.0.0.1');
}

/* ------------------------------------------------------------------ */
/* tray & menu                                                         */
/* ------------------------------------------------------------------ */

function stateMenu() {
  return Object.entries(LABELS).map(([key, label]) => ({
    label,
    type: 'radio',
    checked: currentState === key,
    click: () => setState(key, { source: 'manual', ttl: key === 'happy' ? 2600 : 12000 })
  }));
}

function sizeMenu() {
  const names = ['小', '标准', '大'];
  return names.map((label, i) => ({
    label,
    type: 'radio',
    checked: (cfg.size || 1) === i,
    click: () => resizeWindow(i)
  }));
}

function buildMenu(includeTrayOnly) {
  const status = `${STATUS_LINE[currentState] || currentState}`;
  const template = [
    { label: `Codex · ${status}`, enabled: false },
    { type: 'separator' },
    { label: '打个招呼', click: greet },
    { label: '表情', submenu: stateMenu() },
    { type: 'separator' },
    {
      label: '自动跟随 Codex',
      type: 'checkbox',
      checked: !!cfg.follow,
      click: (item) => {
        cfg.follow = item.checked;
        saveConfig();
        if (cfg.follow && watcher) setState(watcher.state, { source: 'auto' });
      }
    },
    {
      label: '始终置顶',
      type: 'checkbox',
      checked: !!cfg.alwaysOnTop,
      click: (item) => {
        cfg.alwaysOnTop = item.checked;
        if (win) win.setAlwaysOnTop(item.checked, 'floating');
        saveConfig();
      }
    },
    { label: '大小', submenu: sizeMenu() },
    {
      label: '回到右下角',
      click: () => {
        if (!win) return;
        const size = SIZES[clamp(cfg.size || 1, 0, 2)];
        const p = defaultPosition(size);
        win.setPosition(p.x, p.y, true);
        cfg.pos = p;
        saveConfig();
      }
    },
    { type: 'separator' },
    {
      label: '打开表情预览',
      click: () => shell.openPath(path.join(__dirname, 'gallery.html'))
    },
    { label: '退出 Codex Pet', click: () => { quitting = true; app.quit(); } }
  ];
  return Menu.buildFromTemplate(template);
}

function updateTray() {
  if (!tray) return;
  tray.setToolTip(`Codex Pet · ${STATUS_LINE[currentState] || currentState}`);
}

function createTray() {
  const iconPath = path.join(__dirname, '..', 'assets', 'trayTemplate.png');
  let icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) {
    icon = nativeImage.createEmpty();
  } else {
    icon = icon.resize({ width: 20, height: 20 });
    if (process.platform === 'darwin') icon.setTemplateImage(true);
  }
  tray = new Tray(icon);
  tray.setIgnoreDoubleClickEvents(true);
  let lastMenuAt = 0;
  const openTrayMenu = () => {
    if (Date.now() - lastMenuAt < 250) return;
    lastMenuAt = Date.now();
    tray.popUpContextMenu(buildMenu(true));
  };
  tray.on('click', openTrayMenu);
  tray.on('right-click', openTrayMenu);
  updateTray();
}

/* ------------------------------------------------------------------ */
/* IPC                                                                 */
/* ------------------------------------------------------------------ */

function wireIpc() {
  ipcMain.on('pet:pointer-down', (_event, offset) => {
    if (!win) return;
    dragOffset = { x: Number(offset.x) || 0, y: Number(offset.y) || 0 };
    dragMoved = false;
    const p = screen.getCursorScreenPoint();
    dragStart = { x: p.x, y: p.y };
    clearInterval(dragTimer);
    dragTimer = setInterval(() => {
      if (!win || win.isDestroyed()) return;
      const cursor = screen.getCursorScreenPoint();
      if (!dragMoved && Math.hypot(cursor.x - dragStart.x, cursor.y - dragStart.y) > 3) {
        dragMoved = true;
      }
      if (!dragMoved) return;
      const display = screen.getDisplayNearestPoint(cursor);
      const area = display.workArea;
      const b = win.getBounds();
      const x = clamp(cursor.x - dragOffset.x, area.x - 30, area.x + area.width - b.width + 30);
      const y = clamp(cursor.y - dragOffset.y, area.y - 10, area.y + area.height - b.height + 30);
      win.setPosition(Math.round(x), Math.round(y), false);
      scheduleSave();
    }, 12);
  });

  ipcMain.on('pet:pointer-up', () => {
    clearInterval(dragTimer);
    dragTimer = null;
    if (!win) return;
    if (dragMoved) {
      const b = win.getBounds();
      cfg.pos = { x: b.x, y: b.y };
      saveConfig();
      win.webContents.send('pet:dropped');
      sendState(currentState);
    } else {
      greet();
    }
  });

  ipcMain.on('pet:menu', () => {
    if (!win) return;
    const menu = buildMenu(false);
    menu.popup({ window: win });
  });

  ipcMain.on('pet:request-state', () => sendState(currentState));
}

/* ------------------------------------------------------------------ */
/* snapshots (used by the build / docs)                                */
/* ------------------------------------------------------------------ */

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runSnapshots() {
  const out = path.join(__dirname, '..', 'snapshots');
  fs.mkdirSync(out, { recursive: true });

  const gallery = new BrowserWindow({
    width: 1320,
    height: 900,
    show: false,
    backgroundColor: '#0b0c0f',
    webPreferences: { offscreen: true, backgroundThrottling: false }
  });
  await gallery.loadFile(path.join(__dirname, 'gallery.html'), { query: { static: '1' } });
  await wait(1600);
  let img = await gallery.webContents.capturePage();
  fs.writeFileSync(path.join(out, 'expressions.png'), img.toPNG());
  gallery.destroy();

  const states = ['idle', 'curious', 'thinking', 'working', 'done', 'error', 'sleep', 'happy'];
  for (const state of states) {
    const w = new BrowserWindow({
      width: 280,
      height: 280,
      show: false,
      transparent: true,
      frame: false,
      backgroundColor: '#00000000',
      webPreferences: { offscreen: true, backgroundThrottling: false }
    });
    await w.loadFile(path.join(__dirname, 'orb', 'pet.html'), {
      query: { static: '1', state, t: state === 'done' ? '0.75' : '1.2' }
    });
    await wait(450);
    const shot = await w.webContents.capturePage();
    fs.writeFileSync(path.join(out, `orb-${state}.png`), shot.toPNG());
    w.destroy();
  }
  console.log('[codex-pet] snapshots written to', out);
  app.quit();
}

/* ------------------------------------------------------------------ */
/* boot                                                                */
/* ------------------------------------------------------------------ */

if (!SNAPSHOT) {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    app.on('second-instance', () => {
      if (win) {
        win.showInactive();
        win.setAlwaysOnTop(true, 'floating');
      }
    });
  }
}

app.whenReady().then(() => {
  if (SNAPSHOT) {
    runSnapshots().catch((err) => {
      console.error(err);
      app.exit(1);
    });
    return;
  }

  loadConfig();
  createWindow();
  createTray();
  startWatcher();
  startServer();
  wireIpc();

  app.on('activate', () => {
    if (!win) createWindow();
    else win.showInactive();
  });

  if (process.env.CODEX_PET_SELFTEST) runSelftest();
});

async function runSelftest() {
  if (win) {
    win.setPosition(80, 80, false);
    win.moveTop();
  }
  await wait(5200);
  try {
    const api = 'http://127.0.0.1:47821';
    let r = await fetch(api + '/ping');
    console.log('[selftest] ping', await r.text());
    let img = await win.capturePage();
    fs.writeFileSync(path.join(__dirname, '..', 'snapshots', 'live-idle.png'), img.toPNG());
    await fetch(api + '/state?name=thinking&ttl=30000');
    await wait(1200);
    const dbg = await win.webContents.executeJavaScript(
      `JSON.stringify({ state: window.__orb.state, time: +window.__orb.time.toFixed(2), blink: +window.__orb.blink.value.toFixed(2), vis: document.visibilityState, hidden: document.hidden, frames: window.__orb._frames })`
    );
    console.log('[selftest] orb', dbg, 'visible=', win.isVisible());
    img = await win.capturePage();
    fs.writeFileSync(path.join(__dirname, '..', 'snapshots', 'live-thinking.png'), img.toPNG());
    r = await fetch(api + '/ping');
    console.log('[selftest] after /state', await r.text());

    win.webContents.sendInputEvent({ type: 'mouseDown', x: 140, y: 140, button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseUp', x: 140, y: 140, button: 'left', clickCount: 1 });
    await wait(600);
    r = await fetch(api + '/ping');
    console.log('[selftest] after click', await r.text());
  } catch (err) {
    console.error('[selftest] failed', err);
  } finally {
    app.exit(0);
  }
}

app.on('before-quit', () => {
  quitting = true;
  clearInterval(cursorTimer);
  clearInterval(dragTimer);
  if (watcher) watcher.stop();
  if (server) server.close();
});

app.on('window-all-closed', () => {
  if (quitting) app.quit();
});
