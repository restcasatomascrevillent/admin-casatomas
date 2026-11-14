import { supabase } from "@/integrations/supabase/client";

/** Lectura de `admin_feature_toggles` (interruptores de Control del Panel). */
export const leerToggles = () =>
  supabase
    .from("admin_feature_toggles")
    .select("section_key, label, enabled, updated_at")
    .order("label", { ascending: true });

export interface FilaToggle {
  section_key: string;
  label: string;
  enabled: boolean;
  /** Último cambio (Control del Panel lo enseña). */
  updated_at?: string | null;
}

export interface EstadoToggles {
  toggles: FilaToggle[];
  /** true hasta la primera lectura (y otra vez al cambiar de usuario). */
  loading: boolean;
}

/**
 * Lectura COMPARTIDA (14/11/2026). Antes cada `useAdminFeatureToggles()` leía la tabla por su cuenta; ahora
 * la usan también las rutas (ProtectedRoute, una por página) además del menú y Control del Panel, así que la
 * lectura vive una sola vez aquí y todos se enteran de los cambios (al apagar un módulo en Control del Panel,
 * el menú de esa pestaña cambia al momento).
 *
 * Lectura adelantada (07/11/2026, login más rápido): UserRoleProvider llama a `precargarFeatureToggles` en
 * cuanto sabe quién entra, a la vez que rol y permisos, en vez de esperar a que se monte el menú.
 *
 * Si la lectura falla, todo sigue activado (como siempre: un corte no esconde secciones).
 */
let estado: EstadoToggles = { toggles: [], loading: true };
let leido = false;
let enCurso: Promise<void> | null = null;
/** Cada lectura tiene su turno: la respuesta de una lectura vieja no pisa la de una nueva. */
let turno = 0;
const oyentes = new Set<() => void>();

function publicar(cambio: Partial<EstadoToggles>) {
  estado = { ...estado, ...cambio };
  oyentes.forEach((oyente) => oyente());
}

/** Solo filas con forma de interruptor (una respuesta rara no apaga nada). */
function filasValidas(data: unknown): FilaToggle[] | null {
  if (!Array.isArray(data)) return null;
  return data.filter(
    (f): f is FilaToggle =>
      !!f && typeof (f as FilaToggle).section_key === "string" && typeof (f as FilaToggle).enabled === "boolean",
  );
}

/**
 * Lee la tabla. Sin `forzar`, solo si nunca se ha leído y no hay otra lectura en marcha (la reutiliza).
 * Con `forzar` vuelve a preguntar (Control del Panel al abrirse, cambio de usuario).
 */
export function leerTogglesCompartidos(forzar = false): Promise<void> {
  if (!forzar && enCurso) return enCurso;
  if (!forzar && leido) return Promise.resolve();
  const mio = ++turno;
  const terminar = (filas: FilaToggle[] | null) => {
    if (mio !== turno) return;
    leido = true;
    enCurso = null;
    publicar(filas ? { toggles: filas, loading: false } : { loading: false });
  };
  let respuesta: Promise<{ data: unknown; error: unknown }>;
  try {
    respuesta = Promise.resolve(leerToggles()) as Promise<{ data: unknown; error: unknown }>;
  } catch (e) {
    respuesta = Promise.resolve({ data: null, error: e }); // cliente no disponible (pruebas)
  }
  const promesa = respuesta.then(
    ({ data, error }) => terminar(error ? null : filasValidas(data)),
    () => terminar(null),
  );
  enCurso = promesa;
  return promesa;
}

/** Al saber quién entra (UserRoleProvider): lectura nueva, con sus permisos, mientras el menú espera. */
export function precargarFeatureToggles(): void {
  publicar({ loading: true });
  void leerTogglesCompartidos(true);
}

export const estadoToggles = (): EstadoToggles => estado;

export function suscribirToggles(oyente: () => void): () => void {
  oyentes.add(oyente);
  return () => {
    oyentes.delete(oyente);
  };
}

/** Tras guardar en Control del Panel: las filas nuevas o cambiadas, para todos los que miran. */
export function aplicarFilasToggles(filas: FilaToggle[]): void {
  const resto = estado.toggles.filter((t) => !filas.some((f) => f.section_key === t.section_key));
  publicar({ toggles: [...resto, ...filas] });
}

/** Solo pruebas: vuelve al estado inicial. */
export function reiniciarTogglesParaPruebas(): void {
  estado = { toggles: [], loading: true };
  leido = false;
  enCurso = null;
  turno += 1;
  oyentes.clear();
}
