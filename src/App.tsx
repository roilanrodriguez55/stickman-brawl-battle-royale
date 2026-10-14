/**
 * Stickman Fighting Game 3D: Real-Time LAN & Local Authoritative Fighter
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Wifi, Settings, RotateCcw, Gamepad2, Sparkles, Shield, Flame } from 'lucide-react';
import { BattleArenaScene } from './core/BattleArenaScene';
import { NetworkClient } from './net/NetworkClient';
import { InputManager } from './input/InputManager';
import { soundManager } from './audio/soundManager';
import { GameSnapshot } from '../shared/types';
import { LanMultiplayerModal } from './components/LanMultiplayerModal';
import { SettingsModal } from './components/SettingsModal';
import { VictoryModal } from './components/VictoryModal';

interface FloatingDmg {
  id: string;
  text: string;
  isCrit?: boolean;
  x: number;
  y: number;
}

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<BattleArenaScene | null>(null);
  const netRef = useRef<NetworkClient | null>(null);
  const inputRef = useRef<InputManager | null>(null);

  // Match State from Network Snapshots
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [roomId, setRoomId] = useState('7749');
  const [playerSlot, setPlayerSlot] = useState<'p1' | 'p2' | 'spectator'>('p1');
  const [ping, setPing] = useState(18);
  const [isP2Connected, setIsP2Connected] = useState(false);
  const [isAiMode, setIsAiMode] = useState(false);

  // Floating Combat Damage Numbers
  const [damageNumbers, setDamageNumbers] = useState<FloatingDmg[]>([]);

  // Modals
  const [isLanModalOpen, setIsLanModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isVictoryOpen, setIsVictoryOpen] = useState(false);

  // Settings
  const [cameraMode, setCameraMode] = useState<'cinematic' | 'follow' | 'topdown' | 'orbit'>(() => {
    try { return (localStorage.getItem('combat_camera') as any) || 'follow'; } catch { return 'follow'; }
  });
  const [soundEnabled, setSoundEnabled] = useState(() => {
    try { return localStorage.getItem('combat_sound') !== 'false'; } catch { return true; }
  });
  const [volume, setVolume] = useState(() => {
    try { return parseFloat(localStorage.getItem('combat_volume') || '0.7'); } catch { return 0.7; }
  });
  const [difficulty, setDifficulty] = useState<'normal' | 'hard' | 'practice'>(() => {
    try { return (localStorage.getItem('combat_difficulty') as any) || 'normal'; } catch { return 'normal'; }
  });

  // Gamepad Detection
  const [hasGamepad, setHasGamepad] = useState(false);

  // Sync combat settings to scene, audio, and localStorage
  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.cameraMode = cameraMode;
      sceneRef.current.difficulty = difficulty;
    }
    soundManager.enabled = soundEnabled;
    soundManager.volume = volume;
    try {
      localStorage.setItem('combat_camera', cameraMode);
      localStorage.setItem('combat_sound', String(soundEnabled));
      localStorage.setItem('combat_volume', String(volume));
      localStorage.setItem('combat_difficulty', difficulty);
    } catch { /* ignore */ }
  }, [cameraMode, soundEnabled, volume, difficulty]);

  // Initialize Network & Scene
  useEffect(() => {
    if (!containerRef.current) return;

    const scene = new BattleArenaScene(containerRef.current);
    sceneRef.current = scene;

    const net = new NetworkClient();
    netRef.current = net;

    const input = new InputManager();
    inputRef.current = input;

    net.onRoomJoined = (slot, rId) => {
      setPlayerSlot(slot);
      setRoomId(rId);
    };

    net.onPlayerJoined = (slot) => {
      if (slot === 'p2') setIsP2Connected(true);
    };

    net.onPlayerLeft = (slot) => {
      if (slot === 'p2') setIsP2Connected(false);
    };

    net.onSnapshot = (snap) => {
      setSnapshot(snap);
      setPing(net.pingMs);

      // Check events for audio & visual FX
      snap.events.forEach((ev) => {
        if (ev.type === 'hit') {
          // Visual sparks & shockwave
          scene.burstSparks(ev.pos.x, ev.pos.y, ev.pos.z, ev.isBlocked);

          // Audio
          if (ev.isBlocked) {
            soundManager.playParry();
          } else {
            if (ev.attackId === 'jab' || ev.attackId === 'cross') soundManager.playJab();
            else if (ev.attackId === 'uppercut') soundManager.playUppercut();
            else soundManager.playKick();
          }

          // Damage pop-up
          const id = Math.random().toString();
          setDamageNumbers((prev) => [
            ...prev.slice(-4),
            {
              id,
              text: ev.isBlocked ? `BLOCKED ${ev.damage}` : `${ev.damage} DMG`,
              isCrit: ev.damage >= 110,
              x: window.innerWidth * 0.5 + (ev.attackerId === 'p1' ? 60 : -60),
              y: window.innerHeight * 0.42 + (Math.random() - 0.5) * 40,
            },
          ]);

          setTimeout(() => {
            setDamageNumbers((prev) => prev.filter((d) => d.id !== id));
          }, 800);
        } else if (ev.type === 'ko') {
          soundManager.playFinisher();
          scene.slowMoFactor = 0.25;
          setTimeout(() => {
            scene.slowMoFactor = 1.0;
            setIsVictoryOpen(true);
          }, 1200);
        }
      });
    };

    // Main 60 Hz Game Render Loop
    let animId: number;
    const renderLoop = () => {
      animId = requestAnimationFrame(renderLoop);

      // Poll inputs and send to server
      if (input && net && net.isConnected) {
        const inp = input.pollInput();
        net.sendInput(inp);
        setHasGamepad(input.hasGamepad);
      }

      // Render 3D Scene
      if (scene) {
        scene.updateAndRender(net?.latestSnapshot || null);
      }
    };

    animId = requestAnimationFrame(renderLoop);

    return () => {
      cancelAnimationFrame(animId);
      scene.dispose();
      net.dispose();
      input.dispose();
    };
  }, []);

  const handleRestart = () => {
    if (netRef.current) {
      netRef.current.restartMatch();
    }
    setIsVictoryOpen(false);
  };

  const handleTriggerTouchAttack = useCallback((atkId: string) => {
    if (inputRef.current) {
      inputRef.current.touchAttack = atkId;
    }
  }, []);

  // Fighters state display helpers
  const p1 = snapshot?.p1;
  const p2 = snapshot?.p2;
  const roundTimer = snapshot ? snapshot.roundTimer : 99;
  const isP1 = playerSlot === 'p1';

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#07090e] text-slate-100 font-tactical select-none">
      {/* 3D Battle Arena Viewport */}
      <div ref={containerRef} className="fixed inset-0 w-full h-full bg-transparent z-0" />

      {/* Screen Vignette for cinematic focus */}
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(5,7,12,0.85)_100%)] z-10" />

      {/* Floating Combat Damage Numbers */}
      <div className="fixed inset-0 pointer-events-none z-30">
        {damageNumbers.map((d) => (
          <div
            key={d.id}
            style={{ left: `${d.x}px`, top: `${d.y}px` }}
            className={`absolute -translate-x-1/2 -translate-y-1/2 font-display text-2xl sm:text-3xl tracking-wider transition-all duration-700 animate-out fade-out slide-out-to-top-8 ${
              d.isCrit
                ? 'text-gold-glow drop-shadow-[0_0_12px_#ffd600] scale-125'
                : 'text-cyan-glow drop-shadow-[0_0_10px_#00f0ff]'
            }`}
          >
            {d.text}
          </div>
        ))}
      </div>

      {/* MAIN HUD OVERLAY */}
      <div className="relative z-20 w-full h-screen flex flex-col justify-between p-3 md:p-5 pointer-events-none">
        {/* TOP STATUS BAR: MATCH & NETWORK TELEMETRY */}
        <header className="flex items-center justify-between w-full pointer-events-auto">
          {/* Brand & LAN Connection Badge */}
          <div className="flex items-center gap-2 md:gap-3">
            <div className="hud-glass px-3 py-1.5 rounded-full flex items-center gap-2.5">
              <div className="w-2 h-2 rounded-full bg-cyan-glow animate-ping" />
              <span className="font-display tracking-wider text-sm md:text-base text-white">STICKMAN BRAWL 3D</span>
              <span className="text-[10px] bg-cyan-glow/15 text-cyan-glow font-mono font-bold px-1.5 py-0.5 rounded border border-cyan-glow/30">
                LAN 60Hz
              </span>
            </div>

            <button
              onClick={() => setIsLanModalOpen(true)}
              className="hidden sm:flex items-center gap-2 hud-glass hover:bg-white/10 px-3 py-1.5 rounded-full text-xs font-mono text-slate-300 transition-colors"
              title="Abrir ajustes de red local LAN"
            >
              <Wifi className="w-3.5 h-3.5 text-cyan-glow" />
              <span>SALA: <strong className="text-white">{roomId}</strong></span>
              <span className="text-white/20">|</span>
              <span className="text-emerald-400 font-bold">{ping}ms</span>
            </button>

            {hasGamepad && (
              <div className="hidden lg:flex items-center gap-1.5 hud-glass px-3 py-1 rounded-full text-[11px] font-mono text-cyan-glow border border-cyan-glow/30">
                <Gamepad2 className="w-3.5 h-3.5" />
                <span>GAMEPAD CONECTADO</span>
              </div>
            )}
          </div>

          {/* CENTER: ROUND TIMER */}
          <div className="hud-glass px-5 py-1.5 rounded-2xl flex flex-col items-center justify-center border border-white/10 shadow-xl">
            <span className="text-[9px] font-mono tracking-widest text-slate-400 uppercase">TIEMPO</span>
            <span className="font-display text-2xl sm:text-3xl leading-none text-white tracking-wider">
              {roundTimer < 10 ? `0${roundTimer}` : roundTimer}
            </span>
          </div>

          {/* RIGHT: CONTROLS & SETTINGS */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsLanModalOpen(true)}
              className="hud-glass hover:bg-white/10 transition-colors px-3 h-8 rounded-full flex items-center gap-1.5 text-slate-300 hover:text-white font-mono text-xs"
            >
              <Wifi className="w-3.5 h-3.5 text-cyan-glow" />
              <span className="hidden sm:inline">CONECTAR LAN</span>
            </button>

            <button
              onClick={() => setIsSettingsOpen(true)}
              className="hud-glass hover:bg-white/10 transition-colors w-8 h-8 rounded-full flex items-center justify-center text-slate-300 hover:text-white"
              title="Ajustes de Combate"
            >
              <Settings className="w-4 h-4" />
            </button>

            <button
              onClick={handleRestart}
              className="hud-glass hover:bg-crimson-glow/20 border border-crimson-glow/30 px-3 h-8 rounded-full flex items-center gap-1.5 text-white font-mono text-[11px] transition-colors"
              title="Reiniciar Round"
            >
              <RotateCcw className="w-3 h-3 text-crimson-glow" />
              <span className="hidden sm:inline">REINICIAR</span>
            </button>
          </div>
        </header>

        {/* Dynamic Combo Notification (Floats non-intrusively near top-center) */}
        {((isP1 && p1 && p1.comboCount > 1) || (!isP1 && p2 && p2.comboCount > 1)) && (
          <div className="mx-auto my-0 pointer-events-none animate-bounce">
            <span className="font-display text-xl sm:text-2xl text-gold-glow drop-shadow-[0_0_12px_#ffd600]">
              ⚡ ¡{isP1 ? p1?.comboCount : p2?.comboCount} GOLPES! +{isP1 ? p1?.comboDamage : p2?.comboDamage} DMG ⚡
            </span>
          </div>
        )}

        {/* BOTTOM DOCK: SHORTCUTS BAR ON TOP, HEALTH BARS DIRECTLY BELOW */}
        <footer className="w-full flex flex-col items-center gap-2 pointer-events-auto mt-auto">
          {/* 1. SHORTCUTS & ACTION BAR */}
          <div className="w-full flex flex-wrap items-center justify-between gap-2">
            {/* Movement cheatsheet & Jump/Dash buttons */}
            <div className="hud-glass px-3 py-1.5 rounded-xl flex items-center gap-2.5 text-xs font-mono text-slate-300">
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-slate-400 mr-1">MOVER:</span>
                <span className="px-1.5 py-0.5 rounded bg-white/10 text-cyan-glow font-bold text-[10px]">WASD</span>
              </div>
              <div className="w-[1px] h-4 bg-white/10" />
              <button
                onClick={() => {
                  if (inputRef.current) inputRef.current.touchJump = true;
                }}
                className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 active:scale-95 text-slate-200 text-[10px] flex items-center gap-1 border border-white/15"
              >
                <span>ESPACIO</span>
                <span className="text-cyan-glow font-bold">SALTO</span>
              </button>
              <button
                onClick={() => {
                  if (inputRef.current) inputRef.current.touchDodge = true;
                }}
                className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 active:scale-95 text-slate-200 text-[10px] flex items-center gap-1 border border-white/15"
              >
                <span>SHIFT</span>
                <span className="text-cyan-glow font-bold">DASH</span>
              </button>
              <button
                onClick={() => {
                  if (inputRef.current) inputRef.current.touchBlock = !inputRef.current.touchBlock;
                }}
                className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 active:scale-95 text-slate-200 text-[10px] flex items-center gap-1 border border-white/15"
              >
                <span>Q / B</span>
                <span className="text-emerald-400 font-bold">PARRY</span>
              </button>
            </div>

            {/* PUNCHES & KICKS DOCKING BAR */}
            <div className="hud-glass p-1.5 rounded-xl flex items-center gap-1.5 overflow-x-auto max-w-full">
              {/* J: Jab */}
              <button
                onClick={() => handleTriggerTouchAttack('jab')}
                className="group active:scale-95 transition-all hover:bg-white/10 px-2.5 py-1.5 rounded-lg flex items-center gap-2 text-left"
                title="J: Lead Jab"
              >
                <span className="w-6 h-6 rounded bg-white/10 group-hover:bg-cyan-glow/20 border border-white/20 flex items-center justify-center font-mono font-bold text-xs text-cyan-glow">
                  J
                </span>
                <div>
                  <div className="font-display tracking-wide text-xs text-white group-hover:text-cyan-glow leading-none">
                    JAB
                  </div>
                  <div className="text-[9px] font-mono text-slate-400">50 DMG</div>
                </div>
              </button>

              <div className="w-[1px] h-6 bg-white/10" />

              {/* K: Cross */}
              <button
                onClick={() => handleTriggerTouchAttack('cross')}
                className="group active:scale-95 transition-all hover:bg-white/10 px-2.5 py-1.5 rounded-lg flex items-center gap-2 text-left"
                title="K: Straight Cross"
              >
                <span className="w-6 h-6 rounded bg-white/10 group-hover:bg-cyan-glow/20 border border-white/20 flex items-center justify-center font-mono font-bold text-xs text-cyan-glow">
                  K
                </span>
                <div>
                  <div className="font-display tracking-wide text-xs text-white group-hover:text-cyan-glow leading-none">
                    CROSS
                  </div>
                  <div className="text-[9px] font-mono text-slate-400">80 DMG</div>
                </div>
              </button>

              <div className="w-[1px] h-6 bg-white/10" />

              {/* L: Uppercut */}
              <button
                onClick={() => handleTriggerTouchAttack('uppercut')}
                className="group active:scale-95 transition-all hover:bg-white/10 px-2.5 py-1.5 rounded-lg flex items-center gap-2 text-left"
                title="L: Dragon Uppercut"
              >
                <span className="w-6 h-6 rounded bg-white/10 group-hover:bg-cyan-glow/20 border border-white/20 flex items-center justify-center font-mono font-bold text-xs text-cyan-glow">
                  L
                </span>
                <div>
                  <div className="font-display tracking-wide text-xs text-white group-hover:text-cyan-glow leading-none">
                    UPPERCUT
                  </div>
                  <div className="text-[9px] font-mono text-slate-400">125 DMG</div>
                </div>
              </button>

              <div className="w-[1px] h-6 bg-white/10" />

              {/* U: Low Kick */}
              <button
                onClick={() => handleTriggerTouchAttack('low_kick')}
                className="group active:scale-95 transition-all hover:bg-white/10 px-2.5 py-1.5 rounded-lg flex items-center gap-2 text-left"
                title="U: Low Kick Sweep"
              >
                <span className="w-6 h-6 rounded bg-white/10 group-hover:bg-emerald-400/20 border border-white/20 flex items-center justify-center font-mono font-bold text-xs text-emerald-400">
                  U
                </span>
                <div>
                  <div className="font-display tracking-wide text-xs text-white group-hover:text-emerald-400 leading-none">
                    PATADA BAJA
                  </div>
                  <div className="text-[9px] font-mono text-slate-400">65 DMG</div>
                </div>
              </button>

              <div className="w-[1px] h-6 bg-white/10" />

              {/* I: Roundhouse */}
              <button
                onClick={() => handleTriggerTouchAttack('roundhouse')}
                className="group active:scale-95 transition-all hover:bg-white/10 px-2.5 py-1.5 rounded-lg flex items-center gap-2 text-left"
                title="I: Muay Thai Roundhouse"
              >
                <span className="w-6 h-6 rounded bg-white/10 group-hover:bg-emerald-400/20 border border-white/20 flex items-center justify-center font-mono font-bold text-xs text-emerald-400">
                  I
                </span>
                <div>
                  <div className="font-display tracking-wide text-xs text-white group-hover:text-emerald-400 leading-none">
                    CIRCULAR
                  </div>
                  <div className="text-[9px] font-mono text-slate-400">115 DMG</div>
                </div>
              </button>

              <div className="w-[1px] h-6 bg-white/10" />

              {/* O: Axe Kick */}
              <button
                onClick={() => handleTriggerTouchAttack('axe_kick')}
                className="active:scale-95 transition-all bg-gradient-to-r from-crimson-glow/85 to-red-600/85 hover:from-crimson-glow hover:to-red-600 border border-crimson-glow/50 px-3 py-1.5 rounded-lg flex items-center gap-2 shadow-lg"
                title="O: Heavy Axe Kick"
              >
                <span className="w-6 h-6 rounded bg-black/40 border border-white/30 flex items-center justify-center font-mono font-bold text-xs text-white">
                  O
                </span>
                <div>
                  <div className="font-display tracking-wide text-xs text-white leading-none">AXE KICK</div>
                  <div className="text-[9px] font-mono text-red-200">160 DMG</div>
                </div>
              </button>
            </div>
          </div>

          {/* 2. DUAL HEALTH BARS DOCKED DIRECTLY BELOW THE SHORTCUTS */}
          <div className="w-full grid grid-cols-2 gap-3 sm:gap-6">
            {/* P1: AZURE SHADOW */}
            <div className="hud-glass px-3.5 py-2 rounded-xl border border-cyan-glow/30 flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="font-display text-xs sm:text-sm tracking-wide text-white">{p1?.name || 'AZURE SHADOW'}</span>
                  <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-cyan-glow/20 text-cyan-glow border border-cyan-glow/30">
                    {isP1 ? 'TÚ (P1)' : 'P1'}
                  </span>
                </div>
                <span className="font-mono text-xs font-bold text-cyan-glow">{p1?.health ?? 1000} HP</span>
              </div>

              {/* Health Bar */}
              <div className="w-full h-2.5 bg-slate-900 rounded-full overflow-hidden border border-white/15">
                <div
                  className="h-full bg-gradient-to-r from-emerald-400 via-cyan-400 to-cyan-glow rounded-full shadow-[0_0_8px_#00f0ff] transition-all duration-150"
                  style={{ width: `${Math.max(0, ((p1?.health ?? 1000) / 1000) * 100)}%` }}
                />
              </div>

              {/* Stamina */}
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1 bg-slate-900 rounded-full overflow-hidden border border-white/10">
                  <div
                    className="h-full bg-gold-glow rounded-full transition-all duration-75"
                    style={{ width: `${Math.max(0, p1?.stamina || 100)}%` }}
                  />
                </div>
                <div className="flex items-center gap-1 text-[9px] font-mono text-gold-glow">
                  <Flame className="w-2.5 h-2.5" />
                  <span>{Math.round(p1?.stamina || 100)}%</span>
                </div>
              </div>
            </div>

            {/* P2: CRIMSON GHOST */}
            <div className="hud-glass px-3.5 py-2 rounded-xl border border-crimson-glow/30 flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold text-crimson-glow">{p2?.health ?? 1000} HP</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-crimson-glow/20 text-crimson-glow border border-crimson-glow/30">
                    {!isP1 && playerSlot === 'p2' ? 'TÚ (P2)' : isAiMode ? 'IA BOT' : 'P2 RIVAL'}
                  </span>
                  <span className="font-display text-xs sm:text-sm tracking-wide text-white">{p2?.name || 'CRIMSON GHOST'}</span>
                </div>
              </div>

              {/* Health Bar (Reversed fill) */}
              <div className="w-full h-2.5 bg-slate-900 rounded-full overflow-hidden border border-white/15 flex justify-end">
                <div
                  className="h-full bg-gradient-to-l from-red-500 to-crimson-glow rounded-full shadow-[0_0_8px_#ff1744] transition-all duration-150"
                  style={{ width: `${Math.max(0, ((p2?.health ?? 1000) / 1000) * 100)}%` }}
                />
              </div>

              {/* Stamina */}
              <div className="flex items-center gap-2 justify-end">
                <div className="flex items-center gap-1 text-[9px] font-mono text-gold-glow">
                  <span>{Math.round(p2?.stamina || 100)}%</span>
                  <Flame className="w-2.5 h-2.5" />
                </div>
                <div className="flex-1 h-1 bg-slate-900 rounded-full overflow-hidden border border-white/10 flex justify-end">
                  <div
                    className="h-full bg-gold-glow rounded-full transition-all duration-75"
                    style={{ width: `${Math.max(0, p2?.stamina || 100)}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </footer>
      </div>

      {/* LAN Multiplayer Modal */}
      <LanMultiplayerModal
        isOpen={isLanModalOpen}
        onClose={() => setIsLanModalOpen(false)}
        roomId={roomId}
        onJoinRoom={(newRoomId) => {
          if (netRef.current) netRef.current.joinRoom(newRoomId);
        }}
        playerSlot={playerSlot}
        isP2Connected={isP2Connected}
        isAiMode={isAiMode}
        onToggleAi={() => setIsAiMode((prev) => !prev)}
      />

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        cameraMode={cameraMode}
        setCameraMode={setCameraMode}
        soundEnabled={soundEnabled}
        setSoundEnabled={setSoundEnabled}
        volume={volume}
        setVolume={setVolume}
        difficulty={difficulty}
        setDifficulty={setDifficulty}
      />

      {/* Victory / KO Modal */}
      <VictoryModal
        isOpen={isVictoryOpen}
        kills={snapshot?.winner === playerSlot ? 1 : 0}
        damageDealt={snapshot?.winner === 'p1' ? p1?.comboDamage || 750 : p2?.comboDamage || 750}
        onRestart={handleRestart}
      />
    </div>
  );
}
