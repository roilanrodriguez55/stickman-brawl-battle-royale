# 🎮 Stickman Brawl 3D - Juego de Pelea Multijugador LAN

Juego competitivo de peleas de Stickmen en **3D con Three.js** y servidor autoritativo en tiempo real sobre **WebSockets (60 Hz)** para jugar en red local (**LAN**) con amigos o en modo entrenamiento vs IA.

---

## ⚡ Características Principales

- **Renderizado 3D de Alto Rendimiento (Three.js)**:
  - Arena octagonal con aro de neón perimetral, iluminación Key + Fill + Rim y sombras suaves.
  - Cámara dinámica en tercera persona que sigue y encuadra automáticamente a los 2 luchadores según su distancia.
  - Chispas de impacto procedimentales, ondas de choque expansivas y temblor de cámara (*screen shake*).
  - Efecto de cámara lenta (*slow-motion*) cinemático al conseguir un K.O.

- **Esqueleto y Rig Anatómico con Cinemática Procedural**:
  - Pelvis, torso, cuello, cabeza con visor brillante.
  - Brazos y piernas con articulaciones de rodilla y codo visibles, guantes de boxeo 3D y calzado marcial.
  - Ciclo de caminar y correr realista con contrapeso de brazos en fase opuesta, flexión de rodillas y oscilación de cadera.
  - Salto, caída y aterrizaje con flexión amortiguada.

- **Sistema Completo de Artes Marciales (6 Ataques + Combos + Bloqueo + Dash)**:
  - `J`: **Lead Jab** (45 DMG, 10 Stamina) — Rápido, ideal para iniciar combos.
  - `K`: **Straight Cross** (75 DMG, 15 Stamina) — Puñetazo directo contundente.
  - `L`: **Dragon Uppercut** (120 DMG, 25 Stamina) — Gancho ascendente que eleva al rival.
  - `U`: **Low Kick** (60 DMG, 14 Stamina) — Barrido veloz a las espinillas.
  - `I`: **Muay Thai Roundhouse** (110 DMG, 22 Stamina) — Patada circular destructiva.
  - `O`: **Axe Kick** (155 DMG, 32 Stamina) — Golpe de talón descendente pesado.
  - `Espacio`: **Salto marcial**.
  - `Shift`: **Dodge / Dash** con marcos de invulnerabilidad (*i-frames*).
  - `Q` / `B`: **Bloqueo** con guardia cruzada (reduce el 85% del daño y genera *blockstun*).
  - Soporte para **Gamepad API** (Sticks analógicos + botones físicos).

- **Red Local (LAN) y Multijugador Autoritativo**:
  - Servidor **Node.js + WebSockets** con simulación a **60 Hz** y difusión de *snapshots* a **30 Hz**.
  - Detección de colisiones precisa por servidor (prevención de trampas y desincronización).
  - Salas instantáneas con **códigos de 4 dígitos** (por defecto `7749`).
  - Detección automática de IPs de red local para invitar a amigos en el mismo WiFi.
  - Modo **Sparring vs IA** reactivo cuando juegues en solitario.

---

## 🚀 Instalación y Ejecución

### 1. Iniciar el Servidor de Desarrollo
```bash
npm run dev
```
El servidor arrancará en `http://localhost:3000` y mostrará en consola las IPs locales de tu máquina (por ejemplo `http://192.168.1.45:3000`).

### 2. Cómo jugar en Red Local (LAN) con otra PC o Teléfono
1. Conecta ambas computadoras o teléfonos a la **misma red Wi-Fi o cable Ethernet**.
2. En la PC anfitriona, abre el juego y pulsa el botón **"CONECTAR LAN"** en el HUD superior.
3. El juego te mostrará tu código de sala (ej. `7749`) y la URL directa (ej. `http://192.168.1.X:3000`).
4. En la segunda PC o teléfono, abre el navegador web y accede a esa dirección IP.
5. El segundo jugador se unirá automáticamente como **Jugador 2 (CRIMSON GHOST)** en tiempo real con < 20 ms de ping.

---

## 🕹️ Controles de Teclado y Mando

| Acción | Tecla Teclado | Mando (Gamepad) |
|---|---|---|
| Moverse | `W` `A` `S` `D` | Stick Izquierdo / D-Pad |
| Saltar | `Espacio` | Botón A / Cruz |
| Esquivar / Dash | `Shift` | R1 / RB / RT |
| Bloquear | `Q` o `B` | L1 / LB / LT |
| Lead Jab | `J` | Botón X / Cuadrado |
| Straight Cross | `K` | Botón Y / Triángulo |
| Dragon Uppercut | `L` | Botón B / Círculo |
| Low Sweep Kick | `U` | Gatillo / Combo |
| Roundhouse Kick | `I` | Combo |
| Heavy Axe Kick | `O` | Combo pesado |

---

## ⚙️ Configuración de Firewall / Puertos (Opcional en Windows/Mac)
Si tu amigo no puede conectarse a tu IP local:
1. Asegúrate de permitir el puerto `3000` en tu Firewall de Windows o macOS para Node.js.
2. En Windows: *Panel de Control > Firewall de Windows Defender > Permitir una aplicación > Seleccionar Node.js*.
