// Prueba de los ataques con el mouse: clic izquierdo = golpe, clic derecho = patada, solo con el mouse
// capturado en combate. Tambien cubre Ctrl+Alt (cursor libre), menu contextual, buscador/lobby y J/K.
// Uso: node scripts/e2e/mouse_attack.mjs   (capturas y report.json en el scratchpad, carpeta mouse-attack)
// Cada ataque se mide en el WebSocket: se registran los mensajes 'input' que envia el cliente con attackId.
import path from 'node:path';
import fs from 'node:fs';
import { startServer, launchChrome, hostClient, snapshotPlayers, scratchDir, sleep } from './lib.mjs';

const PORT = 3983;
const W = 1280;
const H = 720;
const CLIENT_ID = '3b9e1c7a-5d2f-4e8b-a1c6-7f0d2e9b4a18';
const CX = Math.round(W * 0.5);
const CY = Math.round(H * 0.35);
const out = scratchDir('mouse-attack');
const report = { port: PORT, steps: {}, checks: {}, consoleErrors: [], notes: [] };

// Hook antes de la app: registra cada 'input' con attackId enviado por el WebSocket y los contextmenu
const ATTACK_HOOK = `(() => {
  window.__atk = [];
  window.__ctx = [];
  const send = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data) {
    try {
      if (typeof data === 'string') {
        const m = JSON.parse(data);
        if (m && m.type === 'input' && m.input && m.input.attackId) {
          window.__atk.push({ id: m.input.attackId, t: performance.now() });
        }
      }
    } catch (e) { /* no es JSON */ }
    return send.apply(this, arguments);
  };
  window.addEventListener('contextmenu', (e) => setTimeout(() => window.__ctx.push(e.defaultPrevented), 0));
})();`;

