// ============================================================================
// Historial de envíos (newsletter_envios) — I/O sin imports https:// (testeable)
// ----------------------------------------------------------------------------
// `canal` y `resend_broadcast_id` llegan con la migración 20261003193000. Si
// la función se despliega ANTES de aplicarla, el envío transaccional sigue
// funcionando: se reintenta el INSERT sin esas columnas. Un fallo aquí nunca
// tumba el envío (se queda en el log), igual que antes.
// ============================================================================

import type { FilaEnvio, RegistroEnvios } from "./broadcast.ts";

// deno-lint-ignore no-explicit-any
type ClienteSupabase = any;

function faltaColumna(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "42703" || error.code === "PGRST204" || /canal|resend_broadcast_id/i.test(error.message ?? "");
}

export function crearRegistroEnvios(db: ClienteSupabase, log: (m: string, e?: unknown) => void = console.error): RegistroEnvios {
  return {
    async insertar(fila: FilaEnvio): Promise<string | null> {
      try {
        const { data, error } = await db.from("newsletter_envios").insert(fila).select("id").single();
        if (!error) return (data?.id as string) ?? null;
        if (faltaColumna(error) && fila.canal === "transaccional") {
          const { canal: _c, resend_broadcast_id: _b, ...sinCanal } = fila;
          const reintento = await db.from("newsletter_envios").insert(sinCanal).select("id").single();
          if (!reintento.error) return (reintento.data?.id as string) ?? null;
          log("No se pudo registrar el envío en newsletter_envios:", reintento.error);
          return null;
        }
        log("No se pudo registrar el envío en newsletter_envios:", error);
        return null;
      } catch (e) {
        log("Error registrando historial de newsletter_envios:", e);
        return null;
      }
    },
    async actualizarEstado(id: string, estado: FilaEnvio["estado"]): Promise<void> {
      try {
        const { error } = await db.from("newsletter_envios").update({ estado }).eq("id", id);
        if (error) log(`No se pudo actualizar el estado del envío ${id}:`, error);
      } catch (e) {
        log(`Error actualizando el envío ${id}:`, e);
      }
    },
  };
}
