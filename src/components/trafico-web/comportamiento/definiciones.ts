/**
 * Definiciones de las métricas de comportamiento. Las MISMAS en Tráfico web,
 * en Super Admin › Logs › Estadísticas y en el informe en PDF: cualquier texto
 * que explique una cifra sale de aquí, y el cálculo, de la RPC
 * `web_comportamiento` (20261118100000_logs_web.sql). Nada se recalcula en el
 * navegador salvo tasas y variaciones sobre esas cifras.
 */

export const ZONA_HORARIA = "Europe/Madrid";

export const DEFINICIONES = {
  visitas:
    "Páginas vistas que cuenta Vercel Web Analytics: todos los visitantes, sin cookies. Es la cifra de referencia del volumen (días en UTC).",
  sesiones:
    "Visitas seguidas de un mismo navegador que aceptó «Estadísticas»; 30 minutos sin actividad abren otra. Solo una parte de las visitas: quien no acepta no se cuenta aquí.",
  visitantes:
    "Navegadores distintos (identificador seudónimo guardado con el consentimiento, hasta 6 meses). NO son personas: la misma persona en el móvil y en el ordenador cuenta dos veces, y borrar los datos del navegador cuenta como nuevo.",
  paginasVistas: "Páginas vistas dentro de esas sesiones (con consentimiento).",
  cobertura:
    "Páginas vistas con consentimiento frente a las páginas vistas de Vercel en el mismo periodo. Orientativa: Vercel cuenta días en UTC y aquí se usa la hora de Madrid.",
  tiempoActivo:
    "Tiempo con la página visible y en primer plano (se para al cambiar de pestaña o bloquear el móvil). Se usa la mediana: unas pocas sesiones larguísimas no la mueven.",
  scroll: "Hasta dónde baja el visitante en cada página vista (máximo alcanzado, en % del alto de la página).",
  conversion:
    "Operación COMPLETADA y confirmada por el servidor: solicitud de reserva aceptada (queda pendiente de que el restaurante la confirme) o cheque regalo pagado. Pulsar «Reservar» no cuenta.",
  embudo:
    "Entrada (sesiones) → consulta (abre reservas o consulta disponibilidad; abre «Regala») → inicio (empieza el formulario o va al pago) → finalización (operación completada).",
  abandono:
    "Sesiones que empezaron la operación y no la terminaron en esa sesión. Es una estimación: pudo terminarla por teléfono u otro día.",
  ultimaPagina: "Última página observada de la sesión. No es una salida confirmada: el navegador no avisa siempre al cerrarse.",
  procedencia:
    "Cómo entró la sesión: QR (enlace con ?qr=… o utm_medium=qr), campaña (utm_*), buscador, red social, enlace de otra web, interno o directo (sin procedencia: marcadores, apps de correo o mensajería…).",
  operacionesBd:
    "Operaciones web registradas por la base de datos para TODOS los visitantes (con o sin consentimiento). Sirven de referencia para saber cuántas conversiones no se ven en las sesiones.",
  excluido:
    "Fuera de las cifras: bots (por su navegador), tráfico interno (marcado con ?ct_interno=1) y pruebas automáticas. Se pueden incluir con el interruptor.",
} as const;

export const NOMBRE_ORIGEN: Record<string, string> = {
  buscador: "Buscador",
  campana: "Campaña",
  qr: "Código QR",
  red_social: "Red social",
  enlace: "Enlace de otra web",
  directo: "Directo",
  interno: "Interno",
  desconocido: "Desconocido",
};

export const NOMBRE_DISPOSITIVO: Record<string, string> = {
  movil: "Móvil",
  tablet: "Tablet",
  escritorio: "Ordenador",
  desconocido: "Desconocido",
};

export const NOMBRE_CONTENIDO: Record<string, string> = {
  carta_categoria: "Categorías de la carta",
  plato_abierto: "Platos",
  vino_abierto: "Vinos",
  bebida_abierta: "Bebidas",
  media: "Imágenes y vídeos",
  mapa_vinos: "Mapa de vinos",
  pedido: "«Mi mesa»",
};

export const NOMBRE_CONTACTO: Record<string, string> = {
  telefono: "Teléfono",
  whatsapp: "WhatsApp",
  email: "Correo",
  mapa: "Mapa / cómo llegar",
  red_social: "Redes sociales",
};

export const NOMBRE_OPERACION: Record<string, string> = { reserva: "Reservas", cheque: "Cheques regalo" };

export const DIAS_SEMANA_CORTOS = ["L", "M", "X", "J", "V", "S", "D"];

/** % con un decimal; NULL si no hay base. */
export const tasa = (parte: number | null | undefined, total: number | null | undefined): number | null =>
  parte == null || total == null || total <= 0 ? null : Math.round((1000 * parte) / total) / 10;

/** Variación frente al periodo anterior en %, NULL si el anterior es 0 o no hay dato. */
export const variacion = (actual: number | null | undefined, anterior: number | null | undefined): number | null =>
  actual == null || anterior == null || anterior <= 0 ? null : Math.round((1000 * (actual - anterior)) / anterior) / 10;

/** Por debajo de esto, las cifras se enseñan pero se avisa de que la muestra es pequeña. */
export const SESIONES_MINIMAS_FIABLES = 30;

export interface EtapaEmbudo {
  clave: "entrada" | "consulta" | "inicio" | "fin";
  etiqueta: string;
  valor: number;
  /** % sobre la etapa anterior. */
  pasoPct: number | null;
  /** % sobre la entrada. */
  totalPct: number | null;
}

export function etapasEmbudo(e: { entrada: number; consulta: number; inicio: number; fin: number }, operacion: string): EtapaEmbudo[] {
  const etiquetas = operacion === "cheque"
    ? { consulta: "Abren «Regala»", inicio: "Van al pago", fin: "Pagan" }
    : { consulta: "Miran reservas", inicio: "Empiezan el formulario", fin: "Solicitud aceptada" };
  const filas: Array<[EtapaEmbudo["clave"], string, number]> = [
    ["entrada", "Sesiones", e.entrada],
    ["consulta", etiquetas.consulta, e.consulta],
    ["inicio", etiquetas.inicio, e.inicio],
    ["fin", etiquetas.fin, e.fin],
  ];
  return filas.map(([clave, etiqueta, valor], i) => ({
    clave, etiqueta, valor,
    pasoPct: i === 0 ? null : tasa(valor, filas[i - 1][2]),
    totalPct: i === 0 ? null : tasa(valor, e.entrada),
  }));
}
