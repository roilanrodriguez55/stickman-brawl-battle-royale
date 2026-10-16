import React, { useState } from 'react';
import { Sliders } from 'lucide-react';
import { cleanName, truncateName, validateName } from '../profile/playerProfile';

interface WelcomeModalProps {
  onConfirm: (name: string) => void;
}

export const WelcomeModal: React.FC<WelcomeModalProps> = ({ onConfirm }) => {
  const [value, setValue] = useState('');
  const validName = validateName(value);
  const tooShort = validName === null && [...cleanName(value)].length < 2;

  const submit = () => {
    if (validName) onConfirm(validName);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
      <div className="w-full max-w-md hud-glass border border-cyan-glow/40 rounded-2xl p-6 shadow-2xl relative animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center gap-2.5 border-b border-white/10 pb-4 mb-5">
          <Sliders className="w-5 h-5 text-cyan-glow" />
          <h2 className="font-display tracking-wider text-xl text-white">BIENVENIDO AL COMBATE</h2>
        </div>

        <div className="space-y-3 text-sm font-tactical">
          <p className="text-slate-300">Elige el nombre con el que te verán los demás jugadores.</p>
          <label className="block text-xs font-mono text-slate-400" htmlFor="welcome-player-name">
            NOMBRE DE JUGADOR
          </label>
          <input
            id="welcome-player-name"
            type="text"
            autoFocus
            value={value}
            onChange={(e) => setValue(truncateName(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
            placeholder="Tu nombre"
            className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 focus:border-cyan-glow focus:outline-none text-white font-mono"
          />
          <p className="text-[11px] font-mono text-slate-400 min-h-[1rem]">
            {tooShort ? 'Escribe al menos 2 caracteres' : ''}
          </p>
        </div>

        <div className="mt-4 pt-4 border-t border-white/10 flex justify-end">
          <button
            onClick={submit}
            disabled={!validName}
            className="px-5 py-2 rounded-xl bg-cyan-glow hover:bg-cyan-300 disabled:bg-white/10 disabled:text-slate-500 disabled:shadow-none text-slate-950 font-display tracking-wider text-sm shadow-[0_0_14px_#00f0ff] transition-all"
          >
            ENTRAR
          </button>
        </div>
      </div>
    </div>
  );
};
