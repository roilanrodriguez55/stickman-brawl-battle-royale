import React, { useEffect, useState } from 'react';
import { Volume2, VolumeX, Shield, Sliders, User, X } from 'lucide-react';
import { soundManager } from '../audio/soundManager';
import { cleanName, truncateName, validateName } from '../profile/playerProfile';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  soundEnabled: boolean;
  setSoundEnabled: (enabled: boolean) => void;
  volume: number;
  setVolume: (v: number) => void;
  difficulty: 'normal' | 'hard' | 'practice';
  setDifficulty: (d: 'normal' | 'hard' | 'practice') => void;
  playerName: string;
  onChangeName: (name: string) => void;
  /** Aviso discreto bajo el campo de nombre, p. ej. si el servidor no guardo el cambio. */
  nameNotice?: string | null;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  soundEnabled,
  setSoundEnabled,
  volume,
  setVolume,
  difficulty,
  setDifficulty,
  playerName,
  onChangeName,
  nameNotice,
}) => {
  const [nameDraft, setNameDraft] = useState(playerName);

  // Al abrir o cambiar el nombre desde fuera, el borrador vuelve al nombre actual
  useEffect(() => {
    setNameDraft(playerName);
  }, [isOpen, playerName]);

  if (!isOpen) return null;

  const validDraft = validateName(nameDraft);
  const nameChanged = validDraft !== null && validDraft !== playerName;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md">
      <div className="w-full max-w-md hud-glass border border-cyan-glow/40 rounded-2xl p-6 shadow-2xl relative animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-4 mb-5">
          <div className="flex items-center gap-2.5">
            <Sliders className="w-5 h-5 text-cyan-glow" />
            <h2 className="font-display tracking-wider text-xl text-white">AJUSTES DE COMBATE</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/15 text-slate-300 hover:text-white flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-5 text-sm font-tactical">
          {/* Player Name */}
          <div className="space-y-2">
            <label htmlFor="settings-player-name" className="text-xs font-mono text-slate-300 flex items-center gap-2">
              <User className="w-4 h-4 text-cyan-glow" />
              NOMBRE DE JUGADOR
            </label>
            <div className="flex items-center gap-2">
              <input
                id="settings-player-name"
                type="text"
                value={nameDraft}
                onChange={(e) => setNameDraft(truncateName(e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && nameChanged && validDraft) onChangeName(validDraft);
                }}
                className="flex-1 min-w-0 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 focus:border-cyan-glow focus:outline-none text-white font-mono text-xs"
              />
              <button
                onClick={() => {
                  if (validDraft) onChangeName(validDraft);
                }}
                disabled={!nameChanged}
                className="px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors bg-cyan-glow/20 text-cyan-glow border-cyan-glow/40 hover:bg-cyan-glow/30 disabled:bg-white/5 disabled:text-slate-500 disabled:border-white/10 disabled:cursor-not-allowed"
              >
                Guardar
              </button>
            </div>
            <p className="text-[11px] font-mono text-slate-400 min-h-[1rem]">
              {validDraft === null && [...cleanName(nameDraft)].length < 2 ? 'Escribe al menos 2 caracteres' : ''}
            </p>
            {nameNotice && <p className="text-[11px] font-mono text-amber-300">{nameNotice}</p>}
          </div>

          {/* Audio Controls */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-mono text-slate-300">
              <span className="flex items-center gap-2">
                {soundEnabled ? <Volume2 className="w-4 h-4 text-cyan-glow" /> : <VolumeX className="w-4 h-4 text-red-400" />}
                EFECTOS DE SONIDO (WEB AUDIO)
              </span>
              <button
                onClick={() => {
                  const next = !soundEnabled;
                  setSoundEnabled(next);
                  soundManager.enabled = next;
                }}
                className={`px-2.5 py-0.5 rounded text-xs font-bold transition-colors ${
                  soundEnabled ? 'bg-cyan-glow/20 text-cyan-glow border border-cyan-glow/40' : 'bg-red-500/20 text-red-400 border border-red-500/40'
                }`}
              >
                {soundEnabled ? 'ACTIVO' : 'SILENCIADO'}
              </button>
            </div>
            {soundEnabled && (
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={volume}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    setVolume(v);
                    soundManager.volume = v;
                  }}
                  className="w-full accent-cyan-glow h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                />
                <span className="text-xs font-mono text-cyan-glow w-9 text-right">{Math.round(volume * 100)}%</span>
              </div>
            )}
          </div>

          {/* AI Bots Difficulty */}
          <div className="space-y-2">
            <label className="text-xs font-mono text-slate-300 flex items-center gap-2">
              <Shield className="w-4 h-4 text-gold-glow" />
              RITMO DE BATALLA CAMPAL
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'practice', label: 'Entrenamiento' },
                { id: 'normal', label: 'Normal 60F' },
                { id: 'hard', label: 'Frenético' },
              ].map((diff) => (
                <button
                  key={diff.id}
                  onClick={() => setDifficulty(diff.id as any)}
                  className={`p-2 rounded-lg text-center border font-mono text-xs transition-all ${
                    difficulty === diff.id
                      ? 'bg-gold-glow/20 border-gold-glow text-gold-glow'
                      : 'bg-white/5 border-white/10 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {diff.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 pt-4 border-t border-white/10 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-cyan-glow hover:bg-cyan-300 text-slate-950 font-display tracking-wider text-sm shadow-[0_0_14px_#00f0ff] transition-all"
          >
            GUARDAR Y VOLVER
          </button>
        </div>
      </div>
    </div>
  );
};
