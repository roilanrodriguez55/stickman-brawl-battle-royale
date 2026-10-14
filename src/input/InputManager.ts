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

  constructor() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('gamepadconnected', () => {
      this.hasGamepad = true;
    });
    window.addEventListener('gamepaddisconnected', () => {
      this.hasGamepad = false;
    });
  }

  private onKeyDown = (e: KeyboardEvent) => {
    // Ignore input fields
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

    this.keys[e.key.toLowerCase()] = true;
    this.keys[e.code] = true;

    // Buffer attack inputs (150ms window)
    const key = e.key.toLowerCase();
    let atk: string | null = null;
    if (key === 'j') atk = 'jab';
    else if (key === 'k') atk = 'cross';
    else if (key === 'l') atk = 'uppercut';
    else if (key === 'u') atk = 'low_kick';
    else if (key === 'i') atk = 'roundhouse';
    else if (key === 'o') atk = 'axe_kick';

    if (atk) {
      this.bufferAttack(atk);
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
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
    // Valid for 180 ms
    const valid = this.inputBuffer.find((b) => now - b.time <= 180);
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

        // Attacks
        if (gp.buttons[2]?.pressed) attackId = attackId || 'jab'; // X / Square
        if (gp.buttons[3]?.pressed) attackId = attackId || 'cross'; // Y / Triangle
        if (gp.buttons[1]?.pressed) attackId = attackId || 'roundhouse'; // B / Circle
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

    // Clamp movement vector to unit circle
    const len = Math.sqrt(moveX * moveX + moveZ * moveZ);
    if (len > 1.0) {
      moveX /= len;
      moveZ /= len;
    }

    return {
      seq: this.seq,
      moveX,
      moveZ,
      jump,
      dodge,
      block,
      attackId,
      timestamp: Date.now(),
    };
  }

  public dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }
}
