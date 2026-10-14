import React from 'react';
import { Volume2, VolumeX, Eye, Shield, Sliders, X } from 'lucide-react';
import { soundManager } from '../audio/soundManager';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  cameraMode: 'cinematic' | 'follow' | 'topdown' | 'orbit';
  setCameraMode: (mode: 'cinematic' | 'follow' | 'topdown' | 'orbit') => void;
  soundEnabled: boolean;
  setSoundEnabled: (enabled: boolean) => void;
  volume: number;
  setVolume: (v: number) => void;
  difficulty: 'normal' | 'hard' | 'practice';
  setDifficulty: (d: 'normal' | 'hard' | 'practice') => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  cameraMode,
  setCameraMode,
  soundEnabled,
  setSoundEnabled,
  volume,
  setVolume,
  difficulty,
  setDifficulty,
}) => {
  if (!isOpen) return null;

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

          {/* Camera View Mode */}
          <div className="space-y-2">
            <label className="text-xs font-mono text-slate-300 flex items-center gap-2">
              <Eye className="w-4 h-4 text-cyan-glow" />
              MODO DE CÁMARA
            </label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: 'cinematic', label: 'Cinemática Órbita', desc: 'Vista dinámica' },
                { id: 'follow', label: 'Tercera Persona', desc: 'Tras el luchador' },
                { id: 'topdown', label: 'Genial Arena', desc: 'Estrategia 360°' },
                { id: 'orbit', label: 'Control Libre', desc: 'Arrastrar con mouse' },
              ].map((cam) => (
                <button
                  key={cam.id}
                  onClick={() => setCameraMode(cam.id as any)}
                  className={`p-2.5 rounded-xl text-left border transition-all ${
                    cameraMode === cam.id
                      ? 'bg-cyan-glow/15 border-cyan-glow text-white shadow-[0_0_12px_rgba(0,240,255,0.2)]'
                      : 'bg-white/5 border-white/10 text-slate-400 hover:border-white/25 hover:text-slate-200'
                  }`}
                >
                  <div className="font-display tracking-wide text-xs text-white">{cam.label}</div>
                  <div className="text-[10px] font-mono text-slate-400">{cam.desc}</div>
                </button>
              ))}
            </div>
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