async function main() {
  const players = snapshotPlayers();
  report.playersSha256Before = players.sha256Before;
  let server = null;
  let chrome = null;
  let host = null;
  try {
    server = await startServer({ port: PORT });
    chrome = await launchChrome({ width: W, height: H });
    const page = chrome.page;
    await page.addInitScript(`try {
      localStorage.setItem('combat_player_name', 'TESTER');
      localStorage.setItem('combat_client_id', '${CLIENT_ID}');
    } catch (e) {}`);
    await page.addInitScript(ATTACK_HOOK);

    // Ids de ataque enviados desde que se llama a fn (y un asentamiento de frames)
    // Solo el luchador vivo envia ataques: se registra si estaba vivo antes y despues de cada medicion
    const alive = () => page.evaluate(`!/ESPECTANDO|HAS CA/.test(document.body.innerText)`);
    report.aliveLog = [];
    const during = async (fn, settle = 450) => {
      const alive0 = await alive();
      const before = await page.evaluate('window.__atk.length');
      await fn();
      await sleep(settle);
      const ids = await page.evaluate(`window.__atk.slice(${before}).map((a) => a.id)`);
      report.aliveLog.push({ alive0, alive1: await alive(), ids });
      return ids;
    };
    const ctxCount = () => page.evaluate('window.__ctx.length');
    const ctxSince = (n) => page.evaluate(`window.__ctx.slice(${n})`);
    const isLocked = () => page.evaluate(`document.pointerLockElement !== null && document.pointerLockElement === document.querySelector('canvas')`);
    const rightClick = async (x, y) => {
      await page.mouseMove(x, y);
      await page.mouseDown(x, y, 'right');
      await page.mouseUp(x, y, 'right');
    };
    const leftClick = async (x, y) => {
      await page.mouseMove(x, y);
      await page.mouseDown(x, y, 'left');
      await page.mouseUp(x, y, 'left');
    };
    const toggleCombo = async () => {
      await page.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17, modifiers: 2 });
      await page.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18, modifiers: 3 });
      await page.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18, modifiers: 2 });
      await page.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17, modifiers: 0 });
      await sleep(500);
    };

    host = hostClient({ port: PORT, name: 'HOST', roomName: 'E2E-MOUSE' });
    await host.createRoom();

    // (f1) buscador: clics en zona vacia, sin partida
    await page.goto(`http://127.0.0.1:${PORT}`);
    await page.waitFor(`() => document.body.innerText.includes('E2E-MOUSE')`, 20000);
    await sleep(300);
    report.steps.f_buscador = {
      left: await during(() => leftClick(Math.round(W * 0.3), Math.round(H * 0.9))),
      right: await during(() => rightClick(Math.round(W * 0.3), Math.round(H * 0.9))),
    };
    await page.screenshot(path.join(out, '01_buscador.png'));

    const btn = await page.evaluate(`(() => {
      const li = [...document.querySelectorAll('li')].find((l) => l.innerText.includes('E2E-MOUSE'));
      const b = li && [...li.querySelectorAll('button')].find((x) => x.innerText.trim() === 'UNIRSE');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (!btn) throw new Error('no se encontro el boton UNIRSE de la sala E2E-MOUSE');
    await page.click(btn.x, btn.y);

    // (f2) lobby: el modal tapa la escena, los clics no atacan
    await page.waitFor(`() => document.body.innerText.includes('LUCHADORES')`, 20000);
    await sleep(500);
    report.steps.f_lobby = {
      left: await during(() => leftClick(CX, Math.round(H * 0.5))),
      right: await during(() => rightClick(CX, Math.round(H * 0.5))),
    };
    await page.screenshot(path.join(out, '02_lobby.png'));

    host.start();
    await page.waitFor(`() => { const t = document.body.innerText; return t.includes('STICKMAN BRAWL 3D') && !t.includes('INICIAR') && !t.includes('CREAR SALA'); }`, 30000);
    await sleep(3000);
    await page.waitFor(`() => !!document.querySelector('canvas')`, 10000);
    report.steps.fps_1s = await page.evaluate(`new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(f); else res(n); }; requestAnimationFrame(f); })`);

    // (a) antes de capturar: el clic izquierdo solo captura el mouse
    report.steps.a_clic_captura = { attacks: await during(() => leftClick(CX, CY), 600), locked: await isLocked() };
    await page.screenshot(path.join(out, '03_partida_tras_captura.png'));

    // (b) mouse capturado: izquierdo = punch, derecho = kick
    const ctxB0 = await ctxCount();
    report.steps.b_capturado = {
      locked: await isLocked(),
      left: await during(() => leftClick(CX, CY)),
      right: await during(() => rightClick(CX, CY)),
    };
    report.steps.e_contextmenu_clic_derecho = await ctxSince(ctxB0);

    // (c) tres clics izquierdos espaciados 120 ms
    report.steps.c_tres_clics = await during(async () => {
      for (let i = 0; i < 3; i++) {
        await page.mouseDown(CX, CY, 'left');
        await page.mouseUp(CX, CY, 'left');
        if (i < 2) await sleep(120);
      }
    });

    // (g) J y K siguen funcionando
    await sleep(300);
    report.steps.g_teclas = {
      locked: await isLocked(),
      j: await during(async () => { await page.keyDown('j'); await page.keyUp('j'); }),
      k: await during(async () => { await page.keyDown('k'); await page.keyUp('k'); }),
    };

    // (d) Ctrl+Alt muestra el cursor: los clics no atacan y el primer clic en la escena recaptura
    await toggleCombo();
    report.steps.d_modo_cursor = { locked: await isLocked() };
    await page.screenshot(path.join(out, '04_modo_cursor.png'));
    report.steps.d_clic_izquierdo_libre = { attacks: await during(() => leftClick(CX, CY), 600), locked: await isLocked() };
    await toggleCombo();
    const ctxD0 = await ctxCount();
    report.steps.d_clic_derecho_libre = { attacks: await during(() => rightClick(CX, CY), 600), locked: await isLocked() };
    report.steps.d_contextmenu_libre = await ctxSince(ctxD0);
    await page.screenshot(path.join(out, '05_tras_recaptura.png'));

    // Inspeccion visual: etiquetas nuevas de la barra de botones
    report.steps.barra = await page.evaluate(`[...document.querySelectorAll('button')].map((b) => b.innerText.trim()).filter((t) => /GOLPES|PATADAS|CLIC/.test(t))`);

    const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const s = report.steps;
    report.checks = {
      a_sin_ataque_y_captura: s.a_clic_captura.attacks.length === 0 && s.a_clic_captura.locked === true,
      b_izquierdo_punch: eq(s.b_capturado.left, ['punch']),
      b_derecho_kick: eq(s.b_capturado.right, ['kick']),
      c_tres_punch: eq(s.c_tres_clics, ['punch', 'punch', 'punch']),
      d_cursor_libre_sin_ataque: s.d_clic_izquierdo_libre.attacks.length === 0 && s.d_clic_derecho_libre.attacks.length === 0,
      d_recaptura_en_canvas: s.d_clic_izquierdo_libre.locked === true && s.d_clic_derecho_libre.locked === true,
      e_contextmenu_cancelado: s.d_contextmenu_libre.length > 0 && s.d_contextmenu_libre.every(Boolean)
        && s.e_contextmenu_clic_derecho.every(Boolean),
      f_buscador_y_lobby_sin_ataque: [s.f_buscador.left, s.f_buscador.right, s.f_lobby.left, s.f_lobby.right].every((x) => x.length === 0),
      g_j_punch_k_kick: eq(s.g_teclas.j, ['punch']) && eq(s.g_teclas.k, ['kick']),
    };
    report.passed = Object.values(report.checks).every(Boolean);

    report.consoleErrors = chrome.page.consoleMessages().filter((m) => m.type === 'error' || m.kind === 'exception');
  } catch (e) {
    report.error = e.message;
    if (chrome) report.consoleErrors = chrome.page.consoleMessages().filter((m) => m.type === 'error' || m.kind === 'exception');
    process.exitCode = 1;
  } finally {
    if (host) host.close();
    if (chrome) await chrome.close();
    if (server) await server.stop();
    report.playersSha256After = players.restore();
    report.playersRestored = report.playersSha256After === report.playersSha256Before;
    const file = path.join(out, 'report.json');
    fs.writeFileSync(file, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ reportFile: file, ...report }, null, 2));
    if (!report.passed) process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
