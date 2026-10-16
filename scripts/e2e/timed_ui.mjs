// UI del modo por tiempo en Chrome headless (requiere /usr/bin/google-chrome).
// Uso: node scripts/e2e/timed_ui.mjs   (capturas en el scratchpad, carpeta timed-ui, y report.json)
// (A) el navegador crea la sala por la interfaz, elige POR TIEMPO y 2 MIN con clics reales, e inicia la partida.
// (B) un cliente ws crea la sala por tiempo de 30 s; el navegador se une desde la lista y juega hasta el resultado.
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { startServer, launchChrome, snapshotPlayers, scratchDir, sleep } from './lib.mjs';

const PORT_A = 3984;
const PORT_B = 3985;
const W = 1280;
const H = 720;
const ID_A = '5b1e0c7a-2d3f-4e8a-9b6c-1a2b3c4d5e6f';
const ID_B = '6c2f1d8b-3e4a-4f9b-8c7d-2b3c4d5e6f70';
const ID_HOST_B = '7d3a2e9c-4f5b-4a0c-9d8e-3c4d5e6f7081';
const out = scratchDir('timed-ui');
const report = { steps: {}, consoleErrors: [], notes: [] };
const shot = (chrome, name) => chrome.page.screenshot(path.join(out, name));

// Asigna un valor a un input de React disparando su evento input
const setValue = (page, id, value) => page.evaluate(`(() => {
  const el = document.getElementById(${JSON.stringify(id)});
  if (!el) return false;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(String(value))});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);

// Centro en pantalla de un boton por su texto exacto
const btnCenter = (page, text) => page.evaluate(`(() => {
  const el = [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === ${JSON.stringify(text)} && !b.disabled);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`);

async function clickButton(page, text) {
  const c = await btnCenter(page, text);
  if (!c) throw new Error(`no hay boton habilitado "${text}"`);
  await page.click(c.x, c.y);
  await sleep(400);
}

// Cliente ws de node: host de la sala de la escenario B
function wsHost(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const inbox = [];
  let roomId = null;
  let snapshot = null;
  ws.on('message', (raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.type === 'room_joined') roomId = msg.roomId;
    if (msg.type === 'snapshot') snapshot = msg.snapshot;
    inbox.push(msg);
  });
  const send = (msg) => ws.send(JSON.stringify(msg));
  const until = (pred, timeout = 15000) => new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      if (pred()) resolve(true);
      else if (Date.now() - t0 > timeout) reject(new Error('host ws: timeout'));
      else setTimeout(tick, 100);
    };
    tick();
  });
  return {
    async open() {
      await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
    },
    async create(name) {
      send({ type: 'create_room', name, mode: 'ffa', size: 4, playerName: 'HOSTWS', clientId: ID_HOST_B });
      await until(() => roomId !== null);
      send({ type: 'lobby_config', mode: 'ffa', matchType: 'timed', matchSeconds: 30, size: 4, fillBots: true, botDifficulty: 'easy' });
      await until(() => snapshot && snapshot.matchType === 'timed' && snapshot.matchSeconds === 30);
      return roomId;
    },
    start() { send({ type: 'start_match' }); },
    close() { try { ws.close(); } catch { /* ok */ } },
  };
}

async function scenarioA(players) {
  const server = await startServer({ port: PORT_A });
  const chrome = await launchChrome({ width: W, height: H });
  try {
    const page = chrome.page;
    await page.addInitScript(`try { localStorage.setItem('combat_player_name', 'HOSTWEB'); localStorage.setItem('combat_client_id', '${ID_A}'); } catch (e) {}`);
    await page.goto(`http://127.0.0.1:${PORT_A}`);
    await page.waitFor(`() => document.body.innerText.includes('CREAR SALA')`, 30000);
    await setValue(page, 'room-name', 'Timed UI A');
    await setValue(page, 'room-size', 4);
    await sleep(300);
    await clickButton(page, 'CREAR');

    await page.waitFor(`() => document.body.innerText.includes('LUCHADORES')`, 20000);
    await sleep(400);
    await clickButton(page, 'POR TIEMPO');
    await page.waitFor(`() => document.body.innerText.includes('DURACIÓN')`, 10000);
    await clickButton(page, '2 MIN');
    await sleep(600);

    // Bots activos para llenar la sala de 4
    const botsChecked = await page.evaluate(`(() => { const c = document.querySelector('input[type=checkbox]'); return c ? c.checked : null; })()`);
    if (botsChecked === false) {
      const r = await page.evaluate(`(() => { const r = document.querySelector('input[type=checkbox]').closest('label').getBoundingClientRect(); return { x: r.left + 8, y: r.top + r.height / 2 }; })()`);
      await page.click(r.x, r.y);
      await sleep(400);
    }

    report.steps.a_dom = await page.evaluate(`({
      help: document.body.innerText.includes('Quien cae reaparece a los 3 s. Gana quien tenga mas eliminaciones al acabar el tiempo.'),
      presets: ['2 MIN', '3 MIN', '5 MIN', '10 MIN', '15 MIN'].map((t) => [...document.querySelectorAll('button')].some((b) => b.innerText.trim() === t)),
      timedActive: [...document.querySelectorAll('button')].some((b) => b.innerText.trim() === 'POR TIEMPO' && b.className.includes('border-cyan-glow')),
      twoMinActive: [...document.querySelectorAll('button')].some((b) => b.innerText.trim() === '2 MIN' && b.className.includes('border-cyan-glow')),
      botsChecked: document.querySelector('input[type=checkbox]') ? document.querySelector('input[type=checkbox]').checked : null,
    })`);
    await shot(chrome, 'A-lobby.png');

    await clickButton(page, 'INICIAR');
    await page.waitFor(`() => !!document.querySelector('canvas') && /TIEMPO\\s+\\d\\d:\\d\\d/.test(document.body.innerText)`, 30000);
    await sleep(3000);
    report.steps.a_hud = await page.evaluate(`({
      clock: (document.body.innerText.match(/TIEMPO\\s+(\\d\\d:\\d\\d)/) || [])[1] || null,
      kdRows: [...document.querySelectorAll('li')].map((li) => li.innerText.trim()).filter((t) => /\\d+\\/\\d+\\s*$/.test(t)).length,
      respawnOverlay: document.body.innerText.includes('REAPARECES EN'),
    })`);
    await shot(chrome, 'A-hud.png');
    report.consoleErrors.push(...chrome.page.consoleMessages().filter((m) => m.type === 'error' || m.kind === 'exception').map((m) => ({ scenario: 'A', ...m })));
  } finally {
    await chrome.close();
    await server.stop();
    players.restore();
  }
}

async function scenarioB(players) {
  const server = await startServer({ port: PORT_B });
  const host = wsHost(PORT_B);
  let chrome = null;
  try {
    await host.open();
    const roomName = 'Timed UI B';
    await host.create(roomName);

    chrome = await launchChrome({ width: W, height: H });
    const page = chrome.page;
    await page.addInitScript(`try { localStorage.setItem('combat_player_name', 'TESTERB'); localStorage.setItem('combat_client_id', '${ID_B}'); } catch (e) {}`);
    await page.goto(`http://127.0.0.1:${PORT_B}`);
    await page.waitFor(`() => document.body.innerText.includes('${roomName}')`, 20000);
    await sleep(300);
    const btn = await page.evaluate(`(() => {
      const li = [...document.querySelectorAll('li')].find((l) => l.innerText.includes('${roomName}'));
      const b = li && [...li.querySelectorAll('button')].find((x) => x.innerText.trim() === 'UNIRSE');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (!btn) throw new Error('no se encontro UNIRSE para la sala de la escenario B');
    await shot(chrome, 'B-browser.png');
    await page.click(btn.x, btn.y);
    await page.waitFor(`() => document.body.innerText.includes('LUCHADORES')`, 20000);
    await sleep(500);
    report.steps.b_lobby_dom = await page.evaluate(`({
      timedLabel: document.body.innerText.includes('POR TIEMPO'),
      help: document.body.innerText.includes('Quien cae reaparece a los 3 s'),
      waiting: document.body.innerText.includes('Esperando al host'),
    })`);
    await shot(chrome, 'B-lobby.png');

    host.start();
    await page.waitFor(`() => !!document.querySelector('canvas') && /TIEMPO\\s+\\d\\d:\\d\\d/.test(document.body.innerText)`, 30000);
    await sleep(3000);
    report.steps.b_hud = await page.evaluate(`({
      clock: (document.body.innerText.match(/TIEMPO\\s+(\\d\\d:\\d\\d)/) || [])[1] || null,
      kdRows: [...document.querySelectorAll('li')].map((li) => li.innerText.trim()).filter((t) => /\\d+\\/\\d+\\s*$/.test(t)).length,
    })`);
    await shot(chrome, 'B-hud.png');

    // Espera la reaparicion de un luchador (el jugador o un bot); si nadie cae en la partida, queda constancia
    try {
      await page.waitFor(`() => document.body.innerText.includes('REAPARECES EN')`, 25000);
      await sleep(500);
      report.steps.b_respawn = { overlay: true, text: await page.evaluate(`(document.body.innerText.match(/REAPARECES EN [\\d.]+/) || [null])[0]`) };
      await shot(chrome, 'B-respawn.png');
    } catch (e) {
      report.steps.b_respawn = { overlay: false, note: e.message };
    }

    await page.waitFor(`() => /COMBATE TERMINADO|FIN DEL COMBATE|HAS CAÍDO/.test(document.body.innerText)`, 60000);
    await sleep(1500);
    report.steps.b_result = await page.evaluate(`({
      kd: (document.body.innerText.match(/Eliminaciones\\s*(\\d+)\\s*·\\s*Muertes\\s*(\\d+)/) || []).slice(1),
      type: (document.body.innerText.match(/TIPO: ([^\\n]+)/) || [])[1] || null,
      winner: (document.body.innerText.match(/GANADOR\\s*\\n?([^\\n]+)/) || [])[1] || null,
    })`);
    await shot(chrome, 'B-result.png');
    report.consoleErrors.push(...chrome.page.consoleMessages().filter((m) => m.type === 'error' || m.kind === 'exception').map((m) => ({ scenario: 'B', ...m })));
  } finally {
    host.close();
    if (chrome) await chrome.close();
    await server.stop();
    players.restore();
  }
}

async function main() {
  const players = snapshotPlayers();
  report.playersSha256Before = players.sha256Before;
  try {
    await scenarioA(players);
    await scenarioB(players);
  } catch (e) {
    report.error = e.message;
    process.exitCode = 1;
  } finally {
    report.playersSha256After = players.restore();
    report.playersRestored = report.playersSha256After === report.playersSha256Before;
    const file = path.join(out, 'report.json');
    fs.writeFileSync(file, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ reportFile: file, ...report }, null, 2));
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
