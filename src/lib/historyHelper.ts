/**
 * Utilidades para serializar y deserializar el historial de conteos parciales
 * Compatible con la columna 'notes' de Supabase y almacenamiento local
 */

export function encodeCountHistory(history: number[], existingNotes?: string): string {
  const cleanHistory = (history || []).map(n => Math.round(Number(n) * 1000) / 1000);
  const userText = (existingNotes || '').replace(/\[HIST:\[.*?\]\]/g, '').trim();
  const histTag = `[HIST:${JSON.stringify(cleanHistory)}]`;
  return userText ? `${histTag} ${userText}` : histTag;
}

export function decodeCountHistory(notes?: string | null): { history: number[]; cleanNotes: string } {
  if (!notes) return { history: [], cleanNotes: '' };
  const match = notes.match(/\[HIST:(\[.*?\])\]/);
  if (match) {
    try {
      const parsed = JSON.parse(match[1]);
      const history = Array.isArray(parsed) ? parsed.map(Number) : [];
      const cleanNotes = notes.replace(match[0], '').trim();
      return { history, cleanNotes };
    } catch (e) {
      // Fallback
    }
  }
  return { history: [], cleanNotes: notes };
}
