// ============================================================================
//  Peticiones (usuarios del panel) y Tickets (Super Admin) · lo común (13/11/2026)
// ----------------------------------------------------------------------------
//  Petición del dueño: «un generador de tickets tipo Jira pero muy sencillo:
//  título, prioridad y descripción con módulo afectado, para que los usuarios
//  reporten cosas; y en el superadmin un módulo de tickets, y que ese ticket lo
//  analice una IA y salga una tarea propuesta […] y el prompt para la IA».
//
//  Lo importan la Edge Function `analizar-peticion` (Deno) y el panel (Vite):
//  sin imports y sin Deno. Aquí viven la lista FIJA de módulos, prioridades,
//  estados, límites (los mismos que los CHECK de la migración
//  20261129100000_peticiones.sql) y la lectura defensiva del análisis de la IA.
//
//  «Solicitudes» ya son las solicitudes de reserva (GestionSolicitudes.tsx):
//  por eso esto se llama «Peticiones» (usuarios) y «Tickets» (Super Admin).
// ============================================================================

export const MAX_TITULO = 120;
export const MIN_TITULO = 3;
export const MAX_DESCRIPCION = 4000;
export const MIN_DESCRIPCION = 10;
export const MAX_MOTIVO_DESCARTE = 500;
/** Peticiones por usuario en 24 h (disparador de la migración): evita abusar de la IA. */
export const MAX_PETICIONES_DIA = 20;
/** Tamaño máximo de la captura (el cubo «peticiones» tiene el mismo límite). */
export const MAX_CAPTURA_BYTES = 5 * 1024 * 1024;
export const BUCKET_CAPTURAS = "peticiones";

/** Repositorio donde se haría el cambio. */
export type RepoPeticion = "panel" | "web" | "ambos";

export interface ModuloPeticion {
  clave: string;
  etiqueta: string;
  /** Dónde vive normalmente (orienta a la IA; ella decide al final). */
  repo: RepoPeticion;
  /** Rutas del panel que llevan a este módulo (para proponerlo solo en el formulario). */
  rutas?: string[];
}

/**
 * Secciones del panel (menú lateral y `SECTIONS` de useUserRole) más la web
 * pública y «Otro». La clave se guarda en `peticiones.modulo` (la migración
 * solo exige el formato; la lista manda aquí).
 */
export const MODULOS_PETICION: readonly ModuloPeticion[] = [
  { clave: "dashboard", etiqueta: "Dashboard (inicio)", repo: "panel", rutas: ["/", "/dashboard"] },
  { clave: "reservas", etiqueta: "Reservas", repo: "ambos", rutas: ["/reservas"] },
  { clave: "carta", etiqueta: "Carta (platos, vinos y bebidas)", repo: "ambos", rutas: ["/gestion-web?tab=carta", "/gestor-carta"] },
  { clave: "web", etiqueta: "Web pública (novedades, menús, tapas)", repo: "ambos", rutas: ["/gestion-web"] },
  { clave: "cheques", etiqueta: "Cheques regalo", repo: "ambos", rutas: ["/cheques"] },
  { clave: "tienda", etiqueta: "Tienda de vinos", repo: "ambos", rutas: ["/tienda"] },
  { clave: "facturas", etiqueta: "Facturas y albaranes", repo: "panel", rutas: ["/facturas", "/albaranes"] },
  { clave: "newsletter", etiqueta: "Newsletter", repo: "panel", rutas: ["/marketing"] },
  { clave: "rrss", etiqueta: "RRSS e Instagram", repo: "panel", rutas: ["/rrss", "/instagram"] },
  { clave: "resenas", etiqueta: "Reseñas de Google", repo: "panel", rutas: ["/super-admin/resenas"] },
  { clave: "usuarios", etiqueta: "Usuarios y permisos", repo: "panel", rutas: ["/usuarios", "/super-admin/usuarios"] },
  { clave: "avisos", etiqueta: "Avisos (la campana)", repo: "panel", rutas: ["/avisos"] },
  { clave: "cuenta", etiqueta: "Mi cuenta e inicio de sesión", repo: "panel" },
  { clave: "otro", etiqueta: "Otro", repo: "ambos" },
] as const;

