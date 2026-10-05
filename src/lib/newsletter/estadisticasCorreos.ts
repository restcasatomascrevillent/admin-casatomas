// ============================================================================
// ESTADÍSTICAS DE LOS CORREOS — cuentas puras (sin I/O) de la pestaña
// Newsletter › Estadísticas. El hook `useEstadisticasCorreos` lee
// `email_eventos` (lo que archiva resend-webhook) y llama aquí.
// ----------------------------------------------------------------------------
// QUÉ SE CUENTA: TODOS los correos que el restaurante manda por Resend (los de
// las reservas —verificación, propuesta, confirmación, recordatorio…— y los de
// la newsletter). `email_eventos` no distingue unos de otros de forma fiable
// para los envíos directos, y la pestaña siempre ha leído la tabla entera; las
// cifras de cada newsletter por separado están en el historial de envíos.
//
// POR QUÉ ESTE FICHERO (2026-10-05): las cifras no cuadraban entre sí. El
// componente contaba correos únicos POR TIPO DE EVENTO y luego los SUMABA:
// «entregados» = delivered + opened + clicked y «abiertos» = opened + clicked.
// Pero un correo abierto también tiene su evento delivered, y uno con clic
// suele tener también el de opened, así que el mismo correo se contaba dos y
// tres veces: con 30 enviados, 30 delivered, 5 opened y 4 clicked salían
// «39 entregados» (más que enviados) y «9 abiertos», mientras los porcentajes
// (delivered/sent = 100 %, opened/sent = 17 %) y el desglose (30 · 5 · 4)
// usaban las cifras sin sumar. Ahora hay UNA sola base: cada correo
// (`email_id`) se cuenta UNA vez en cada estado, y todas las tarjetas, el
// desglose y la tendencia salen de ella.
//
// REGLAS (por correo, `email_id`):
//   · enviado      = tiene cualquier evento de correo (TIPOS_EVENTO_CORREO).
//   · entregado    = delivered, opened, clicked o complained: abrirlo, hacer
//                    clic o marcarlo como spam prueba que llegó aunque falte
//                    (o llegue tarde) el evento delivered.
//   · abierto      = opened o clicked: un clic sin apertura es un píxel de
//                    seguimiento bloqueado, no un correo sin abrir.
//   · con clic     = clicked.
//   · no entregado = bounced, suppressed o failed, y NO entregado (un correo
//                    no cuenta a la vez como entregado y como no entregado).
//   · spam         = complained.
//   Así entregados ≤ enviados, clics ≤ abiertos ≤ entregados y
//   entregados + no entregados ≤ enviados, siempre.
//   · tasas        = correos únicos en ese estado / enviados, redondeado.
//   · tendencia    = por día de Madrid, los correos que ALCANZARON cada estado
//                    ese día (fecha del primer evento que lo prueba), cada uno
//                    una vez. Antes sumaba eventos (dos aperturas = 2).
// Los eventos de contacto (`contact.*`) y los de correo entrante no son
// correos enviados y no cuentan.
// ============================================================================

import { fechaMadrid, sumarDias } from "@/lib/reservas/ventanaAsignacion";

/** Tipos de evento (sin el prefijo `email.`) que corresponden a un correo que se envió o intentó enviar. */
export const TIPOS_EVENTO_CORREO = [
  "sent",
  "delivered",
  "delivery_delayed",
  "opened",
  "clicked",
  "bounced",
  "complained",
  "suppressed",
  "failed",
] as const;

const TIPOS_CORREO = new Set<string>(TIPOS_EVENTO_CORREO);
const PRUEBA_ENTREGA = new Set(["delivered", "opened", "clicked", "complained"]);
const PRUEBA_APERTURA = new Set(["opened", "clicked"]);
const PRUEBA_NO_ENTREGA = new Set(["bounced", "suppressed", "failed"]);

export interface EventoCorreo {
  tipo_evento: string;
  email_id: string;
  timestamp_evento: string | null;
  created_at?: string | null;
}

export interface CifrasCorreos {
  enviados: number;
  entregados: number;
  abiertos: number;
  clics: number;
  noEntregados: number;
  spam: number;
}

/** Porcentajes (enteros) sobre `enviados`. */
export interface TasasCorreos {
  entrega: number;
  apertura: number;
  clics: number;
}

