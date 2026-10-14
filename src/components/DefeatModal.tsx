import React from 'react';
import { Skull, RotateCcw, Eye } from 'lucide-react';

interface DefeatModalProps {
  isOpen: boolean;
  rank: number;
  kills: number;
  onRestart: () => void;
  onSpectate: () => void;
}

export const DefeatModal: React.FC<DefeatModalProps> = ({
  isOpen,
  rank,
  kills,
  onRestart,
  onSpectate,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-md hud-glass border border-crimson-glow/50 rounded-3xl p-7 text-center shadow-[0_0_40px_rgba(255,23,68,0.3)] relative">
        <div className="flex justify-center mb-4">
          <div className="w-16 h-16 rounded-2xl bg-crimson-glow/20 border-2 border-crimson-glow flex items-center justify-center shadow-[0_0_20px_#ff1744]">
            <Skull className="w-8 h-8 text-crimson-glow animate-pulse" />
          </div>
        </div>

        <div className="text-crimson-glow font-mono text-xs tracking-widest uppercase mb-1">
          ELIMINADO DEL OCTÁGONO
        </div>
        <h2 className="font-display text-3xl sm:text-4xl text-white tracking-wider mb-2">
          HAS CAÍDO
        </h2>
        <p className="text-slate-400 font-tactical text-xs mb-6">
          Un rival te noqueó en la zona de combate.
        </p>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          <div className="hud-glass p-3 rounded-xl border border-white/10">
            <span className="text-[10px] font-mono text-slate-400 block mb-1">POSICIÓN FINAL</span>
            <span className="font-display text-2xl text-white">TOP #{rank}</span>
          </div>
          <div className="hud-glass p-3 rounded-xl border border-white/10">
            <span className="text-[10px] font-mono text-slate-400 block mb-1">BAJAS LOGRADAS</span>
            <span className="font-display text-2xl text-cyan-glow">{kills < 10 ? `0${kills}` : kills}</span>
          </div>
        </div>

        <div className="space-y-2.5">
          <button
            onClick={onRestart}
            className="w-full py-3 rounded-xl bg-crimson-glow hover:bg-red-500 text-white font-display text-base tracking-wider shadow-[0_0_20px_#ff1744] flex items-center justify-center gap-2 transition-transform active:scale-95"
          >
            <RotateCcw className="w-4 h-4" />
            REINTENTAR PARTIDA
          </button>
          <button
            onClick={onSpectate}
            className="w-full py-2.5 rounded-xl hud-glass hover:bg-white/10 text-slate-300 font-tactical text-xs border border-white/10 flex items-center justify-center gap-2 transition-colors"
          >
            <Eye className="w-4 h-4 text-cyan-glow" />
            ESPECTEAR COMBATE RESTANTE
          </button>
        </div>
      </div>
    </div>
  );
};
