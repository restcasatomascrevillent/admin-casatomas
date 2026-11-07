import { supabase } from "@/integrations/supabase/client";

/** Misma lectura que usa `useAdminFeatureToggles`. */
export const leerToggles = () =>
  supabase
    .from("admin_feature_toggles")
    .select("section_key, label, enabled, updated_at")
    .order("label", { ascending: true });

type LecturaToggles = Awaited<ReturnType<typeof leerToggles>>;

/**
 * Lectura adelantada (07/11/2026, login más rápido): el menú lateral pedía los toggles solo al
 * montarse, DESPUÉS de rol, permisos y super admin (otro viaje en serie). UserRoleProvider la
 * lanza en cuanto sabe quién entra, a la vez que rol y permisos, y la PRIMERA lectura del menú la
 * aprovecha si es reciente (10 s). Se usa una sola vez: las siguientes vuelven a preguntar.
 * Fuera del hook a propósito: las pruebas que simulan `useAdminFeatureToggles` no la pierden.
 */
let adelantada: { promesa: Promise<LecturaToggles>; t: number } | null = null;
const VIGENCIA_ADELANTADA_MS = 10_000;

export function precargarFeatureToggles(): void {
  try {
    const promesa = Promise.resolve(leerToggles()).then(
      (r) => r,
      (e) => ({ data: null, error: e }) as unknown as LecturaToggles,
    );
    adelantada = { promesa, t: Date.now() };
  } catch {
    adelantada = null; // cliente no disponible (pruebas): el menú lee como siempre
  }
}

export function tomarAdelantada(): Promise<LecturaToggles> | null {
  const a = adelantada;
  adelantada = null;
  return a && Date.now() - a.t < VIGENCIA_ADELANTADA_MS ? a.promesa : null;
}
