/**
 * Módulo de Conexión y Sincronización en Tiempo Real con Supabase
 * Soporta canales postgres_changes sobre la tabla 'audit_counts', Realtime Broadcast y Presence
 */

import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import { RealtimeCountUpdate, AuditorPresence } from '../types';

const STORAGE_KEY_CONFIG = 'odoo_audit_supabase_config';
const STORAGE_KEY_COUNTS = 'odoo_audit_counts_cache_';

export interface SupabaseSettings {
  url: string;
  anonKey: string;
}

let activeClient: SupabaseClient | null = null;
let activeChannel: RealtimeChannel | null = null;
let localBroadcastChannel: BroadcastChannel | null = null;

/**
 * Obtiene la configuración de Supabase guardada
 */
export function getSavedSupabaseSettings(): SupabaseSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CONFIG);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {
    // noop
  }
  return {
    url: '',
    anonKey: '',
  };
}

/**
 * Guarda las credenciales de Supabase
 */
export function saveSupabaseSettings(settings: SupabaseSettings) {
  try {
    localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(settings));
    // Reiniciar cliente si cambió
    activeClient = null;
  } catch {
    // noop
  }
}

/**
 * Obtiene o inicializa la instancia de SupabaseClient
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (activeClient) return activeClient;

  const { url, anonKey } = getSavedSupabaseSettings();
  if (url && anonKey && url.startsWith('http')) {
    try {
      activeClient = createClient(url, anonKey, {
        realtime: {
          params: {
            eventsPerSecond: 15,
          },
        },
      });
      return activeClient;
    } catch (err) {
      console.error('Error al inicializar cliente Supabase:', err);
    }
  }
  return null;
}

/**
 * Genera un PIN aleatorio de 4 dígitos para una nueva sesión de auditoría
 */
export function generateSessionPin(): string {
  const num = Math.floor(1000 + Math.random() * 9000);
  return String(num);
}

/**
 * Suscribe a los cambios en tiempo real para una sesión con un PIN específico
 * Implementa tanto 'postgres_changes' como 'broadcast' y 'presence' para redundancia y velocidad
 */
export function subscribeToAuditSession(
  pin: string,
  currentAuditor: { id: string; name: string },
  onCountUpdate: (update: RealtimeCountUpdate) => void,
  onAuditorsChange: (auditors: AuditorPresence[]) => void,
  onStatusChange: (status: 'connected' | 'connecting' | 'disconnected' | 'local_only') => void
): () => void {
  // Limpiar canal anterior si existe
  if (activeChannel) {
    activeChannel.unsubscribe();
    activeChannel = null;
  }

  // Soporte de BroadcastChannel nativo del navegador para sincronización inmediata multi-pestaña/ventana
  if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
    if (localBroadcastChannel) {
      localBroadcastChannel.close();
    }
    localBroadcastChannel = new BroadcastChannel(`odoo_audit_channel_${pin}`);
    localBroadcastChannel.onmessage = (event) => {
      if (event.data?.type === 'COUNT_UPDATE' && event.data.payload) {
        onCountUpdate(event.data.payload);
      }
    };
  }

  const client = getSupabaseClient();

  if (!client) {
    // Si no hay Supabase configurado, operamos en modo local/broadcast altamente funcional
    onStatusChange('local_only');
    onAuditorsChange([
      {
        id: currentAuditor.id,
        name: currentAuditor.name,
        pin,
        device: navigator.userAgent.includes('Mobile') ? 'Móvil' : 'Escritorio',
        joinedAt: new Date().toISOString(),
        lastActive: new Date().toISOString(),
      },
    ]);

    return () => {
      if (localBroadcastChannel) {
        localBroadcastChannel.close();
        localBroadcastChannel = null;
      }
    };
  }

  onStatusChange('connecting');

  // Canal unificado para Broadcast, Presence y Postgres Changes
  const channel = client.channel(`audit_session_${pin}`, {
    config: {
      presence: {
        key: currentAuditor.id,
      },
      broadcast: {
        self: false,
      },
    },
  });

  // 1. Escuchar mensajes 'broadcast' directos para latencia de milisegundos
  channel.on('broadcast', { event: 'count_update' }, ({ payload }) => {
    if (payload && payload.pin === pin) {
      onCountUpdate(payload as RealtimeCountUpdate);
    }
  });

  // 2. Escuchar 'postgres_changes' en la tabla 'audit_counts' filtrando por pin
  channel.on(
    'postgres_changes',
    {
      event: '*',
      schema: 'public',
      table: 'audit_counts',
      filter: `pin=eq.${pin}`,
    },
    (payload) => {
      const row = (payload.new || payload.old) as any;
      if (row && row.quant_id) {
        onCountUpdate({
          quantId: row.quant_id,
          countedQuantity: Number(row.counted_quantity),
          auditorName: row.auditor_name || 'Auditor',
          timestamp: row.updated_at || new Date().toISOString(),
          pin: row.pin,
          photoUrl: row.photo_url,
          notes: row.notes,
        });
      }
    }
  );

  // 3. Manejo de Presencia (Presence) de auditores en vivo
  channel.on('presence', { event: 'sync' }, () => {
    const presenceState = channel.presenceState();
    const activeAuditors: AuditorPresence[] = [];

    for (const key in presenceState) {
      const entries = presenceState[key] as any[];
      if (entries && entries.length > 0) {
        const item = entries[0];
        activeAuditors.push({
          id: key,
          name: item.name || 'Auditor',
          pin,
          device: item.device || 'Dispositivo',
          joinedAt: item.joinedAt || new Date().toISOString(),
          lastActive: new Date().toISOString(),
        });
      }
    }

    if (activeAuditors.length === 0) {
      activeAuditors.push({
        id: currentAuditor.id,
        name: currentAuditor.name,
        pin,
        device: navigator.userAgent.includes('Mobile') ? 'Móvil' : 'Escritorio',
        joinedAt: new Date().toISOString(),
        lastActive: new Date().toISOString(),
      });
    }

    onAuditorsChange(activeAuditors);
  });

  // Suscribirse y rastrear presencia
  channel.subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      onStatusChange('connected');
      await channel.track({
        id: currentAuditor.id,
        name: currentAuditor.name,
        device: navigator.userAgent.includes('Mobile') ? 'Móvil' : 'Escritorio',
        joinedAt: new Date().toISOString(),
      });
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      onStatusChange('disconnected');
    }
  });

  activeChannel = channel;

  return () => {
    channel.unsubscribe();
    if (activeChannel === channel) {
      activeChannel = null;
    }
    if (localBroadcastChannel) {
      localBroadcastChannel.close();
      localBroadcastChannel = null;
    }
  };
}

