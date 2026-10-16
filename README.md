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
  - `J`: **Golpes**. Pulsar J varias veces encadena Lead Jab → Straight Cross → Dragon Uppercut.
  - `K`: **Patadas**. Pulsar K varias veces encadena Low Sweep Kick → Muay Thai Roundhouse → Axe Heel Smash.
  - Combinaciones mixtas: J y K se alternan dentro de la ventana de cancelación de cada golpe (por ejemplo J, J, K da Jab → Cross → Roundhouse).
  - `Espacio`: **Salto marcial**.
  - `Shift`: **Dodge / Dash** con marcos de invulnerabilidad (*i-frames*).
  - `Q` / `B`: **Bloqueo** con guardia cruzada (reduce el 85% del daño y genera *blockstun*).
  - Soporte para **Gamepad API** (Sticks analógicos + botones físicos).

- **Red Local (LAN) y Multijugador Autoritativo**:
  - Servidor **Node.js + WebSockets** con simulación a **60 Hz** y difusión de *snapshots* a **30 Hz**.
  - Detección de colisiones precisa por servidor (prevención de trampas y desincronización).
  - **Salas** con lobby propio: hasta **10 luchadores**, modo FFA o por equipos, y **espectadores** que siguen la pelea sin jugar.
  - **Bots opcionales** para rellenar la sala, con dificultad fácil, normal o difícil.
  - **Autodescubrimiento en LAN**: las salas de otros equipos con el servidor encendido aparecen solas en la lista.

---

## 🚀 Instalación y Ejecución

### 1. Iniciar el Servidor de Desarrollo
```bash
npm run dev
```
El servidor arrancará en `http://localhost:3000` y mostrará en consola las IPs locales de tu máquina (por ejemplo `http://192.168.1.45:3000`).

### 2. Salas y juego en red local (LAN)
1. Cada equipo que quiera jugar ejecuta el servidor con `npm run dev`. Todos deben estar en la misma red Wi-Fi o cable.
2. Al abrir el juego aparece el buscador de salas. Crea una sala (modo, tamaño) o únete a una de la lista.
3. Las salas de otros equipos aparecen solas si su servidor está encendido. Si no aparece ninguna, pulsa **CONECTAR POR IP** e introduce la IP del equipo anfitrión (ej. `192.168.1.20`) y el puerto (3000 por defecto).
4. Para que el autodescubrimiento funcione, deben estar abiertos el puerto UDP `41234` y el puerto del juego (`3000`) en el firewall de cada equipo.
5. El host configura la sala en el lobby e inicia la partida. Los demás esperan en el lobby y pueden cambiar de equipo.

---

## 🕹️ Controles de Teclado y Mando

| Acción | Tecla Teclado | Mando (Gamepad) |
|---|---|---|
| Moverse | `W` `A` `S` `D` | Stick Izquierdo / D-Pad |
| Cámara libre | Clic en la escena para capturar el ratón y moverlo para girar; rueda para acercar o alejar | — |
| Saltar | `Espacio` | Botón A / Cruz |
| Esquivar / Dash | `Shift` | R1 / RB / RT |
| Bloquear | `Q` o `B` | L1 / LB / LT |
| Golpes (Jab, Cross, Uppercut) | `J` o clic izquierdo (repetir para combo) | Botón X / Cuadrado, Botón Y / Triángulo |
| Patadas (Low Kick, Roundhouse, Axe Kick) | `K` o clic derecho (repetir para combo) | Botón B / Círculo |
| Cambiar objetivo | `Tab` | R3 |

Como espectador, o tras caer, `Tab` cambia el luchador que sigue la cámara.

### Cámara y ratón en partida

- **Ratón capturado**: en partida el cursor queda oculto y el ratón gira la cámara sin pulsar nada (como en Warcraft o Torchlight). La cámara empieza detrás de tu luchador.
- **Capturar**: haz clic en la escena. Si la pista muestra "CLIC PARA CAPTURAR EL MOUSE", ese clic vuelve a capturarlo.
- **Mostrar el cursor**: `Ctrl+Alt` (en Mac, `Cmd+Alt`) libera el ratón y lo muestra para usar los botones del HUD (SALAS, AJUSTES, CONECTAR LAN, J y K). Vuelve a pulsar la combinación, o haz clic en la escena, para capturarlo otra vez.
- **Esc**: el navegador libera el ratón. Haz clic en la escena para capturarlo de nuevo.
- **Ataques con el ratón**: `Golpes: J o clic izquierdo; Patadas: K o clic derecho`. Los clics de ataque solo cuentan con el ratón capturado en combate; con `Ctrl+Alt` el cursor se muestra y esos clics no atacan.
- **Rueda**: acerca o aleja la cámara (de cerca hasta ver la arena completa).
- En menús, lobby y ventanas de ajustes, resultado o LAN el cursor es normal.

---

## 🎯 Modos de Juego

- **FFA**: todos contra todos.
- **Equipos**: dos equipos, azul y rojo.
- **Tamaño**: hasta 10 luchadores por sala. Los huecos se pueden rellenar con bots de dificultad fácil, normal o difícil.

### Tipos de partida

El host elige el tipo de partida en el lobby. Se muestra como badge en el buscador de salas.

- **Eliminación**: el último luchador en pie gana. Es el comportamiento clásico, con cronómetro de 99 s.
- **Por tiempo**: quien cae reaparece a los 3 s en un punto aleatorio, lejos de los rivales y de otros puntos de aparición. Tras reaparecer tiene 2 s de protección. Gana quien tenga más eliminaciones al acabar el tiempo. El marcador muestra eliminaciones y muertes (K/D) de cada luchador. Duraciones disponibles: 2, 3, 5, 10 y 15 minutos (5 por defecto).

---

## ⚙️ Configuración de Firewall / Puertos (Opcional en Windows/Mac)
Si tu amigo no puede conectarse a tu IP local:
1. Asegúrate de permitir el puerto `3000` en tu Firewall de Windows o macOS para Node.js.
2. En Windows: *Panel de Control > Firewall de Windows Defender > Permitir una aplicación > Seleccionar Node.js*.
