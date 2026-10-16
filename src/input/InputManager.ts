/**
 * Input Manager: Keyboard, Gamepad API, and Touch controls with input buffering
 */

import { PlayerInput } from '../../shared/types';

export class InputManager {
  private keys: Record<string, boolean> = {};
  private seq = 0;
  private inputBuffer: { attackId: string; time: number }[] = [];
  public hasGamepad = false;

  // On-screen touch state
  public touchMoveX = 0;
  public touchMoveZ = 0;
  public touchJump = false;
  public touchBlock = false;
  public touchDodge = false;
  public touchAttack: string | null = null;

  // Estado previo de los botones de ataque del gamepad (solo flanco de subida)
  private padPunchHeld = false;
  private padKickHeld = false;

  // Cambio de objetivo (Tab / R3): pendiente hasta el siguiente pollInput, solo por flanco
  private cycleTargetPending = false;
  private padCycleHeld = false;

  // Ctrl+Alt (Cmd+Alt en Mac) pulsado solo alterna el modo cursor. Se arma al bajar la combinacion
  // y se desarma con cualquier otra tecla o al soltar, para que una pulsacion dispare una vez
  private cursorComboArmed = false;
  public onCursorToggle: (() => void) | null = null;

  // Camera yaw used to make movement relative to the camera
  public getCameraYaw: () => number = () => 0;

  // true solo con la partida en curso: Tab cambia de objetivo solo entonces
  public isFightPhase: () => boolean = () => false;

  private onGamepadConnected = () => {
    this.hasGamepad = true;
  };

  private onGamepadDisconnected = () => {
    this.hasGamepad = false;
  };

  private onBlur = () => {
    this.releaseAll();
  };

