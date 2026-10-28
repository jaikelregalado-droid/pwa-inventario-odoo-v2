import React, { useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from './usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  // Si ya está instalado como PWA standalone, ocultar el botón
  if (isInstalled) {
    return null;
  }

  // Flujo Chrome / Android / Escritorio
  if (isInstallable) {
    return (
      <button
        onClick={install}
        className="flex items-center gap-1.5 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white px-3 py-1.5 text-xs font-semibold shadow-xs transition-all active:scale-95 cursor-pointer"
        title="Instalar como app móvil nativa"
      >
        <Download className="w-3.5 h-3.5" />
        <span>Instalar App</span>
      </button>
    );
  }

  // Flujo iOS Safari
  if (isIOS) {
    return (
      <>
        <button
          onClick={() => setShowIOSGuide(true)}
          className="flex items-center gap-1.5 rounded-xl border border-[#E2E8F0] bg-white hover:bg-slate-50 text-[#0F172A] px-3 py-1.5 text-xs font-medium transition cursor-pointer shadow-2xs"
        >
          <Smartphone className="w-3.5 h-3.5 text-[#7C3AED]" />
          <span>Instalar en iPhone</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
            <div className="w-full max-w-sm rounded-3xl bg-white border border-[#E2E8F0] p-5 shadow-2xl text-left text-[#0F172A]">
              <div className="flex items-center justify-between pb-3 border-b border-[#E2E8F0]">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl bg-purple-50 border border-purple-200 text-[#7C3AED]">
                    <Smartphone className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-[#0F172A]">Instalar en iOS Safari</h3>
                    <p className="text-xs text-[#64748B]">Para uso a pantalla completa en piso</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowIOSGuide(false)}
                  className="p-1.5 text-[#64748B] hover:text-[#0F172A] rounded-xl hover:bg-slate-100 transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="mt-4 space-y-3 text-xs text-[#0F172A]">
                <div className="flex items-start gap-3 p-2.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[#7C3AED] text-white font-bold text-[10px] shrink-0">1</span>
                  <p>Toca el botón <strong>Compartir</strong> <span className="inline-block px-1.5 py-0.5 rounded bg-white border border-[#CBD5E1] text-[#0F172A] font-mono text-[10px]">⎋ / ⇪</span> en la barra inferior de Safari.</p>
                </div>
                <div className="flex items-start gap-3 p-2.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[#7C3AED] text-white font-bold text-[10px] shrink-0">2</span>
                  <p>Desliza hacia abajo y selecciona <strong>"Agregar a Inicio"</strong> (+).</p>
                </div>
                <div className="flex items-start gap-3 p-2.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[#7C3AED] text-white font-bold text-[10px] shrink-0">3</span>
                  <p>Presiona <strong>Agregar</strong> en la esquina superior derecha para abrir la app sin barras de navegador.</p>
                </div>
              </div>

              <button
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] py-2.5 text-xs font-semibold text-white shadow-sm transition cursor-pointer"
              >
                Entendido
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
