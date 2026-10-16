# Pruebas E2E de navegador (scripts/e2e)

Arnes sin dependencias nuevas: arranca el servidor del juego, habla con Chrome headless por CDP (libreria `ws`) y usa un cliente WebSocket de node como host de la sala.

## Uso

```
npm run e2e:camera-drag
# o: node scripts/e2e/camera_drag.mjs
```

Requiere `/usr/bin/google-chrome`. Capturas, perfil temporal de Chrome y `report.json` van al scratchpad (`scratchDir()` en `lib.mjs`).

## API de lib.mjs

- `startServer({ port, env })`: `npx tsx server.ts` con `PORT` y `LAN_DISCOVERY=0`, en su propio grupo de procesos. Espera `/api/rooms`. `stop()` mata solo ese grupo.
- `launchChrome({ width, height })`: Chrome headless con `--remote-debugging-port` libre. Devuelve `{ page, close() }`.
- `page`: `goto(url)`, `evaluate(expr)`, `screenshot(file, clip?)`, `mouseMove(x, y, { buttons, movementX, movementY })`, `mouseDown/mouseUp(x, y)`, `click(x, y)`, `keyDown/keyUp(key, modifiers)`, `waitFor(fnString, timeoutMs)`, `addInitScript(source)`, `consoleMessages()` (console, excepciones y respuestas HTTP >= 400), `cdp` (cliente CDP crudo con `send` y `on`).
- `hostClient({ port, name, roomName })`: crea la sala con `create_room` y `lobby_config` (ffa, size 4, bots faciles). `start()` manda `start_match`.
- `snapshotPlayers()`: guarda el sha256 de `data/players.json` y lo restaura con `restore()`.

## Notas

- `INICIAR` solo lo ve el host. Un invitado espera el texto `LUCHADORES` del lobby.
- Los bots pueden eliminar al jugador de prueba y el modal `HAS CAÍDO` (z-50) tapa la escena. Las mediciones deben descartarse si el modal esta abierto.
- `page.waitFor` evalua una funcion flecha como texto.