export const CLAVES_MODULO: readonly string[] = MODULOS_PETICION.map((m) => m.clave);

export function moduloPorClave(clave: string | null | undefined): ModuloPeticion | null {
  return MODULOS_PETICION.find((m) => m.clave === clave) ?? null;
}

export function etiquetaModulo(clave: string | null | undefined): string {
  return moduloPorClave(clave)?.etiqueta ?? (clave ? clave : "Sin módulo");
}

/**
 * Módulo que corresponde a la página en la que estaba el usuario (para
 * proponerlo en el formulario). Gana la ruta más concreta (con `?tab=`).
 */
export function moduloDeRuta(ruta: string | null | undefined): string | null {
  if (!ruta) return null;
  const [camino, query = ""] = ruta.split("?");
  const limpio = camino.replace(/\/+$/, "") || "/";
  const params = new URLSearchParams(query);
  let mejor: { clave: string; peso: number } | null = null;
  for (const m of MODULOS_PETICION) {
    for (const r of m.rutas ?? []) {
      const [rCamino, rQuery] = r.split("?");
      const coincideCamino = limpio === rCamino || (rCamino !== "/" && limpio.startsWith(`${rCamino}/`));
      if (!coincideCamino) continue;
      let peso = rCamino.length;
      if (rQuery) {
        const esperado = new URLSearchParams(rQuery);
        let todos = true;
        esperado.forEach((v, k) => {
          if (params.get(k) !== v) todos = false;
        });
        if (!todos) continue;
        peso += 1000;
      }
      if (!mejor || peso > mejor.peso) mejor = { clave: m.clave, peso };
    }
  }
  return mejor?.clave ?? null;
}

export type PrioridadPeticion = "baja" | "normal" | "alta" | "urgente";
export const PRIORIDADES: readonly { valor: PrioridadPeticion; etiqueta: string; ayuda: string }[] = [
  { valor: "baja", etiqueta: "Baja", ayuda: "Cuando se pueda" },
  { valor: "normal", etiqueta: "Normal", ayuda: "Lo habitual" },
  { valor: "alta", etiqueta: "Alta", ayuda: "Me afecta bastante" },
  { valor: "urgente", etiqueta: "Urgente", ayuda: "No puedo trabajar: avisa al momento" },
] as const;
export const PESO_PRIORIDAD: Record<PrioridadPeticion, number> = { urgente: 4, alta: 3, normal: 2, baja: 1 };

export function etiquetaPrioridad(p: string | null | undefined): string {
  return PRIORIDADES.find((x) => x.valor === p)?.etiqueta ?? (p ?? "");
}

export type EstadoPeticion = "nueva" | "en_analisis" | "aceptada" | "hecha" | "descartada";
export const ESTADOS: readonly { valor: EstadoPeticion; etiqueta: string; ayuda: string }[] = [
  { valor: "nueva", etiqueta: "Recibida", ayuda: "Aún no la ha mirado nadie" },
  { valor: "en_analisis", etiqueta: "En análisis", ayuda: "La están estudiando" },
  { valor: "aceptada", etiqueta: "Aceptada", ayuda: "Se va a hacer" },
  { valor: "hecha", etiqueta: "Hecha", ayuda: "Ya está hecha" },
  { valor: "descartada", etiqueta: "Descartada", ayuda: "No se va a hacer (mira el motivo)" },
] as const;
export const ESTADOS_ABIERTOS: readonly EstadoPeticion[] = ["nueva", "en_analisis", "aceptada"];

export function etiquetaEstado(e: string | null | undefined): string {
  return ESTADOS.find((x) => x.valor === e)?.etiqueta ?? (e ?? "");
}

export type EstadoAnalisis = "pendiente" | "analizando" | "hecho" | "error";

// ─── Análisis de la IA ──────────────────────────────────────────────────────

export type TipoPeticion = "error" | "mejora" | "duda";
export type NivelRiesgo = "bajo" | "medio" | "alto";