  private onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') this.releaseAll();
  };

  // Clic con el mouse capturado en combate: izquierdo = golpe, derecho = patada. El clic que captura
  // el mouse no ataca: la escena pide la captura en su pointerdown y pointerLockElement cambia despues
  private onMouseDown = (e: MouseEvent) => {
    if (e.button !== 0 && e.button !== 2) return;
    if (!document.pointerLockElement) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (!this.isFightPhase()) return;
    e.preventDefault();
    this.bufferAttack(e.button === 0 ? 'punch' : 'kick');
  };

  // Sin menu contextual con el clic derecho durante la partida o con el mouse capturado
  private onContextMenu = (e: Event) => {
    if (document.pointerLockElement || this.isFightPhase()) e.preventDefault();
  };

  constructor() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('gamepadconnected', this.onGamepadConnected);
    window.addEventListener('gamepaddisconnected', this.onGamepadDisconnected);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('mousedown', this.onMouseDown, true);
    window.addEventListener('contextmenu', this.onContextMenu);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  // Al perder el foco el navegador no entrega keyup: se suelta todo para no dejar teclas atascadas
  private releaseAll() {
    this.keys = {};
    this.cursorComboArmed = false;
    this.inputBuffer = [];
    this.touchMoveX = 0;
    this.touchMoveZ = 0;
    this.touchJump = false;
    this.touchBlock = false;
    this.touchDodge = false;
    this.touchAttack = null;
  }

  private onKeyDown = (e: KeyboardEvent) => {
    // Ignore input fields
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

    // Solo la combinacion: cualquier otra tecla desarma el modo cursor
    const isModifier = e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta';
    if (!isModifier) {
      this.cursorComboArmed = false;
    } else if (e.altKey && (e.ctrlKey || e.metaKey) && !e.repeat && !this.cursorComboArmed) {
      this.cursorComboArmed = true;
      this.onCursorToggle?.();
    }

    // Tab cambia de objetivo solo en partida; fuera de ella es navegacion normal del foco
    if (e.key === 'Tab') {
      if (!this.isFightPhase()) return;
      e.preventDefault();
      if (!e.repeat) this.cycleTargetPending = true;
      return;
    }

    this.keys[e.key.toLowerCase()] = true;
    this.keys[e.code] = true;

    // Buffer attack inputs (250ms window)
    const key = e.key.toLowerCase();
    let atk: string | null = null;
    if (key === 'j') atk = 'punch';
    else if (key === 'k') atk = 'kick';

    // Solo el flanco: la autorepeticion del SO no cuenta como pulsacion nueva
    if (atk && !e.repeat) {
      this.bufferAttack(atk);
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.cursorComboArmed = false;
    this.keys[e.key.toLowerCase()] = false;
    this.keys[e.code] = false;
  };

  public bufferAttack(attackId: string) {
    this.inputBuffer.push({ attackId, time: performance.now() });
    // Keep last 3
    if (this.inputBuffer.length > 3) this.inputBuffer.shift();
  }

  public getBufferedAttack(): string | null {
    const now = performance.now();
    // Valid for 250 ms
    const valid = this.inputBuffer.find((b) => now - b.time <= 250);
    if (valid) {
      this.inputBuffer = this.inputBuffer.filter((b) => b !== valid);
      return valid.attackId;
    }
    return null;
  }

  public pollInput(): PlayerInput {
    this.seq++;
    let moveX = 0;
    let moveZ = 0;
    let jump = false;
    let dodge = false;
    let block = false;
    let attackId: string | null = this.getBufferedAttack();

    // 1. Keyboard
    if (this.keys['a'] || this.keys['arrowleft']) moveX -= 1;
    if (this.keys['d'] || this.keys['arrowright']) moveX += 1;
    if (this.keys['w'] || this.keys['arrowup']) moveZ -= 1;
    if (this.keys['s'] || this.keys['arrowdown']) moveZ += 1;

    if (this.keys[' '] || this.keys['space']) jump = true;
    if (this.keys['shift'] || this.keys['shiftleft'] || this.keys['shiftright']) dodge = true;
    if (this.keys['q'] || this.keys['b']) block = true;

    // 2. Gamepad API
    if (navigator.getGamepads) {
      const gamepads = navigator.getGamepads();
      const gp = gamepads[0];
      if (gp && gp.connected) {
        this.hasGamepad = true;
        // Left stick
        const deadzone = 0.18;
        const stickX = gp.axes[0];
        const stickY = gp.axes[1];
        if (Math.abs(stickX) > deadzone) moveX += stickX;
        if (Math.abs(stickY) > deadzone) moveZ += stickY;

        // D-Pad
        if (gp.buttons[14]?.pressed) moveX -= 1;
        if (gp.buttons[15]?.pressed) moveX += 1;
        if (gp.buttons[12]?.pressed) moveZ -= 1;
        if (gp.buttons[13]?.pressed) moveZ += 1;

        // Buttons
        if (gp.buttons[0]?.pressed) jump = true; // A / Cross
        if (gp.buttons[4]?.pressed || gp.buttons[6]?.pressed) block = true; // LB / LT
        if (gp.buttons[5]?.pressed || gp.buttons[7]?.pressed) dodge = true; // RB / RT

        // Attacks: solo al pasar de no pulsado a pulsado, como el teclado
        const punchHeld = !!(gp.buttons[2]?.pressed || gp.buttons[3]?.pressed); // X/Square, Y/Triangle
        const kickHeld = !!gp.buttons[1]?.pressed; // B / Circle
        if (punchHeld && !this.padPunchHeld) this.bufferAttack('punch');
        if (kickHeld && !this.padKickHeld) this.bufferAttack('kick');
        this.padPunchHeld = punchHeld;
        this.padKickHeld = kickHeld;

        // R3 cambia de objetivo por flanco
        const cycleHeld = !!gp.buttons[11]?.pressed;
        if (cycleHeld && !this.padCycleHeld) this.cycleTargetPending = true;
        this.padCycleHeld = cycleHeld;
      }
    }

    // 3. Touch Overlays
    if (this.touchMoveX !== 0 || this.touchMoveZ !== 0) {
      moveX += this.touchMoveX;
      moveZ += this.touchMoveZ;
    }
    if (this.touchJump) {
      jump = true;
      this.touchJump = false;
    }
    if (this.touchDodge) {
      dodge = true;
      this.touchDodge = false;
    }
    if (this.touchBlock) {
      block = true;
    }
    if (this.touchAttack) {
      attackId = this.touchAttack;
      this.touchAttack = null;
    }

    // Rotate movement from camera-relative to world axes
    // Camera sits at pivot + (sin yaw, ., cos yaw), so right = (c, -s) and forward = (-s, -c)
    const yaw = this.getCameraYaw();
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const worldX = moveX * c + moveZ * s;
    const worldZ = -moveX * s + moveZ * c;
    moveX = worldX;
    moveZ = worldZ;

    // Clamp movement vector to unit circle
    const len = Math.sqrt(moveX * moveX + moveZ * moveZ);
    if (len > 1.0) {
      moveX /= len;
      moveZ /= len;
    }

    // Un solo cambio de objetivo por pulsacion
    const cycleTarget = this.cycleTargetPending;
    this.cycleTargetPending = false;

    return {
      seq: this.seq,
      moveX,
      moveZ,
      jump,
      dodge,
      block,
      attackId,
      cycleTarget,
      timestamp: Date.now(),
    };
  }

  public dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('gamepadconnected', this.onGamepadConnected);
    window.removeEventListener('gamepaddisconnected', this.onGamepadDisconnected);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('mousedown', this.onMouseDown, true);
    window.removeEventListener('contextmenu', this.onContextMenu);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }
}
