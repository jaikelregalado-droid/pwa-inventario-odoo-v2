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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in fade-in">
      <div
        className="w-full max-w-lg rounded-2xl bg-white border border-[#E2E8F0] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-[#E2E8F0] bg-white">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-purple-50 border border-purple-200 text-[#7C3AED]">
              <Radio className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#0F172A]">Sincronización en Tiempo Real</h3>
              <p className="text-xs text-[#64748B]">Supabase Realtime y Conteo Multidispositivo</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#64748B] hover:text-[#0F172A] hover:bg-slate-100 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto text-xs bg-white">
          {/* Estado Actual */}
          <div className="p-3.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] flex items-center justify-between">
            <div className="space-y-0.5">
              <span className="text-[10px] uppercase font-bold text-[#64748B] block">Canal Activo:</span>
              <span className="font-mono text-sm font-black text-[#7C3AED]">audit_session_{pin}</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-[#E2E8F0] shadow-xs">
              <span
                className={`w-2 h-2 rounded-full ${
                  connectionStatus === 'connected'
                    ? 'bg-emerald-500'
                    : connectionStatus === 'local_only'
                    ? 'bg-[#7C3AED]'
                    : 'bg-amber-500'
                }`}
              />
              <span className="font-semibold text-[#0F172A]">
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
              <label className="text-[#0F172A] font-medium">Supabase Project URL:</label>
              <input
                type="text"
                value={settings.url}
                onChange={(e) => setSettings({ ...settings, url: e.target.value.trim() })}
                placeholder="https://su-proyecto.supabase.co"
                className="w-full px-3 py-2 rounded-xl bg-white border border-[#CBD5E1] text-[#0F172A] placeholder-[#94A3B8] font-mono text-xs outline-none focus:border-[#7C3AED]"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[#0F172A] font-medium">Supabase Anon Key:</label>
              <input
                type="password"
                value={settings.anonKey}
                onChange={(e) => setSettings({ ...settings, anonKey: e.target.value.trim() })}
                placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                className="w-full px-3 py-2 rounded-xl bg-white border border-[#CBD5E1] text-[#0F172A] placeholder-[#94A3B8] font-mono text-xs outline-none focus:border-[#7C3AED]"
              />
            </div>
          </div>

          {/* Botón para ver esquema SQL de la tabla audit_counts */}
          <div>
            <button
              type="button"
              onClick={() => setShowSql(!showSql)}
              className="flex items-center gap-1.5 text-[#7C3AED] hover:underline font-semibold cursor-pointer"
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>{showSql ? 'Ocultar' : 'Ver'} Script SQL para Supabase (tabla audit_counts)</span>
            </button>

            {showSql && (
              <div className="mt-2 p-3 rounded-xl bg-white border border-[#E2E8F0] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-[#64748B] font-mono">schema.sql</span>
                  <button
                    onClick={handleCopySql}
                    className="flex items-center gap-1 text-[11px] text-[#7C3AED] hover:underline cursor-pointer"
                  >
                    {copiedSql ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedSql ? 'Copiado' : 'Copiar SQL'}</span>
                  </button>
                </div>
                <pre className="font-mono text-[10px] text-[#0F172A] overflow-x-auto p-2 rounded bg-[#F8FAFC] border border-[#E2E8F0] max-h-36">
                  {SUPABASE_SQL_SCHEMA}
                </pre>
              </div>
            )}
          </div>
        </div>

        <div className="p-4 border-t border-[#E2E8F0] bg-[#F8FAFC] flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-[#64748B] hover:text-[#0F172A] transition cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-5 py-2.5 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-bold shadow-sm transition cursor-pointer"
          >
            Guardar y Reconectar
          </button>
        </div>
      </div>
    </div>
  );
};