export interface DiaCorreos {
  /** Día de Madrid, `YYYY-MM-DD`. */
  fecha: string;
  enviados: number;
  entregados: number;
  abiertos: number;
  clics: number;
}

export interface ResumenCorreos {
  cifras: CifrasCorreos;
  tasas: TasasCorreos;
  /** Los últimos `dias` días (hoy incluido), en orden, con ceros en los días sin nada. */
  porDia: DiaCorreos[];
}

type Estado = "enviados" | "entregados" | "abiertos" | "clics" | "noEntregados" | "spam";

/** Primer instante (ms) en que el correo alcanzó cada estado; ausente = nunca. */
type EstadosCorreo = Partial<Record<Estado, number>>;

function instanteDe(e: EventoCorreo): number {
  const t = Date.parse(e.timestamp_evento ?? e.created_at ?? "");
  return Number.isFinite(t) ? t : Number.NaN;
}

function anotar(estados: EstadosCorreo, estado: Estado, instante: number) {
  const previo = estados[estado];
  if (previo === undefined) {
    estados[estado] = instante;
  } else if (Number.isFinite(instante) && (!Number.isFinite(previo) || instante < previo)) {
    estados[estado] = instante;
  }
}

export function porcentaje(parte: number, total: number): number {
  return total > 0 ? Math.round((parte / total) * 100) : 0;
}

/**
 * Resume los eventos de `email_eventos` en cifras coherentes entre sí (ver la cabecera).
 * `ahora` fija el «hoy» de la tendencia (día de Madrid).
 */
export function resumirEventosCorreo(
  eventos: readonly EventoCorreo[],
  { ahora = Date.now(), dias = 7 }: { ahora?: number | Date; dias?: number } = {},
): ResumenCorreos {
  const porCorreo = new Map<string, EstadosCorreo>();

  for (const evento of eventos) {
    if (!evento?.email_id || !TIPOS_CORREO.has(evento.tipo_evento)) continue;
    let estados = porCorreo.get(evento.email_id);
    if (!estados) {
      estados = {};
      porCorreo.set(evento.email_id, estados);
    }
    const t = instanteDe(evento);
    const tipo = evento.tipo_evento;
    anotar(estados, "enviados", t);
    if (PRUEBA_ENTREGA.has(tipo)) anotar(estados, "entregados", t);
    if (PRUEBA_APERTURA.has(tipo)) anotar(estados, "abiertos", t);
    if (tipo === "clicked") anotar(estados, "clics", t);
    if (PRUEBA_NO_ENTREGA.has(tipo)) anotar(estados, "noEntregados", t);
    if (tipo === "complained") anotar(estados, "spam", t);
  }

  const cifras: CifrasCorreos = { enviados: 0, entregados: 0, abiertos: 0, clics: 0, noEntregados: 0, spam: 0 };

  const hoy = fechaMadrid(ahora);
  const primerDia = sumarDias(hoy, -(Math.max(1, dias) - 1));
  const porDia = new Map<string, DiaCorreos>();
  for (let i = 0; i < Math.max(1, dias); i++) {
    const fecha = sumarDias(primerDia, i);
    porDia.set(fecha, { fecha, enviados: 0, entregados: 0, abiertos: 0, clics: 0 });
  }
  const sumarAlDia = (estado: "enviados" | "entregados" | "abiertos" | "clics", instante: number | undefined) => {
    if (instante === undefined || !Number.isFinite(instante)) return;
    const dia = porDia.get(fechaMadrid(instante));
    if (dia) dia[estado]++;
  };

  for (const estados of porCorreo.values()) {
    cifras.enviados++;
    const entregado = estados.entregados !== undefined;
    if (entregado) cifras.entregados++;
    if (estados.abiertos !== undefined) cifras.abiertos++;
    if (estados.clics !== undefined) cifras.clics++;
    if (!entregado && estados.noEntregados !== undefined) cifras.noEntregados++;
    if (estados.spam !== undefined) cifras.spam++;

    sumarAlDia("enviados", estados.enviados);
    sumarAlDia("entregados", estados.entregados);
    sumarAlDia("abiertos", estados.abiertos);
    sumarAlDia("clics", estados.clics);
  }

  return {
    cifras,
    tasas: {
      entrega: porcentaje(cifras.entregados, cifras.enviados),
      apertura: porcentaje(cifras.abiertos, cifras.enviados),
      clics: porcentaje(cifras.clics, cifras.enviados),
    },
    porDia: [...porDia.values()],
  };
}
