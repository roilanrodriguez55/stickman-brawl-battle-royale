import React from 'react';
import { Skull, RotateCcw, LogOut } from 'lucide-react';

interface DefeatModalProps {
  isOpen: boolean;
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

export const DefeatModal: React.FC<DefeatModalProps> = ({
  isOpen,
  winnerLabel,
  matchInfo,
  stats,
  isHost,
  onRematch,
  onBackToLobby,
  onLeave,
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
          La partida ha terminado sin tu victoria.
        </p>

        <div className="hud-glass p-3 rounded-xl border border-white/10 mb-6">
          <span className="text-[10px] font-mono text-slate-400 block mb-1">GANADOR</span>
          <span className="font-display text-2xl text-white">{winnerLabel}</span>
        </div>

        {matchInfo && <p className="text-[11px] font-mono text-slate-400 mb-3">TIPO: {matchInfo}</p>}
        {stats && (
          <p className="text-sm font-mono text-slate-200 mb-6">
            Eliminaciones <span className="text-white font-bold">{stats.kills}</span> · Muertes <span className="font-bold">{stats.deaths}</span>
          </p>
        )}

        <div className="space-y-2.5">
          {isHost ? (
            <div className="grid grid-cols-2 gap-2.5">
              <button
                onClick={onRematch}
                className="py-3 rounded-xl bg-crimson-glow hover:bg-red-500 text-white font-display text-sm tracking-wider shadow-[0_0_20px_#ff1744] flex items-center justify-center gap-2 transition-transform active:scale-95"
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
