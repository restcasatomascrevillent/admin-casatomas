import { precargarVersionAuditoria } from "@/lib/audit-version";

/**
 * Trabajo que la pantalla de login adelanta mientras el camarero escribe (07/11/2026).
 * Medido en la demo con buena red: de pulsar «Entrar» a ver el inicio ≈ 3 s, casi todo en
 * serie. Con cobertura de móvil, cada viaje en serie se nota. Nada de esto toca la seguridad:
 * la auditoría y panel-auth siguen siendo obligatorios en `signIn`; aquí solo se calienta.
 *
 *  · versión de la auditoría (`version_auditoria_panel`): se pide ya y queda en caché.
 *  · panel-auth: una petición OPTIONS (la que ya atiende la función para CORS, sin cuerpo ni
 *    credenciales) para que no le toque el arranque en frío al pulsar «Entrar».
 *  · chunks del Dashboard y de Reservas: se bajan en paralelo con la autenticación.
 */
let funcionDespertada = false;

export function despertarPanelAuth(): void {
  if (funcionDespertada) return;
  funcionDespertada = true;
  const base = import.meta.env.VITE_SUPABASE_URL;
  if (!base || typeof fetch !== "function") return;
  try {
    void fetch(`${base}/functions/v1/panel-auth`, { method: "OPTIONS", cache: "no-store" }).catch(
      () => undefined,
    );
  } catch {
    /* sin red: ya se intentará al entrar */
  }
}

let paginasPrecargadas = false;

export function precargarPaginasInicio(): void {
  if (paginasPrecargadas) return;
  paginasPrecargadas = true;
  // Mismos módulos que los `lazy()` de App.tsx: Vite comparte el chunk.
  void import("@/pages/Dashboard").catch(() => undefined);
  void import("@/pages/Reservas").catch(() => undefined);
}

/** Al montar la pantalla de login. */
export function precargarAlMontarLogin(): void {
  precargarVersionAuditoria();
  despertarPanelAuth();
  precargarPaginasInicio();
}
