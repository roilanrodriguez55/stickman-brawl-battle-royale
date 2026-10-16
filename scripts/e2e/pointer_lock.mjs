// Prueba del mouse capturado (Pointer Lock), modo cursor (Ctrl+Alt) y encuadre de la camara en partida.
// Uso: node scripts/e2e/pointer_lock.mjs   (capturas y report.json en el scratchpad, carpeta pointer-lock)
// Mide yaw/pitch y encuadre con las matrices viewMatrix/projectionMatrix que three.js sube a WebGL.
import path from 'node:path';
import fs from 'node:fs';
import { startServer, launchChrome, hostClient, snapshotPlayers, scratchDir, sleep } from './lib.mjs';

const PORT = 3982;
const W = 1280;
const H = 720;
const CLIENT_ID = '7a2d3c4e-1f5b-4a6c-9d8e-0f1a2b3c4d5e';
const RING_RADIUS = 13.5; // radio de anillo + margen (ARENA_BOUNDS.radius + 1.5)
const RING_POINTS = 16;
const out = scratchDir('pointer-lock');
const report = { port: PORT, steps: {}, consoleErrors: [], notes: [] };

// Hook de WebGL (antes de la app): ultima viewMatrix y projectionMatrix subidas por frame
const VIEW_HOOK = `(() => {
  const names = new WeakMap();
  window.__view = null; window.__proj = null; window.__viewCount = 0;
  for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!C) continue;
    const gul = C.prototype.getUniformLocation;
    C.prototype.getUniformLocation = function (p, n) {
      const loc = gul.call(this, p, n);
      if (loc && typeof loc === 'object') names.set(loc, n);
      return loc;
    };
    const um = C.prototype.uniformMatrix4fv;
    C.prototype.uniformMatrix4fv = function (loc, t, v) {
      const n = loc && names.get(loc);
      if (n === 'viewMatrix') { window.__view = Array.from(v).slice(0, 16); window.__viewCount++; }
      else if (n === 'projectionMatrix') { window.__proj = Array.from(v).slice(0, 16); }
      return um.apply(this, arguments);
    };
  }
  window.__cam = () => {
    const m = window.__view;
    if (!m) return null;
    const fx = -m[2], fy = -m[6], fz = -m[10];
    return { yawDeg: Math.atan2(-fx, -fz) * 180 / Math.PI, pitchDeg: Math.asin(Math.max(-1, Math.min(1, -fy))) * 180 / Math.PI, frames: window.__viewCount };
  };
})();`;

// Registro de requestPointerLock (envuelto sin cambiar el resultado) y de pointerlockchange
const PL_HOOK = `(() => {
  window.__pl = { calls: 0, resolved: 0, rejected: [], changes: [] };
  const orig = Element.prototype.requestPointerLock;
  Element.prototype.requestPointerLock = function (...args) {
    window.__pl.calls++;
    const r = orig.apply(this, args);
    if (r && typeof r.then === 'function') r.then(() => window.__pl.resolved++, (e) => window.__pl.rejected.push(String((e && e.name) || e)));
    return r;
  };
  document.addEventListener('pointerlockchange', () => window.__pl.changes.push(!!document.pointerLockElement));
  document.addEventListener('pointerlockerror', () => window.__pl.changes.push('error'));
})();`;

// Matrices column-major de three.js
const mul = (m, v) => [0, 1, 2, 3].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * v[3]);
const wrapDeg = (d) => ((d + 540) % 360) - 180;

// NDC del anillo de la arena con la camara actual; max = mayor |x| o |y| (<= 1 si todo cabe en pantalla)
function ringFrame(view, proj) {
  let max = 0;
  let behind = 0;
  for (let i = 0; i < RING_POINTS; i++) {
    const t = (2 * Math.PI * i) / RING_POINTS;
    const c = mul(proj, mul(view, [RING_RADIUS * Math.cos(t), 0, RING_RADIUS * Math.sin(t), 1]));
    if (c[3] <= 0) { behind++; continue; }
    max = Math.max(max, Math.abs(c[0] / c[3]), Math.abs(c[1] / c[3]));
  }
  return { maxAbsNdc: +max.toFixed(4), behind };
}

// Posicion de la camara: C_i = -sum_r R[r][i] * t[r] (matriz de vista column-major)
function cameraPos(view) {
  return [0, 1, 2].map((i) => +(-(view[i * 4] * view[12] + view[i * 4 + 1] * view[13] + view[i * 4 + 2] * view[14])).toFixed(3));
}

