import React, { useEffect } from 'react';
import confetti from 'canvas-confetti';
import { Trophy, RotateCcw, LogOut } from 'lucide-react';
import { soundManager } from '../audio/soundManager';

interface VictoryModalProps {
  isOpen: boolean;
  /** Espectador o empate: cierre sin fanfarria */
  neutral?: boolean;
  winnerLabel: string;
  /** Tipo de partida y duracion (texto para la UI) */
  matchInfo?: string;
  /** Mis eliminaciones y muertes finales; solo en partidas por tiempo */
  stats?: { kills: number; deaths: number } | null;
  isHost: boolean;
  onRematch: () => void;
  onBackToLobby: () => void;
  onLeave: () => void;
}

export const VictoryModal: React.FC<VictoryModalProps> = ({
  isOpen,
  neutral = false,
  winnerLabel,
  matchInfo,
  stats,
  isHost,
  onRematch,
  onBackToLobby,
  onLeave,
}) => {
  useEffect(() => {
    if (!isOpen || neutral) return;
    soundManager.playVictory();
    confetti({
      particleCount: 120,
      spread: 90,
      origin: { y: 0.6 },
      colors: ['#00f0ff', '#ffd600', '#ff1744', '#ffffff'],
    });
    const timer = setTimeout(() => {
      confetti({
        particleCount: 80,
        spread: 120,
        origin: { y: 0.4 },
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [isOpen, neutral]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-lg animate-in fade-in duration-300">
      <div className="w-full max-w-lg hud-glass border-2 border-gold-glow rounded-3xl p-8 text-center shadow-[0_0_50px_rgba(255,214,0,0.35)] relative overflow-hidden">
        {/* Neon Glow backdrop */}
        <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-64 h-64 bg-gold-glow/20 rounded-full blur-3xl pointer-events-none" />

        <div className="flex justify-center mb-4">
          <div className="w-20 h-20 rounded-2xl bg-gold-glow/15 border-2 border-gold-glow flex items-center justify-center shadow-[0_0_30px_#ffd600]">
            <Trophy className="w-10 h-10 text-gold-glow animate-bounce" />
          </div>
        </div>

        <div className="text-gold-glow font-mono text-sm tracking-widest uppercase mb-1">
          {neutral ? 'FIN DEL COMBATE' : 'COMBATE TERMINADO'}
        </div>
        <h1 className="font-display text-4xl sm:text-5xl text-white tracking-wider mb-2">
          {neutral ? 'RESULTADO' : 'VICTORIA'}
        </h1>
        <p className="text-slate-300 font-tactical text-sm mb-6">
          {neutral ? 'La partida ha terminado.' : 'Has dominado el octagono de combate.'}
        </p>

        <div className="hud-glass p-3 rounded-xl border border-white/10 mb-8">
          <div className="text-[10px] font-mono text-slate-400 mb-1">GANADOR</div>
          <div className="font-display text-2xl text-gold-glow">{winnerLabel}</div>
        </div>

        {matchInfo && <p className="text-[11px] font-mono text-slate-400 mb-3">TIPO: {matchInfo}</p>}
        {stats && (
          <p className="text-sm font-mono text-slate-200 mb-6">
            Eliminaciones <span className="text-gold-glow font-bold">{stats.kills}</span> · Muertes <span className="font-bold">{stats.deaths}</span>
          </p>
        )}

        <div className="space-y-2.5">
          {isHost ? (
            <div className="grid grid-cols-2 gap-2.5">
              <button
                onClick={onRematch}
                className="py-3 rounded-xl bg-gradient-to-r from-gold-glow via-yellow-400 to-amber-500 hover:from-yellow-300 hover:to-amber-400 text-slate-950 font-display text-sm tracking-wider shadow-[0_0_25px_#ffd600] flex items-center justify-center gap-2 transition-transform active:scale-95"
              >
                <RotateCcw className="w-4 h-4" />
                REVANCHA
              </button>
              <button
                onClick={onBackToLobby}
                className="py-3 rounded-xl hud-glass hover:bg-white/10 text-slate-200 font-display text-sm tracking-wider border border-white/15 transition-colors"
              >
                VOLVER AL LOBBY
              </button>
            </div>
          ) : (
            <p className="text-xs font-mono text-slate-400">Esperando al host</p>
          )}
          <button
            onClick={onLeave}
            className="w-full py-2.5 rounded-xl hud-glass hover:bg-white/10 text-slate-300 font-tactical text-xs border border-white/10 flex items-center justify-center gap-2 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            SALIR A LAS SALAS
          </button>
        </div>
      </div>
    </div>
  );
};
