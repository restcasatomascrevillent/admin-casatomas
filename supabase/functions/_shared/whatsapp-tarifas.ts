// ============================================================================
// Coste de los WhatsApp que manda el panel (API de WhatsApp Cloud de Meta)
// ============================================================================
// Lógica pura (sin Deno ni red): la usa servicios-uso para poner WhatsApp como
// un servicio más en Super Admin › Servicios, a partir de los mensajes que
// whatsapp-reservas registra en `whatsapp_mensajes` (migración 20261222100000).
//
// CÓMO COBRA META (página oficial, actualizada el 18/11/2026):
//   https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing
//   · Desde el 01/07/2025, por MENSAJE ENTREGADO (no por conversación). Lo que
//     no se entrega no se cobra. Los mensajes del cliente al negocio, gratis.
//   · El precio depende de la categoría (marketing, utility, authentication,
//     service) y del país del móvil que lo recibe.
//   · Desde el 01/10/2026 se cobran también los «utility» enviados dentro de
//     las 24 h en que el cliente ha escrito, y los mensajes de servicio (texto
//     libre) a partir del 1.001 de cada mes por número (los 1.000 primeros
//     del mes, gratis).
//   · Meta dice en el aviso de estado de cada mensaje (webhook) si lo cobra:
//     `pricing.billable` y `pricing.category`. Si lo tenemos, manda eso; si
//     no (webhook sin configurar), se estima con la categoría de la plantilla.
//
// TARIFA DE ESPAÑA (EUR, sin IVA): marketing 0,0585 €, utility y
// authentication 0,0166 €. Vigente desde el 01/07/2026: la página de Meta
// confirma que ese día subió el precio de marketing en España y que el
// 01/10/2026 no cambió nada para España. Las cifras son las de la tarjeta de
// precios en EUR de Meta (CSV enlazado en esa página), tal como las recogen
// varios proveedores (p. ej. https://tobachat.nl/en/whatsapp-api-pricing-by-country/,
// https://chatmaxima.com/whatsapp-api-pricing/spain/); el CSV no se pudo
// descargar desde aquí. El precio de los mensajes de servicio se toma igual
// que utility (por confirmar en el CSV; con 1.000 gratis al mes no se llega).
// Los descuentos por volumen de utility empiezan muy por encima de lo que
// manda un restaurante: no se aplican. Si Meta cambia la tarifa, se cambia aquí.
// ============================================================================

export type CategoriaWhatsApp = "marketing" | "utility" | "authentication" | "service";

export const CATEGORIAS_WHATSAPP: readonly CategoriaWhatsApp[] = ["marketing", "utility", "authentication", "service"];

export interface TarifaWhatsApp {
  moneda: "EUR";
  /** Precio por mensaje entregado, sin IVA. */
  precios: Record<CategoriaWhatsApp, number>;
  /** Mensajes de servicio gratis al mes por número. */
  servicioGratisMes: number;
  vigenteDesde: string;
  fuente: string;
}

export const TARIFA_WHATSAPP_ESPANA: TarifaWhatsApp = {
  moneda: "EUR",
  precios: { marketing: 0.0585, utility: 0.0166, authentication: 0.0166, service: 0.0166 },
  servicioGratisMes: 1000,
  vigenteDesde: "2026-07-01",
  fuente: "https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing",
};

export function esCategoriaWhatsApp(v: unknown): v is CategoriaWhatsApp {
  return typeof v === "string" && (CATEGORIAS_WHATSAPP as readonly string[]).includes(v);
}

/** Una fila de `whatsapp_mensajes` (solo lo que hace falta para el coste). */
export interface MensajeWhatsAppRegistrado {
  /** Categoría con la que se mandó (la de la plantilla, o 'service' si es texto libre). */
  categoria: string | null;
  /** enviando | enviado | entregado | leido | fallido | error */
  estado: string | null;
  /** `pricing.billable` del webhook de Meta (null si no ha llegado). */
  facturable?: boolean | null;
  /** `pricing.category` del webhook (Meta puede cobrar una plantilla «utility» como marketing). */
  categoria_cobrada?: string | null;
  tipo?: string | null;
}

export interface ResumenCosteWhatsApp {
  /** Mensajes que Meta aceptó (no fallidos). */
  mensajes: number;
  porCategoria: Record<CategoriaWhatsApp, number>;
  /** De esos, los que se cobran (o se estima que se cobran). */
  cobrados: Record<CategoriaWhatsApp, number>;
  fallidos: number;
  resenas: number;
  importe: number;
  /** true si todos los mensajes cobrables traen el dato de Meta (webhook). */
  todoConfirmadoPorMeta: boolean;
}

const ACEPTADOS = new Set(["enviado", "entregado", "leido"]);
const ceros = (): Record<CategoriaWhatsApp, number> => ({ marketing: 0, utility: 0, authentication: 0, service: 0 });

/**
 * Coste del mes de los mensajes registrados. Cuenta solo los que Meta aceptó
 * (`enviado`, `entregado`, `leido`): un `fallido` o `error` no se cobra. Un
 * `enviado` sin confirmación de entrega se cuenta como cobrado (si el webhook
 * no está configurado, nunca llega la entrega): mejor pasarse que quedarse corto.
 */
export function costeWhatsAppMes(filas: readonly MensajeWhatsAppRegistrado[], tarifa: TarifaWhatsApp = TARIFA_WHATSAPP_ESPANA): ResumenCosteWhatsApp {
  const porCategoria = ceros();
  const cobrados = ceros();
  let mensajes = 0;
  let fallidos = 0;
  let resenas = 0;
  let todoConfirmadoPorMeta = true;
  let servicioSinDato = 0;
  let servicioGratisUsados = 0;

  for (const f of filas) {
    const estado = f.estado ?? "";
    if (estado === "fallido" || estado === "error") {
      fallidos++;
      continue;
    }
    if (!ACEPTADOS.has(estado)) continue; // 'enviando': aún no sabemos si salió
    const categoria: CategoriaWhatsApp = esCategoriaWhatsApp(f.categoria_cobrada)
      ? f.categoria_cobrada
      : esCategoriaWhatsApp(f.categoria) ? f.categoria : "utility";
    mensajes++;
    porCategoria[categoria]++;
    if (f.tipo === "resena") resenas++;
    if (f.facturable === true) cobrados[categoria]++;
    else if (f.facturable === false) {
      if (categoria === "service") servicioGratisUsados++;
    } else if (categoria === "service") {
      servicioSinDato++;
    } else {
      todoConfirmadoPorMeta = false;
      cobrados[categoria]++;
    }
  }
  // Mensajes de servicio sin dato de Meta: los 1.000 primeros del mes, gratis.
  const gratisQuedan = Math.max(0, tarifa.servicioGratisMes - servicioGratisUsados - cobrados.service);
  const servicioCobrado = Math.max(0, servicioSinDato - gratisQuedan);
  if (servicioCobrado > 0) todoConfirmadoPorMeta = false;
  cobrados.service += servicioCobrado;

  const importe = CATEGORIAS_WHATSAPP.reduce((s, c) => s + cobrados[c] * tarifa.precios[c], 0);
  return { mensajes, porCategoria, cobrados, fallidos, resenas, importe: Math.round(importe * 10000) / 10000, todoConfirmadoPorMeta };
}

/** «0,0166 €» */
export function precioTexto(n: number): string {
  return `${n.toLocaleString("es-ES", { minimumFractionDigits: 4, maximumFractionDigits: 4 })} €`;
}