async function cursorInfo(page) {
  return page.evaluate(`(() => {
    const c = document.querySelector('canvas');
    const hint = (document.body.innerText.match(/(CLIC PARA CAPTURAR|CURSOR LIBRE)[^\\n]*/) || [null])[0];
    return {
      canvasCursor: c ? getComputedStyle(c).cursor : null,
      bodyCursor: getComputedStyle(document.body).cursor,
      locked: !!c && document.pointerLockElement === c,
      hint,
      plCalls: window.__pl ? window.__pl.calls : null,
    };
  })()`);
}

async function camState(page) {
  const cam = await page.evaluate('window.__cam()');
  const mats = await page.evaluate('({ view: window.__view, proj: window.__proj })');
  return { cam, pos: mats.view ? cameraPos(mats.view) : null, ring: mats.view && mats.proj ? ringFrame(mats.view, mats.proj) : null };
}

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
    await page.addInitScript(VIEW_HOOK);
    await page.addInitScript(PL_HOOK);

    host = hostClient({ port: PORT, name: 'HOST', roomName: 'E2E-PL' });
    await host.createRoom();

    // (a) buscador de salas: cursor visible
    await page.goto(`http://127.0.0.1:${PORT}`);
    await page.waitFor(`() => document.body.innerText.includes('E2E-PL')`, 20000);
    await sleep(300);
    report.steps.a_buscador = await cursorInfo(page);
    await page.screenshot(path.join(out, '01_buscador.png'));

    const btn = await page.evaluate(`(() => {
      const li = [...document.querySelectorAll('li')].find((l) => l.innerText.includes('E2E-PL'));
      const b = li && [...li.querySelectorAll('button')].find((x) => x.innerText.trim() === 'UNIRSE');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (!btn) throw new Error('no se encontro el boton UNIRSE de la sala E2E-PL');
    await page.click(btn.x, btn.y);

    // Lobby: el modal tapa la escena, el cursor sigue visible
    await page.waitFor(`() => document.body.innerText.includes('LUCHADORES')`, 20000);
    await sleep(500);
    report.steps.lobby_cursor = await cursorInfo(page);
    await page.screenshot(path.join(out, '02_lobby.png'));

    host.start();
    await page.waitFor(`() => { const t = document.body.innerText; return t.includes('STICKMAN BRAWL 3D') && !t.includes('INICIAR') && !t.includes('CREAR SALA'); }`, 30000);
    await sleep(2500);
    await page.waitFor(`() => !!document.querySelector('canvas') && !!window.__cam && !!window.__cam()`, 10000);

    // (b) partida: canvas con cursor oculto y pista de captura
    report.steps.b_partida_sin_captura = await cursorInfo(page);
    await page.screenshot(path.join(out, '03_partida_sin_captura.png'));

    // (c) clic real por CDP sobre la escena: debe capturar el mouse
    await page.click(Math.round(W * 0.5), Math.round(H * 0.35));
    await sleep(500);
    report.steps.c_tras_clic = await cursorInfo(page);
    report.steps.c_pl_events = await page.evaluate('window.__pl');
    const locked = report.steps.c_tras_clic.locked;

    if (locked) {
      // (d) mouse capturado: movementX=+200 gira ~ -0.5 rad (-28.6 grados); movementY=+100 sube el pitch ~ +0.25 rad
      // Diagnostico: que movementX/Y llegan a los pointermove de la pagina
      await page.evaluate(`(() => { window.__mv = []; window.addEventListener('pointermove', (e) => window.__mv.push([e.movementX, e.movementY, e.isTrusted]), true); })()`);
      const s0 = await camState(page);
      await page.mouseMove(Math.round(W * 0.5), Math.round(H * 0.35), { movementX: 200, movementY: 0 });
      await sleep(400);
      const s1 = await camState(page);
      const seenCdp = await page.evaluate('window.__mv.slice(0, 5)');
      await page.mouseMove(Math.round(W * 0.5), Math.round(H * 0.35), { movementX: 0, movementY: 100 });
      await sleep(400);
      const s2 = await camState(page);
      report.steps.d_mouse_look = {
        cdpPointerMoveSeen: seenCdp,
        yawBefore: +s0.cam.yawDeg.toFixed(2),
        yawAfterMovX200: +s1.cam.yawDeg.toFixed(2),
        dYawDeg: +wrapDeg(s1.cam.yawDeg - s0.cam.yawDeg).toFixed(2),
        expectedDYawDeg: +(-200 * 0.0025 * 180 / Math.PI).toFixed(2),
        pitchBefore: +s1.cam.pitchDeg.toFixed(2),
        pitchAfterMovY100: +s2.cam.pitchDeg.toFixed(2),
        dPitchDeg: +(s2.cam.pitchDeg - s1.cam.pitchDeg).toFixed(2),
        expectedDPitchDeg: +(100 * 0.0025 * 180 / Math.PI).toFixed(2),
      };
      // Si CDP no entrega movementX/Y, se despacha un pointermove sintetico con esos campos sobre el canvas
      if (Math.abs(report.steps.d_mouse_look.dYawDeg) < 1 && Math.abs(report.steps.d_mouse_look.dPitchDeg) < 1) {
        const y0 = (await camState(page)).cam;
        await page.evaluate(`document.querySelector('canvas').dispatchEvent(new PointerEvent('pointermove', { movementX: 200, movementY: 0, bubbles: true, clientX: 640, clientY: 252 }))`);
        await sleep(400);
        const y1 = (await camState(page)).cam;
        await page.evaluate(`document.querySelector('canvas').dispatchEvent(new PointerEvent('pointermove', { movementX: 0, movementY: 100, bubbles: true, clientX: 640, clientY: 252 }))`);
        await sleep(400);
        const y2 = (await camState(page)).cam;
        report.steps.d_mouse_look_sintetico = {
          note: 'pointermove sintetico (isTrusted false) con movementX/Y; CDP no entrego movimiento',
          dYawDeg: +wrapDeg(y1.yawDeg - y0.yawDeg).toFixed(2),
          expectedDYawDeg: +(-200 * 0.0025 * 180 / Math.PI).toFixed(2),
          dPitchDeg: +(y2.pitchDeg - y1.pitchDeg).toFixed(2),
          expectedDPitchDeg: +(100 * 0.0025 * 180 / Math.PI).toFixed(2),
        };
      }

      // (f) vista por defecto: camara elevada y cerca, luchador centrado (pivote con peso 0.95)
      report.steps.f_vista_defecto = await camState(page);
      await page.screenshot(path.join(out, '04_vista_defecto_capturado.png'));

      // (e) Ctrl solo no hace nada; Ctrl+Alt libera la captura y muestra el cursor
      await page.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17, modifiers: 2 });
      await sleep(200);
      report.steps.e_solo_ctrl = await cursorInfo(page);
      await page.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18, modifiers: 3 });
      await page.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18, modifiers: 2 });
      await page.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17, modifiers: 0 });
      await sleep(500);
      report.steps.e_modo_cursor = await cursorInfo(page);
      await page.screenshot(path.join(out, '05_modo_cursor.png'));

      // Otra pulsacion de Ctrl+Alt recaptura
      await page.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17, modifiers: 2 });
      await page.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18, modifiers: 3 });
      await page.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18, modifiers: 2 });
      await page.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17, modifiers: 0 });
      await sleep(500);
      report.steps.e_recaptura_combo = await cursorInfo(page);
    } else {
      report.notes.push('Pointer Lock no se activo tras el clic real: se omiten (d) y la captura por combinacion sobre un mouse capturado');
    }

    // Esc del navegador: se simula con exitPointerLock; luego un clic recaptura
    await page.evaluate('document.exitPointerLock()');
    await sleep(600);
    report.steps.esc_sin_captura = await cursorInfo(page);
    await page.click(Math.round(W * 0.5), Math.round(H * 0.35));
    await sleep(1200);
    report.steps.esc_clic_recaptura = await cursorInfo(page);

    // Zoom al maximo con la rueda (6 pasos de 500: 16 + 30 unidades, tope 40)
    for (let i = 0; i < 6; i++) {
      await page.cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: Math.round(W * 0.5), y: Math.round(H * 0.35), deltaX: 0, deltaY: 500 });
      await sleep(60);
    }
    await sleep(1000);
    report.steps.f_zoom_maximo = await camState(page);
    await page.screenshot(path.join(out, '06_zoom_maximo.png'));

    report.consoleErrors = chrome.page.consoleMessages().filter((m) => m.type === 'error' || m.kind === 'exception');
  } catch (e) {
    report.error = e.message;
    if (chrome) report.consoleErrors = chrome.page.consoleMessages().filter((m) => m.type === 'error' || m.kind === 'exception');
  } finally {
    if (host) host.close();
    if (chrome) await chrome.close();
    if (server) await server.stop();
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