/**
 * Emite una actualización de conteo al canal Realtime y a la base de datos Supabase
 */
export async function broadcastCountUpdate(update: RealtimeCountUpdate): Promise<void> {
  // 1. Enviar por canal local de navegador para sincronizar pestañas instantáneamente
  if (localBroadcastChannel) {
    try {
      localBroadcastChannel.postMessage({
        type: 'COUNT_UPDATE',
        payload: update,
      });
    } catch {
      // noop
    }
  }

  // 2. Enviar por WebSocket Supabase si el canal está activo
  if (activeChannel) {
    try {
      await activeChannel.send({
        type: 'broadcast',
        event: 'count_update',
        payload: update,
      });
    } catch (err) {
      console.warn('Error al transmitir por Supabase broadcast:', err);
    }
  }

  // 3. Persistir en la tabla 'audit_counts' si el cliente Supabase está conectado
  const client = getSupabaseClient();
  if (client) {
    try {
      await client.from('audit_counts').upsert(
        {
          pin: update.pin,
          quant_id: update.quantId,
          counted_quantity: update.countedQuantity,
          auditor_name: update.auditorName,
          photo_url: update.photoUrl || null,
          notes: update.notes || null,
          updated_at: update.timestamp,
        },
        { onConflict: 'pin,quant_id' }
      );
    } catch (dbErr) {
      // Si la tabla no está creada aún, no bloqueamos la experiencia fluida de usuario
      console.warn('Nota: guardado en tabla audit_counts omitido o tabla no creada:', dbErr);
    }
  }
}

/**
 * Script SQL para inicializar la tabla 'audit_counts' en Supabase si el usuario desea persistencia
 */
export const SUPABASE_SQL_SCHEMA = `
-- Crea la tabla de conteos colaborativos de auditoría
CREATE TABLE IF NOT EXISTS public.audit_counts (
    id BIGSERIAL PRIMARY KEY,
    pin VARCHAR(10) NOT NULL,
    quant_id BIGINT NOT NULL,
    counted_quantity NUMERIC(12, 2) NOT NULL DEFAULT 0,
    auditor_name VARCHAR(100) NOT NULL,
    photo_url TEXT,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT audit_counts_pin_quant_unique UNIQUE (pin, quant_id)
);

-- Habilitar Realtime para la tabla
ALTER PUBLICATION supabase_realtime ADD TABLE public.audit_counts;

-- Políticas permisivas para la sesión de auditoría
ALTER TABLE public.audit_counts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Permitir lectura y escritura por PIN" ON public.audit_counts
    FOR ALL
    USING (true)
    WITH CHECK (true);
`;
