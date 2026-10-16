// Capturas de las barras de vida sobre los luchadores y de los mensajes de dano/combo.
// Partida con bots, el TESTER ataca con el mouse capturado y se toman capturas con zoom por defecto, alejado y cercano.
// Uso: node scripts/e2e/health_bars.mjs   (capturas y report.json en el scratchpad, carpeta health-bars)
import path from 'node:path';
import fs from 'node:fs';
import { startServer, launchChrome, hostClient, snapshotPlayers, scratchDir, sleep } from './lib.mjs';

const PORT = 3985;
const W = 1280;
const H = 720;
const CLIENT_ID = '7c1e5a2b-9d4f-4a3e-8b6c-2f0a1d9e5b37';
const CX = Math.round(W * 0.5);
const CY = Math.round(H * 0.35);
const out = scratchDir('health-bars');
const report = { port: PORT, shots: {}, samples: {}, consoleErrors: [], notes: [] };

// Captura a disco y devuelve solo ruta y bytes (sin base64 en el reporte)
async function snap(page, name) {
  const r = await page.screenshot(path.join(out, name));
  return { file: r.file, bytes: r.bytes };
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

    const leftClick = async (x, y) => {
      await page.mouseMove(x, y);
      await page.mouseDown(x, y, 'left');
      await page.mouseUp(x, y, 'left');
    };
    const rightClick = async (x, y) => {
      await page.mouseMove(x, y);
      await page.mouseDown(x, y, 'right');
      await page.mouseUp(x, y, 'right');
    };
    const wheel = async (deltaY) => {
      await page.cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: CX, y: CY, deltaX: 0, deltaY });
      await sleep(500);
    };
    // Mensajes de dano en pantalla (los de DamageText son hijos directos del overlay z-30)
    const damageCount = () => page.evaluate(`document.querySelectorAll('.fixed.inset-0.pointer-events-none.z-30 > div').length`);
    const hudHp = () => page.evaluate(`(document.body.innerText.match(/(\\d+) HP/) || [])[1] ?? null`);
    const scoreboardText = () => page.evaluate(`document.querySelector('.absolute.right-3')?.innerText ?? ''`);

    host = hostClient({ port: PORT, name: 'HOST', roomName: 'E2E-HP' });
    await host.createRoom();

    await page.goto(`http://127.0.0.1:${PORT}`);
    await page.waitFor(`() => document.body.innerText.includes('E2E-HP')`, 20000);
    await sleep(300);
    const btn = await page.evaluate(`(() => {
      const li = [...document.querySelectorAll('li')].find((l) => l.innerText.includes('E2E-HP'));
      const b = li && [...li.querySelectorAll('button')].find((x) => x.innerText.trim() === 'UNIRSE');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (!btn) throw new Error('no se encontro el boton UNIRSE de la sala E2E-HP');
    await page.click(btn.x, btn.y);

    await page.waitFor(`() => document.body.innerText.includes('LUCHADORES')`, 20000);
    await sleep(400);
    host.start();
    await page.waitFor(`() => { const t = document.body.innerText; return t.includes('STICKMAN BRAWL 3D') && !t.includes('INICIAR') && !t.includes('CREAR SALA'); }`, 30000);
    await page.waitFor(`() => !!document.querySelector('canvas')`, 10000);
    await sleep(2500);

    // Captura el mouse y ataca alternando golpes y patadas hasta que aparezcan mensajes de dano
    await leftClick(CX, CY);
    let shotDamage = false;
    const deadline = Date.now() + 14000;
    let i = 0;
    while (Date.now() < deadline) {
      if (i % 2 === 0) await leftClick(CX, CY);
      else await rightClick(CX, CY);
      i++;
      await sleep(280);
      const n = await damageCount();
      if (!shotDamage && n > 0) {
        shotDamage = true;
        report.shots.mensajes = await snap(page, '04_mensajes_dano.png');
        report.samples.mensajesVisibles = n;
      }
    }
    report.samples.hudHpTras_ataque = await hudHp();
    report.samples.marcadorTrasAtaque = await scoreboardText();
    report.shots.default = await snap(page, '01_camara_por_defecto.png');

    await wheel(1000);
    report.shots.alejado = await snap(page, '02_zoom_alejado.png');

    await wheel(-2000);
    report.shots.cercano = await snap(page, '03_zoom_cercano.png');

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
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
