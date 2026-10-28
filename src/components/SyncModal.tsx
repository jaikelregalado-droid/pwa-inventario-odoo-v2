import React, { useState } from 'react';
import { X, Wifi, Database, Copy, Check, Radio, Code2, Server } from 'lucide-react';
import { getSavedSupabaseSettings, saveSupabaseSettings, SUPABASE_SQL_SCHEMA, SupabaseSettings } from '../lib/supabase';
import { sound } from '../lib/audio';

interface SyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  pin: string;
  connectionStatus: 'connected' | 'connecting' | 'disconnected' | 'local_only';
  onReconnect: () => void;
}

export const SyncModal: React.FC<SyncModalProps> = ({
  isOpen,
  onClose,
  pin,
  connectionStatus,
  onReconnect,
}) => {
  const [settings, setSettings] = useState<SupabaseSettings>(getSavedSupabaseSettings());
  const [copiedSql, setCopiedSql] = useState(false);
  const [showSql, setShowSql] = useState(false);

  if (!isOpen) return null;

  const handleSave = () => {
    saveSupabaseSettings(settings);
    sound.playSuccess();
    onReconnect();
    onClose();
  };

  const handleCopySql = () => {
    navigator.clipboard.writeText(SUPABASE_SQL_SCHEMA).then(() => {
      setCopiedSql(true);
      setTimeout(() => setCopiedSql(false), 2000);
      sound.playScan();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 animate-in fade-in">
      <div
        className="w-full max-w-lg rounded-2xl bg-[#1E293B] border border-[#334155] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-[#334155] bg-[#0F172A]/80">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-blue-950/60 border border-[#2563EB]/40 text-blue-400">
              <Radio className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#F8FAFC]">Sincronización en Tiempo Real</h3>
              <p className="text-xs text-[#94A3B8]">Supabase Realtime y Conteo Multidispositivo</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#94A3B8] hover:text-[#F8FAFC] hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto text-xs">
          {/* Estado Actual */}
          <div className="p-3.5 rounded-xl bg-[#0F172A] border border-[#334155] flex items-center justify-between">
            <div className="space-y-0.5">
              <span className="text-[10px] uppercase font-bold text-[#94A3B8] block">Canal Activo:</span>
              <span className="font-mono text-sm font-black text-blue-400">audit_session_{pin}</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1E293B] border border-[#334155]">
              <span
                className={`w-2 h-2 rounded-full ${
                  connectionStatus === 'connected'
                    ? 'bg-emerald-400'
                    : connectionStatus === 'local_only'
                    ? 'bg-blue-400'
                    : 'bg-amber-400'
                }`}
              />
              <span className="font-semibold text-[#F8FAFC]">
                {connectionStatus === 'connected'
                  ? 'WebSocket Cloud Conectado'
                  : connectionStatus === 'local_only'
                  ? 'Modo Local / Broadcast'
                  : 'Reconectando...'}
              </span>
            </div>
          </div>

          {/* Formulario de credenciales de Supabase */}
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-[#F8FAFC] font-medium">Supabase Project URL:</label>
              <input
                type="text"
                value={settings.url}
                onChange={(e) => setSettings({ ...settings, url: e.target.value.trim() })}
                placeholder="https://su-proyecto.supabase.co"
                className="w-full px-3 py-2 rounded-xl bg-[#0F172A] border border-[#334155] text-[#F8FAFC] placeholder-[#94A3B8] font-mono text-xs outline-none focus:border-[#2563EB]"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[#F8FAFC] font-medium">Supabase Anon Key:</label>
              <input
                type="password"
                value={settings.anonKey}
                onChange={(e) => setSettings({ ...settings, anonKey: e.target.value.trim() })}
                placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                className="w-full px-3 py-2 rounded-xl bg-[#0F172A] border border-[#334155] text-[#F8FAFC] placeholder-[#94A3B8] font-mono text-xs outline-none focus:border-[#2563EB]"
              />
            </div>
          </div>

          {/* Botón para ver esquema SQL de la tabla audit_counts */}
          <div>
            <button
              type="button"
              onClick={() => setShowSql(!showSql)}
              className="flex items-center gap-1.5 text-blue-400 hover:text-blue-300 font-semibold cursor-pointer"
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>{showSql ? 'Ocultar' : 'Ver'} Script SQL para Supabase (tabla audit_counts)</span>
            </button>

            {showSql && (
              <div className="mt-2 p-3 rounded-xl bg-[#0F172A] border border-[#334155] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-[#94A3B8] font-mono">schema.sql</span>
                  <button
                    onClick={handleCopySql}
                    className="flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300 cursor-pointer"
                  >
                    {copiedSql ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedSql ? 'Copiado' : 'Copiar SQL'}</span>
                  </button>
                </div>
                <pre className="font-mono text-[10px] text-slate-300 overflow-x-auto p-2 rounded bg-black/50 max-h-36">
                  {SUPABASE_SQL_SCHEMA}
                </pre>
              </div>
            )}
          </div>
        </div>

        <div className="p-4 border-t border-[#334155] bg-[#0F172A]/80 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-[#94A3B8] hover:text-[#F8FAFC] transition cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-5 py-2.5 rounded-xl bg-[#2563EB] hover:bg-blue-500 text-white text-xs font-bold shadow-lg shadow-blue-950 transition cursor-pointer"
          >
            Guardar y Reconectar
          </button>
        </div>
      </div>
    </div>
  );
};
