/**
 * Módulo de Conexión y Sincronización en Tiempo Real con Supabase
 * Soporta canales postgres_changes sobre la tabla 'audit_counts', Realtime Broadcast y Presence
 */

import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import { RealtimeCountUpdate, AuditorPresence, AuditSession } from '../types';

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
 * 1. Verifica si una sesión con el PIN provisto ya existe en Supabase
 * Consulta tanto la tabla 'audit_sessions' como 'audit_counts'
 */
export async function checkSessionExistsInSupabase(pin: string): Promise<{
  configured: boolean;
  exists: boolean;
  session?: Partial<AuditSession>;
  counts?: RealtimeCountUpdate[];
  error?: string;
}> {
  const client = getSupabaseClient();
  if (!client) {
    // Si no hay cliente Supabase configurado, consultar en cache local
    const localCache = localStorage.getItem(`${STORAGE_KEY_COUNTS}${pin}`);
    if (localCache) {
      try {
        const parsed = JSON.parse(localCache);
        return {
          configured: false,
          exists: true,
          counts: parsed,
        };
      } catch {
        // noop
      }
    }
    return { configured: false, exists: false };
  }

  try {
    // 1. Intentar consultar tabla audit_sessions
    let sessionRecord: any = null;
    try {
      const { data, error } = await client
        .from('audit_sessions')
        .select('*')
        .eq('pin', pin)
        .maybeSingle();

      if (!error && data) {
        sessionRecord = data;
      }
    } catch {
      // noop si no existe tabla aún
    }

    // 2. Consultar conteos existentes en audit_counts
    let countsRows: any[] = [];
    try {
      const { data: countsData, error: countsErr } = await client
        .from('audit_counts')
        .select('*')
        .eq('pin', pin)
        .order('updated_at', { ascending: false });

      if (!countsErr && countsData && countsData.length > 0) {
        countsRows = countsData;
      }
    } catch {
      // noop
    }

    const hasSession = !!sessionRecord || countsRows.length > 0;
    if (!hasSession) {
      return { configured: true, exists: false };
    }

    const counts: RealtimeCountUpdate[] = countsRows.map((row) => ({
      quantId: Number(row.quant_id),
      countedQuantity: Number(row.counted_quantity),
      auditorName: row.auditor_name || 'Auditor',
      timestamp: row.updated_at || row.created_at || new Date().toISOString(),
      pin: row.pin,
      photoUrl: row.photo_url || undefined,
      notes: row.notes || undefined,
    }));

    // Cachear localmente para contingencia offline
    try {
      localStorage.setItem(`${STORAGE_KEY_COUNTS}${pin}`, JSON.stringify(counts));
    } catch {
      // noop
    }

    const foundSession: Partial<AuditSession> = {
      id: sessionRecord?.id || `session_${pin}`,
      pin,
      createdAt: sessionRecord?.created_at,
      companyName: sessionRecord?.company_name || 'FV GRUPO EMPRESARIAL, C.A.',
      companyId: sessionRecord?.company_id || undefined,
      locationName: sessionRecord?.location_name || 'WH/Existencias',
      locationId: sessionRecord?.location_id || undefined,
      categoryId: sessionRecord?.category_id || undefined,
      categoryName: sessionRecord?.category_name || undefined,
    };

    return {
      configured: true,
      exists: true,
      session: foundSession,
      counts,
    };
  } catch (err: any) {
    console.error('Error al verificar sesión en Supabase:', err);
    return {
      configured: true,
      exists: false,
      error: err?.message || String(err),
    };
  }
}

/**
 * 2. Recupera los conteos realizados por otros auditores para una sesión
 */
