// ============================================================================
//  «Cómo se hizo la reserva» — lectura de `reservas.origen` para el panel.
// ----------------------------------------------------------------------------
//  La columna la escribe la Edge Function reservas-web (ver
//  supabase/functions/reservas-web/origen.ts, forma v1). Aquí solo se LEE, con
//  tolerancia total: reservas sin origen (teléfono, panel, antiguas) o con un
//  objeto raro devuelven `null` y la sección enseña lo que haya en la fila.
// ============================================================================
import type { Json } from "@/integrations/supabase/types";

export interface OrigenClienteLeido {
  formularioAbiertoAt: string | null;
  primerContactoAt: string | null;
  enviadoAt: string | null;
  duracionSegundos: number | null;
  camposCambiados: string[];
  consultasDisponibilidad: number | null;
  consultasSinHueco: number | null;
  intentosFallidos: number | null;
  idioma: string | null;
  idiomaNavegador: string | null;
  paginaEntrada: string | null;
  paginaFormulario: string | null;
  referente: string | null;
  utm: Partial<Record<"source" | "medium" | "campaign" | "term" | "content", string>>;
  qr: string | null;
  pantalla: string | null;
}

export interface OrigenLeido {
  cliente: OrigenClienteLeido | null;
  recibidoAt: string | null;
  userAgent: string | null;
  dispositivo: string | null;
  navegador: string | null;
  sistema: string | null;
  procedencia: { tipo: string; detalle: string | null; campana: string | null } | null;
}

type Obj = Record<string, unknown>;
const esObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function leerOrigen(origen: Json | null | undefined | unknown): OrigenLeido | null {
  if (!esObj(origen)) return null;
  const s = esObj(origen.servidor) ? origen.servidor : {};
  const c = esObj(origen.cliente) ? origen.cliente : null;
  const p = esObj(s.procedencia) ? s.procedencia : null;

  let cliente: OrigenClienteLeido | null = null;
  if (c) {
    const utm: OrigenClienteLeido["utm"] = {};
    for (const k of ["source", "medium", "campaign", "term", "content"] as const) {
      const v = str(c[`utm_${k}`]);
      if (v) utm[k] = v;
    }
    const ancho = num(c.pantalla_ancho);
    const alto = num(c.pantalla_alto);
    cliente = {
      formularioAbiertoAt: str(c.formulario_abierto_at),
      primerContactoAt: str(c.primer_contacto_at),
      enviadoAt: str(c.enviado_at),
      duracionSegundos: num(c.duracion_segundos),
      camposCambiados: Array.isArray(c.campos_cambiados) ? c.campos_cambiados.filter((x): x is string => typeof x === "string") : [],
      consultasDisponibilidad: num(c.consultas_disponibilidad),
      consultasSinHueco: num(c.consultas_sin_hueco),
      intentosFallidos: num(c.intentos_fallidos),
      idioma: str(c.idioma),
      idiomaNavegador: str(c.idioma_navegador),
      paginaEntrada: str(c.pagina_entrada),
      paginaFormulario: str(c.pagina_formulario),
      referente: str(c.referente),
      utm,
      qr: str(c.qr),
      pantalla: ancho && alto ? `${ancho} × ${alto}` : null,
    };
  }

  return {
    cliente,
    recibidoAt: str(s.recibido_at),
    userAgent: str(s.user_agent),
    dispositivo: str(s.dispositivo),
    navegador: str(s.navegador),
    sistema: str(s.sistema),
    procedencia: p && str(p.origen_tipo) ? { tipo: p.origen_tipo as string, detalle: str(p.origen_detalle), campana: str(p.campana) } : null,
  };
}

/** 155 → «2 min 35 s»; 3725 → «1 h 2 min»; 40 → «40 s». */
export function formatearDuracion(segundos: number | null | undefined): string | null {
  if (segundos === null || segundos === undefined || !Number.isFinite(segundos) || segundos < 0) return null;
  const total = Math.round(segundos);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return m ? `${h} h ${m} min` : `${h} h`;
  if (m > 0) return s ? `${m} min ${s} s` : `${m} min`;
  return `${s} s`;
}

export const ETIQUETA_DISPOSITIVO: Record<string, string> = {
  movil: "Móvil",
  tablet: "Tableta",
  escritorio: "Ordenador",
  desconocido: "Desconocido",
};

export const ETIQUETA_PROCEDENCIA: Record<string, string> = {
  buscador: "Buscador",
  campana: "Campaña",
  qr: "Código QR",
  red_social: "Red social",
  enlace: "Enlace de otra web",
  directo: "Directo (sin referente)",
  interno: "Desde la propia web",
  desconocido: "Desconocida",
};

export const ETIQUETA_CANAL_ORIGEN: Record<string, string> = {
  web: "Web (formulario de reservas)",
  telefono: "Teléfono (asistente de voz)",
  manual: "Panel (apuntada a mano)",
  presencial: "En local (sin reserva)",
};

export const ETIQUETA_IDIOMA: Record<string, string> = { es: "Español", en: "Inglés", fr: "Francés" };

export const ETIQUETA_CAMPO_FORMULARIO: Record<string, string> = {
  fecha: "fecha",
  numero_comensales: "comensales",
  hora: "hora",
  nombre: "nombre",
  telefono: "teléfono",
  email: "email",
  notas_cliente: "notas",
  menu_del_dia: "menú del día",
  menu_cerrado: "menú cerrado",
  menu_precio: "precio del menú",
  zona_preferida: "dentro o fuera",
  acepta_condiciones: "condiciones",
  consentimiento_newsletter: "newsletter",
};

const CAMPOS_IGNORADOS = new Set(["updated_at", "origen", "id", "created_at"]);

/** Campos que cambiaron entre `antes` y `despues` de una entrada de auditoría. */
export function camposCambiados(detalles: unknown): string[] {
  if (!detalles || typeof detalles !== "object") return [];
  const d = detalles as { antes?: Record<string, unknown>; despues?: Record<string, unknown> };
  if (!d.antes || !d.despues) return [];
  const claves = new Set([...Object.keys(d.antes), ...Object.keys(d.despues)]);
  return [...claves].filter((k) => !CAMPOS_IGNORADOS.has(k) && JSON.stringify(d.antes?.[k]) !== JSON.stringify(d.despues?.[k]));
}
