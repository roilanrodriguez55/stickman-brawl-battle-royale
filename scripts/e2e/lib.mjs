// Arnes E2E minimo: servidor del juego, Chrome headless via CDP (ws), cliente host por WebSocket.
// Sin dependencias nuevas: usa solo node:* y la libreria ws ya instalada.
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PLAYERS_FILE = path.join(REPO, 'data', 'players.json');
const SCRATCH = '/tmp/claude-1000/-home-roilan-Downloads-stickman-brawl--50p-battle-royale/351a812c-f901-4852-b931-89bc5313223c/scratchpad';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function scratchDir(sub = 'e2e') {
  const dir = path.join(SCRATCH, sub);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function sha256File(file) {
  if (!fs.existsSync(file)) return null;
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// Copia data/players.json (si existe) para restaurarlo al final de la prueba.
export function snapshotPlayers() {
  const existed = fs.existsSync(PLAYERS_FILE);
  const backup = existed ? fs.readFileSync(PLAYERS_FILE) : null;
  const sha256Before = sha256File(PLAYERS_FILE);
  return {
    sha256Before,
    restore() {
      if (existed) fs.writeFileSync(PLAYERS_FILE, backup);
      else if (fs.existsSync(PLAYERS_FILE)) fs.rmSync(PLAYERS_FILE);
      return sha256File(PLAYERS_FILE);
    },
  };
}

export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 1500 }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}

async function waitHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const r = await httpGet(url);
      if (r.status === 200) return r;
    } catch (e) {
      lastErr = e;
    }
    await sleep(300);
  }
  throw new Error(`timeout esperando ${url}: ${lastErr?.message ?? 'sin respuesta'}`);
}

// Arranca `npx tsx server.ts` en su propio grupo de procesos. stop() mata solo ese grupo.
export async function startServer({ port, env = {}, timeoutMs = 60000 }) {
  const child = spawn('npx', ['tsx', 'server.ts'], {
    cwd: REPO,
    env: { ...process.env, PORT: String(port), LAN_DISCOVERY: '0', ...env },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = [];
  child.stdout.on('data', (d) => logs.push(String(d)));
  child.stderr.on('data', (d) => logs.push(String(d)));
  let exited = false;
  const exitPromise = new Promise((resolve) => child.once('exit', () => { exited = true; resolve(); }));
  try {
    await waitHttp(`http://127.0.0.1:${port}/api/rooms`, timeoutMs);
  } catch (e) {
    await stopGroup();
    throw new Error(`${e.message}\nlog servidor:\n${logs.join('').slice(-2000)}`);
  }
  async function stopGroup() {
    if (!exited) {
      try { process.kill(-child.pid, 'SIGTERM'); } catch { /* ya terminado */ }
      const t = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* ok */ } }, 3000);
      await exitPromise;
      clearTimeout(t);
    }
    // Espera a que el puerto quede libre
    for (let i = 0; i < 30; i++) {
      try { await httpGet(`http://127.0.0.1:${port}/api/rooms`); await sleep(200); } catch { break; }
    }
  }
  return {
    pid: child.pid,
    port,
    logs,
    stop: stopGroup,
  };
}

// ---------- Cliente CDP minimo ----------
class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message}`));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners.get(msg.method) ?? []) fn(msg.params ?? {});
      }
    });
  }
  open() {
    return new Promise((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }
  close() {
    try { this.ws.close(); } catch { /* ok */ }
  }
}

function buildChromeArgs({ port, userDir, width, height }) {
  return [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDir}`,
    `--window-size=${width},${height}`,
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-extensions',
    'about:blank',
  ];
}

