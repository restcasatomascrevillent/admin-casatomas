/**
 * «Pestaña al iniciar sesión» (11/11/2026): cuándo se considera que se ENTRA al panel.
 *
 * Solo al entrar, no al navegar: la raíz (`/`, con la sesión ya abierta o al abrir el panel) y el
 * `/dashboard` al que lleva el formulario de acceso, que va marcado con `ESTADO_INICIO_SESION`. Un
 * `/dashboard` sin marca (menú, marcador) se respeta tal cual.
 */
export const ESTADO_INICIO_SESION = { inicioSesion: true } as const;

export function esEntradaAlPanel(pathname: string, state: unknown): boolean {
  if (pathname === "/") return true;
  return pathname === "/dashboard" && (state as { inicioSesion?: unknown } | null | undefined)?.inicioSesion === true;
}
