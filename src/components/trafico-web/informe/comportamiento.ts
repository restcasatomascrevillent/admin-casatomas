/**
 * Apartado «Qué hacen los visitantes» del informe mensual (Generar informe).
 * Lógica pura sobre la RPC web_comportamiento (las mismas cifras y
 * definiciones que Tráfico web › Comportamiento y Super Admin › Logs).
 * Si el mes no tiene sesiones con consentimiento, no hay apartado.
 */
import type { Comportamiento } from "@/hooks/useLogsWeb";
import { etapasEmbudo, NOMBRE_CONTACTO, NOMBRE_CONTENIDO, SESIONES_MINIMAS_FIABLES, tasa, type EtapaEmbudo } from "../comportamiento/definiciones";
import { fmtCuota, fmtEntero } from "./formatoInforme";

export interface ApartadoComportamiento {
  titular: string;
  sesiones: number;
  visitantes: number;
  /** % de las páginas vistas de Vercel que tienen consentimiento (orientativo). */
  cobertura: number | null;
  conversion: number | null;
  conversiones: number;
  tiempoMediana: number | null;
  embudoReservas: EtapaEmbudo[];
  abandonoReservas: number;
  contenidos: Array<{ grupo: string; nombre: string; n: number }>;
  contactos: Array<{ nombre: string; n: number }>;
  /** NULL = sin errores en las sesiones del mes: no se pinta la segunda diapositiva. */
  problemas: { titular: string; sesionesConError: number; pctSesiones: number | null; paginas: Array<{ ruta: string; n: number; sesiones: number }>; embudoCheques: EtapaEmbudo[] } | null;
  notas: string[];
}

export function construirApartadoComportamiento(c: Comportamiento | null | undefined, visitasMes: number | null, nombreMes: string): ApartadoComportamiento | null {
  if (!c || c.resumen.sesiones === 0) return null;
  const r = c.resumen;
  const reserva = c.embudos.find((e) => e.operacion === "reserva");
  const cheque = c.embudos.find((e) => e.operacion === "cheque");
  const embudoReservas = reserva ? etapasEmbudo(reserva, "reserva") : [];
  const abandonoReservas = reserva ? Math.max(reserva.inicio - reserva.fin, 0) : 0;

  let titular: string;
  if (reserva && reserva.inicio > 0) {
    titular = `En ${nombreMes}, ${fmtEntero(reserva.fin)} de ${fmtEntero(reserva.inicio)} visitantes que empezaron una reserva la enviaron`;
  } else if (r.conversiones > 0) {
    titular = `En ${nombreMes}, ${fmtEntero(r.sesiones_con_conversion)} de ${fmtEntero(r.sesiones)} sesiones observadas terminaron una reserva o un cheque`;
  } else {
    titular = `En ${nombreMes} se observaron ${fmtEntero(r.sesiones)} sesiones; ninguna completó una reserva ni un cheque`;
  }

  const contenidos = (["plato_abierto", "vino_abierto", "carta_categoria"] as const).flatMap((tipo) =>
    c.contenidos.filter((x) => x.tipo === tipo).slice(0, 2).map((x) => ({ grupo: NOMBRE_CONTENIDO[tipo], nombre: x.objetivo, n: x.n })),
  );

  const errores = c.errores_por_ruta.slice(0, 4).map((e) => ({ ruta: e.ruta, n: e.n, sesiones: e.sesiones }));
  const problemas = r.sesiones_con_error > 0 || (cheque && cheque.inicio > 0)
    ? {
        titular: r.sesiones_con_error > 0
          ? `${fmtEntero(r.sesiones_con_error)} ${r.sesiones_con_error === 1 ? "sesión encontró" : "sesiones encontraron"} algún error (${fmtCuota(tasa(r.sesiones_con_error, r.sesiones) ?? 0)})`
          : "Cheques regalo: del interés al pago",
        sesionesConError: r.sesiones_con_error,
        pctSesiones: tasa(r.sesiones_con_error, r.sesiones),
        paginas: errores,
        embudoCheques: cheque ? etapasEmbudo(cheque, "cheque") : [],
      }
    : null;

  const notas = [
    "Sesiones = visitantes que aceptaron «Estadísticas»; es una parte de las visitas de Vercel. Visitantes = navegadores, no personas.",
    "Conversión = operación completada y confirmada por el servidor; el abandono es estimado (pudo terminarla por teléfono u otro día).",
  ];
  if (r.sesiones < SESIONES_MINIMAS_FIABLES) notas.unshift(`Muestra pequeña (${r.sesiones} sesiones): orientativo.`);

  return {
    titular,
    sesiones: r.sesiones,
    visitantes: r.visitantes_estimados,
    cobertura: tasa(r.paginas_vistas, visitasMes),
    conversion: tasa(r.sesiones_con_conversion, r.sesiones),
    conversiones: r.conversiones,
    tiempoMediana: r.tiempo_activo_mediana_s,
    embudoReservas,
    abandonoReservas,
    contenidos,
    contactos: c.contactos.slice(0, 4).map((x) => ({ nombre: NOMBRE_CONTACTO[x.accion] ?? x.accion, n: x.n })),
    problemas,
    notas,
  };
}