function makePageHelpers(cdp, width, height) {
  const messages = [];
  const page = {
    cdp,
    width,
    height,
    async goto(url) {
      await cdp.send('Page.navigate', { url });
      await page.waitFor('() => document.readyState === "complete" && !!document.body', 20000);
    },
    async evaluate(expr) {
      const r = await cdp.send('Runtime.evaluate', {
        expression: expr,
        awaitPromise: true,
        returnByValue: true,
      });
      if (r.exceptionDetails) {
        const d = r.exceptionDetails;
        throw new Error(`evaluate: ${d.exception?.description ?? d.text}`);
      }
      return r.result.value;
    },
    async screenshot(file, clip) {
      const params = { format: 'png', captureBeyondViewport: false };
      if (clip) params.clip = { ...clip, scale: 1 };
      const { data } = await cdp.send('Page.captureScreenshot', params);
      const buf = Buffer.from(data, 'base64');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, buf);
      return { file, bytes: buf.length, base64: data };
    },
    // movementX/Y y buttons son opcionales; buttons=1 indica boton izquierdo presionado durante el movimiento
    async mouseMove(x, y, { movementX = 0, movementY = 0, buttons = 0 } = {}) {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x, y, movementX, movementY, buttons,
      });
    },
    async mouseDown(x, y, button = 'left') {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed', x, y, button, clickCount: 1, buttons: button === 'left' ? 1 : 2,
      });
    },
    async mouseUp(x, y, button = 'left') {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased', x, y, button, clickCount: 1, buttons: 0,
      });
    },
    async click(x, y) {
      await page.mouseMove(x, y);
      await page.mouseDown(x, y);
      await page.mouseUp(x, y);
    },
    async keyDown(key, modifiers = 0) {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, modifiers, ...keyText(key) });
    },
    async keyUp(key, modifiers = 0) {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, modifiers, ...keyText(key) });
    },
    // fnString: texto de una funcion flecha, p. ej. "() => !!document.querySelector('canvas')"
    async waitFor(fnString, timeout = 15000) {
      const deadline = Date.now() + timeout;
      let last;
      while (Date.now() < deadline) {
        try {
          last = await page.evaluate(`(${fnString})()`);
          if (last) return last;
        } catch (e) {
          last = e.message;
        }
        await sleep(150);
      }
      throw new Error(`waitFor agoto ${timeout}ms: ${fnString} (ultimo: ${String(last)})`);
    },
    async addInitScript(source) {
      const r = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source });
      return r.identifier;
    },
    consoleMessages() {
      return messages.slice();
    },
    _messages: messages,
  };
  cdp.on('Runtime.consoleAPICalled', (p) => {
    messages.push({
      kind: 'console',
      type: p.type,
      text: (p.args ?? []).map((a) => a.value ?? a.description ?? a.type).join(' '),
    });
  });
  cdp.on('Runtime.exceptionThrown', (p) => {
    const d = p.exceptionDetails ?? {};
    messages.push({ kind: 'exception', type: 'error', text: d.exception?.description ?? d.text ?? 'exception' });
  });
  cdp.on('Network.responseReceived', (p) => {
    const st = p.response?.status ?? 0;
    if (st >= 400) messages.push({ kind: 'http', type: 'error', text: `${st} ${p.response.url}` });
  });
  cdp.on('Log.entryAdded', (p) => {
    messages.push({ kind: 'log', type: p.entry.level, text: `${p.entry.source}: ${p.entry.text}` });
  });
  return page;
}

const KEY_CODES = { Enter: 13, Escape: 27, Tab: 9, ' ': 32, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };
function keyText(key) {
  if (key.length === 1) return { text: key, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0) };
  return { windowsVirtualKeyCode: KEY_CODES[key] ?? 0 };
}

// Lanza Chrome headless con DevTools y devuelve { page, close() }. page.cdp es el cliente CDP.
export async function launchChrome({ width = 1280, height = 720 } = {}) {
  const port = await freePort();
  const userDir = fs.mkdtempSync(path.join(scratchDir('chrome-profiles'), 'profile-'));
  const child = spawn('/usr/bin/google-chrome', buildChromeArgs({ port, userDir, width, height }), {
    detached: true,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const stderr = [];
  child.stderr.on('data', (d) => stderr.push(String(d)));
  let exited = false;
  child.once('exit', () => { exited = true; });

  let targets;
  try {
    const deadline = Date.now() + 30000;
    for (;;) {
      try {
        const r = await httpGet(`http://127.0.0.1:${port}/json/list`);
        targets = JSON.parse(r.body).filter((t) => t.type === 'page');
        if (targets.length) break;
      } catch { /* aun no listo */ }
      if (Date.now() > deadline) throw new Error('Chrome no expuso DevTools');
      await sleep(200);
    }
  } catch (e) {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* ok */ }
    throw new Error(`${e.message}\n${stderr.join('').slice(-1500)}`);
  }

  const cdp = new Cdp(targets[0].webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Network.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const page = makePageHelpers(cdp, width, height);

  return {
    page,
    port,
    pid: child.pid,
    async close() {
      cdp.close();
      if (!exited) {
        try { process.kill(-child.pid, 'SIGTERM'); } catch { /* ok */ }
        for (let i = 0; i < 50 && !exited; i++) await sleep(100);
        if (!exited) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* ok */ } }
      }
      fs.rmSync(userDir, { recursive: true, force: true });
    },
  };
}

// Cliente host por WebSocket: crea sala, configura lobby y permite iniciar la partida.
export function hostClient({ port, name = 'HOST', roomName = 'E2E-ROOM' }) {
  const clientId = randomUUID();
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const inbox = [];
  let roomId = null;
  const waiters = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.type === 'room_joined') roomId = msg.roomId;
    inbox.push(msg);
    for (const w of waiters.splice(0)) w();
  });
  const send = (msg) => ws.send(JSON.stringify(msg));
  const waitMsg = (type, timeout = 10000) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`host: timeout esperando ${type}`)), timeout);
      const check = () => {
        const i = inbox.findIndex((m) => m.type === type);
        if (i >= 0) {
          clearTimeout(t);
          resolve(inbox.splice(i, 1)[0]);
        } else waiters.push(check);
      };
      check();
    });
  return {
    clientId,
    get roomId() { return roomId; },
    async open() {
      await new Promise((resolve, reject) => {
        ws.once('open', resolve);
        ws.once('error', reject);
      });
    },
    async createRoom() {
      await this.open();
      send({ type: 'create_room', name: roomName, mode: 'ffa', size: 4, playerName: name, clientId });
      const joined = await waitMsg('room_joined');
      send({ type: 'lobby_config', mode: 'ffa', size: 4, fillBots: true, botDifficulty: 'easy' });
      return joined.roomId;
    },
    start() {
      send({ type: 'start_match' });
    },
    close() {
      try { ws.close(); } catch { /* ok */ }
    },
  };
}

export { sleep, SCRATCH };