export interface AnalisisPeticion {
  /** Una frase sencilla: qué quieren. */
  resumen: string;
  tipo: TipoPeticion;
  /** Qué se haría y cómo, en castellano llano para el dueño. */
  tarea_propuesta: string;
  pasos: string[];
  modulos_afectados: string[];
  repo: RepoPeticion;
  riesgo: { nivel: NivelRiesgo; motivo: string };
  toca_bd: boolean;
  criterios_aceptacion: string[];
  /** Lo que habría que preguntar a quien la envió si falta información. */
  preguntas: string[];
  /** Prompt listo para pegar en una IA de programación (con las reglas del repo al final). */
  prompt_ia: string;
}

const TIPOS: readonly TipoPeticion[] = ["error", "mejora", "duda"];
const NIVELES: readonly NivelRiesgo[] = ["bajo", "medio", "alto"];
const REPOS: readonly RepoPeticion[] = ["panel", "web", "ambos"];

function texto(v: unknown, max: number): string {
  // Postgres no admite el carácter nulo en text/jsonb.
  return typeof v === "string" ? v.split(String.fromCharCode(0)).join("").trim().slice(0, max) : "";
}

function lista(v: unknown, maxElementos: number, maxLargo: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => texto(x, maxLargo))
    .filter((x) => x.length > 0)
    .slice(0, maxElementos);
}

function uno<T extends string>(v: unknown, validos: readonly T[], porDefecto: T): T {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return (validos as readonly string[]).includes(s) ? (s as T) : porDefecto;
}

/**
 * Lee un análisis (el JSON de la IA o el `analisis` guardado) a la defensiva:
 * recorta largos, descarta lo que no es texto y pone valores por defecto.
 * Devuelve null si falta lo imprescindible (resumen, tarea o prompt).
 */
export function normalizarAnalisis(raw: unknown): AnalisisPeticion | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const riesgoRaw = (r.riesgo && typeof r.riesgo === "object" ? r.riesgo : {}) as Record<string, unknown>;
  const a: AnalisisPeticion = {
    resumen: texto(r.resumen, 400),
    tipo: uno(r.tipo, TIPOS, "mejora"),
    tarea_propuesta: texto(r.tarea_propuesta, 3000),
    pasos: lista(r.pasos, 12, 400),
    modulos_afectados: lista(r.modulos_afectados, 10, 80),
    repo: uno(r.repo, REPOS, "panel"),
    riesgo: {
      nivel: uno(typeof r.riesgo === "string" ? r.riesgo : riesgoRaw.nivel, NIVELES, "medio"),
      motivo: texto(riesgoRaw.motivo, 600),
    },
    toca_bd: r.toca_bd === true,
    criterios_aceptacion: lista(r.criterios_aceptacion, 10, 400),
    preguntas: lista(r.preguntas, 6, 300),
    prompt_ia: texto(r.prompt_ia, 16000),
  };
  if (!a.resumen || !a.tarea_propuesta || !a.prompt_ia) return null;
  return a;
}

export const ETIQUETA_TIPO: Record<TipoPeticion, string> = { error: "Error", mejora: "Mejora", duda: "Duda" };
export const ETIQUETA_REPO: Record<RepoPeticion, string> = {
  panel: "Panel (admin-casatomas)",
  web: "Web pública (web-casatomas)",
  ambos: "Panel y web",
};
export const ETIQUETA_RIESGO: Record<NivelRiesgo, string> = { bajo: "Bajo", medio: "Medio", alto: "Alto" };

/**
 * Tipo de dispositivo a partir del user agent (lo único que se manda a la IA:
 * nunca el user agent completo).
 */
export function tipoDispositivo(ua: string | null | undefined): "móvil" | "tablet" | "ordenador" | "desconocido" {
  const s = (ua ?? "").toLowerCase();
  if (!s) return "desconocido";
  if (/ipad|tablet|kindle|silk|playbook|(android(?!.*mobile))/.test(s)) return "tablet";
  if (/mobi|iphone|ipod|android|windows phone/.test(s)) return "móvil";
  // iPadOS se presenta como Mac de escritorio; con pantalla táctil lo marca el panel al guardar.
  return "ordenador";
}

/** Solo el camino de la página (sin `?…` ni `#…`): los parámetros pueden llevar identificadores. */
export function caminoDeRuta(ruta: string | null | undefined): string {
  const s = (ruta ?? "").trim();
  if (!s) return "";
  return s.split(/[?#]/)[0].slice(0, 200);
}
