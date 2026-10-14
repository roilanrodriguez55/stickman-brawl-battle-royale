import React, { useEffect } from 'react';
import confetti from 'canvas-confetti';
import { Trophy, Award, Flame, RotateCcw } from 'lucide-react';
import { soundManager } from '../audio/soundManager';

interface VictoryModalProps {
  isOpen: boolean;
  kills: number;
  damageDealt: number;
  onRestart: () => void;
}

export const VictoryModal: React.FC<VictoryModalProps> = ({
  isOpen,
  kills,
  damageDealt,
  onRestart,
}) => {
  useEffect(() => {
    if (isOpen) {
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
    }
  }, [isOpen]);

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
          BATALLA CAMPAL 50 JUGADORES
        </div>
        <h1 className="font-display text-4xl sm:text-5xl text-white tracking-wider mb-2">
          ¡VICTORIA MAGISTRAL!
        </h1>
        <p className="text-slate-300 font-tactical text-sm mb-6">
          Has eliminado a todos los contendientes y dominado el octágono de combate.
        </p>

        {/* Stats Grid */}
        <div className="grid grid-cols-3 gap-3 mb-8">
          <div className="hud-glass p-3 rounded-xl border border-white/10">
            <div className="flex items-center justify-center gap-1 text-[10px] font-mono text-slate-400 mb-1">
              <Award className="w-3.5 h-3.5 text-gold-glow" /> POSICIÓN
            </div>
            <div className="font-display text-2xl text-gold-glow">#1</div>
          </div>

          <div className="hud-glass p-3 rounded-xl border border-white/10">
            <div className="flex items-center justify-center gap-1 text-[10px] font-mono text-slate-400 mb-1">
              <Flame className="w-3.5 h-3.5 text-cyan-glow" /> BAJAS
            </div>
            <div className="font-display text-2xl text-cyan-glow">{kills < 10 ? `0${kills}` : kills}</div>
          </div>

          <div className="hud-glass p-3 rounded-xl border border-white/10">
            <div className="flex items-center justify-center gap-1 text-[10px] font-mono text-slate-400 mb-1">
              DAÑO TOTAL
            </div>
            <div className="font-display text-2xl text-white">{damageDealt}</div>
          </div>
        </div>

        <button
          onClick={onRestart}
          className="w-full py-3.5 rounded-xl bg-gradient-to-r from-gold-glow via-yellow-400 to-amber-500 hover:from-yellow-300 hover:to-amber-400 text-slate-950 font-display text-lg tracking-wider shadow-[0_0_25px_#ffd600] flex items-center justify-center gap-2 transition-transform active:scale-95"
        >
          <RotateCcw className="w-5 h-5" />
          VOLVER A JUGAR
        </button>
      </div>
    </div>
  );
};
