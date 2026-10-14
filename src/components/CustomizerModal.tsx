import React from 'react';
import { Sparkles, X, Zap } from 'lucide-react';

export interface FighterCustomization {
  name: string;
  style: string;
  styleBonus: string;
  colorHex: number;
  glowHex: number;
  glowName: string;
}

interface CustomizerModalProps {
  isOpen: boolean;
  onClose: () => void;
  customization: FighterCustomization;
  onSelect: (custom: FighterCustomization) => void;
}

export const STYLES = [
  {
    name: 'KRAV MAGA',
    bonus: '+15% Velocidad de combo & Desarmes',
    desc: 'Combate táctico de contacto continuo y máxima eficiencia física.',
  },
  {
    name: 'MUAY THAI',
    bonus: '+25% Daño en Patada y Rodillazo',
    desc: 'El arte de las ocho extremidades. Golpes devastadores a media distancia.',
  },
  {
    name: 'TAEKWONDO',
    bonus: '+20% Rango acrobático & Golpes giratorios',
    desc: 'Pateo dinámico de alta velocidad y quiebres de guardia veloces.',
  },
  {
    name: 'CYBER RONIN',
    bonus: '+30% Ventana de Contraataque (Parry)',
    desc: 'Artes marciales sintetizadas con reflejos cibernéticos de precisión.',
  },
  {
    name: 'BOXEO CLÁSICO',
    bonus: '+20% Daño de Jab & Uppercut',
    desc: 'Kinética pura de puños pesados, balance de peso y cabeceo defensivo.',
  },
];

export const AURAS = [
  { name: 'AZURE SHADOW', glowName: 'Cyan Neón', colorHex: 0x0c2538, glowHex: 0x00f0ff, ringColor: '#00f0ff' },
  { name: 'CRIMSON FURY', glowName: 'Rojo Carmesí', colorHex: 0x3d101d, glowHex: 0xff1744, ringColor: '#ff1744' },
  { name: 'EMERALD JADE', glowName: 'Verde Jade', colorHex: 0x122e1e, glowHex: 0x00ff88, ringColor: '#00ff88' },
  { name: 'THUNDER GOLD', glowName: 'Oro Tormenta', colorHex: 0x3d300d, glowHex: 0xffd600, ringColor: '#ffd600' },
  { name: 'VOID PHANTOM', glowName: 'Violeta Vacío', colorHex: 0x22133b, glowHex: 0xcc00ff, ringColor: '#cc00ff' },
];

export const CustomizerModal: React.FC<CustomizerModalProps> = ({
  isOpen,
  onClose,
  customization,
  onSelect,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md">
      <div className="w-full max-w-lg hud-glass border border-cyan-glow/40 rounded-2xl p-6 shadow-2xl relative animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-4 mb-5">
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-5 h-5 text-cyan-glow" />
            <h2 className="font-display tracking-wider text-xl text-white">PERSONALIZACIÓN DE COMBATE</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/15 text-slate-300 hover:text-white flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-5 text-sm font-tactical">
          {/* Estilos Marciales */}
          <div className="space-y-2">
            <label className="text-xs font-mono text-slate-300 flex items-center gap-2">
              <Zap className="w-4 h-4 text-cyan-glow" />
              ESTILO DE ARTE MARCIAL
            </label>
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {STYLES.map((st) => (
                <button
                  key={st.name}
                  onClick={() => {
                    onSelect({
                      ...customization,
                      style: st.name,
                      styleBonus: st.bonus,
                    });
                  }}
                  className={`w-full p-2.5 rounded-xl text-left border transition-all ${
                    customization.style === st.name
                      ? 'bg-cyan-glow/15 border-cyan-glow shadow-[0_0_12px_rgba(0,240,255,0.2)]'
                      : 'bg-white/5 border-white/10 hover:border-white/20'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-display text-sm tracking-wide text-white">{st.name}</span>
                    <span className="text-[10px] font-mono text-cyan-glow">{st.bonus}</span>
                  </div>
                  <div className="text-[11px] font-mono text-slate-400 mt-0.5">{st.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Color / Aura Neón */}
          <div className="space-y-2">
            <label className="text-xs font-mono text-slate-300">AURA DE LUCHADOR Y VISOR</label>
            <div className="grid grid-cols-5 gap-2">
              {AURAS.map((aur) => (
                <button
                  key={aur.name}
                  onClick={() => {
                    onSelect({
                      ...customization,
                      name: aur.name,
                      colorHex: aur.colorHex,
                      glowHex: aur.glowHex,
                      glowName: aur.glowName,
                    });
                  }}
                  className={`flex flex-col items-center gap-1.5 p-2 rounded-xl border transition-all ${
                    customization.glowHex === aur.glowHex
                      ? 'border-white bg-white/10 scale-105 shadow-lg'
                      : 'border-white/10 hover:border-white/25 bg-white/5'
                  }`}
                >
                  <div
                    className="w-6 h-6 rounded-full border border-white/40 shadow-sm"
                    style={{ backgroundColor: aur.ringColor, boxShadow: `0 0 10px ${aur.ringColor}` }}
                  />
                  <span className="text-[9px] font-mono text-slate-300 text-center leading-tight">
                    {aur.glowName}
                  </span>
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
            CONFIRMAR
          </button>
        </div>
      </div>
    </div>
  );
};