export async function fetchSessionCountsFromSupabase(pin: string): Promise<RealtimeCountUpdate[]> {
  if (!pin) return [];

  const client = getSupabaseClient();
  if (!client) {
    try {
      const local = localStorage.getItem(`${STORAGE_KEY_COUNTS}${pin}`);
      return local ? JSON.parse(local) : [];
    } catch {
      return [];
    }
  }

  try {
    const { data, error } = await client
      .from('audit_counts')
      .select('*')
      .eq('pin', pin)
      .order('updated_at', { ascending: false });

    if (error || !data) {
      const local = localStorage.getItem(`${STORAGE_KEY_COUNTS}${pin}`);
      return local ? JSON.parse(local) : [];
    }

    const mapped: RealtimeCountUpdate[] = data.map((row: any) => ({
      quantId: Number(row.quant_id),
      countedQuantity: Number(row.counted_quantity),
      auditorName: row.auditor_name || 'Auditor',
      timestamp: row.updated_at || row.created_at || new Date().toISOString(),
      pin: row.pin,
      photoUrl: row.photo_url || undefined,
      notes: row.notes || undefined,
    }));

    try {
      localStorage.setItem(`${STORAGE_KEY_COUNTS}${pin}`, JSON.stringify(mapped));
    } catch {
      // noop
    }

    return mapped;
  } catch (err) {
    console.warn('Error al recuperar conteos de Supabase:', err);
    try {
      const local = localStorage.getItem(`${STORAGE_KEY_COUNTS}${pin}`);
      return local ? JSON.parse(local) : [];
    } catch {
      return [];
    }
  }
}

/**
 * Registra o actualiza la metadata de la sesión en Supabase
 */
export async function registerSessionInSupabase(
  session: AuditSession,
  odooConfig?: any
): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;

  try {
    const sessionId = session.id || `session_${session.pin}_${Date.now()}`;
    await client.from('audit_sessions').upsert(
      {
        id: sessionId,
        pin: session.pin,
        lead_name: session.auditorName,
        company_name: session.companyName,
        company_id: session.companyId || null,
        location_name: session.locationName,
        location_id: session.locationId || null,
        category_name: session.categoryName || null,
        category_id: session.categoryId || null,
        odoo_url: odooConfig?.url || null,
        odoo_db: odooConfig?.db || null,
        status: 'active',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'pin' }
    );
    return true;
  } catch (err) {
    console.warn('Aviso: audit_sessions upsert no disponible:', err);
    return false;
  }
}

/**
 * Actualiza la categoría activa de una sesión en Supabase
 */
export async function updateSessionCategoryInSupabase(
  pin: string,
  categoryId: number,
  categoryName: string
): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;

  try {
    await client
      .from('audit_sessions')
      .update({
        category_id: categoryId,
        category_name: categoryName,
        updated_at: new Date().toISOString(),
      })
      .eq('pin', pin);
  } catch {
    // noop
  }
}

/**
 * Script SQL para inicializar las tablas 'audit_sessions' y 'audit_counts' en Supabase
 */
export const SUPABASE_SQL_SCHEMA = `
-- 1. Tabla de sesiones de auditoría colaborativas
CREATE TABLE IF NOT EXISTS public.audit_sessions (
    id TEXT PRIMARY KEY,
    pin VARCHAR(10) NOT NULL UNIQUE,
    lead_name VARCHAR(100) NOT NULL,
    company_name VARCHAR(150),
    company_id INTEGER,
    location_name VARCHAR(200),
    location_id INTEGER,
    category_name VARCHAR(150),
    category_id INTEGER,
    odoo_url TEXT,
    odoo_db TEXT,
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Tabla de conteos físicos por quant
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

-- Habilitar Realtime para ambas tablas
ALTER PUBLICATION supabase_realtime ADD TABLE public.audit_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.audit_counts;

-- Políticas de seguridad permisivas (RLS)
ALTER TABLE public.audit_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Permitir acceso a sesiones de auditoría" ON public.audit_sessions
    FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.audit_counts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Permitir lectura y escritura por PIN" ON public.audit_counts
    FOR ALL USING (true) WITH CHECK (true);
`;

