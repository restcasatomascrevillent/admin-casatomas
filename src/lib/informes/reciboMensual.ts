// ============================================================================
//  Super Admin › Informes › «Recibo mensual (Gestor Gasto)» — qué recibo sale
// ----------------------------------------------------------------------------
//  25/11/2026, petición del dueño: «una tarea programada cada mes el último
//  jueves del mes que me saque los informes del apartado de informes en PDF,
//  me saque el recibo mensual de gestor de gasto». El recibo es un informe más
//  de la página (así la tarea programada los saca todos igual), con el MISMO
//  PDF que Gestor Gasto (`components/facturacion/pdf.ts`). Para el mes elegido:
//    1. el recibo de pago mensual EMITIDO de ese mes (el más reciente), tal cual;
//    2. si no, el BORRADOR guardado de ese mes (el PDF sale «BORRADOR · SIN EMITIR»);
//    3. si no, cómo quedaría uno nuevo: lo mismo que pone «Nuevo pago mensual»
//       (número siguiente, cliente, cuota fija y los gastos de Servicios del mes),
//       también marcado como borrador.
//  No guarda ni emite nada: emitir sigue siendo cosa de Gestor Gasto.
// ============================================================================
import type { DatosFacturacion, FacturaGuardada } from "@/hooks/useFacturacionOficiososia";
import { aplicarGastosServicios, cambiarMes, prepararNuevaFactura, type GastoServicio } from "@/components/facturacion/catalogo";
import { nuevaFactura, tipoDeRecibo, type Factura } from "@/components/facturacion/modelo";

export type OrigenRecibo = "emitido" | "borrador" | "nuevo";

export interface ReciboDelMes {
  documento: Factura;
  /** Sin emitir: el PDF sale marcado «BORRADOR · SIN EMITIR». */
  borrador: boolean;
  origen: OrigenRecibo;
}

/** El pago mensual de ese mes más reciente de la lista (por fecha y, a igual fecha, por última edición). */
function delMes(lista: FacturaGuardada[], mes: string): FacturaGuardada | null {
  return (
    lista
      .filter((g) => tipoDeRecibo(g.documento) === "mensual" && g.documento.mes === mes)
      .sort((a, b) => b.documento.fecha.localeCompare(a.documento.fecha) || b.actualizado_en.localeCompare(a.actualizado_en))[0] ?? null
  );
}

/**
 * El recibo del pago mensual de `mes` («AAAA-MM») para el informe. `gastos`: los de Servicios ›
 * Costes de ese mes (null si no se pueden leer: el recibo nuevo sale solo con la cuota).
 */
export function reciboMensualDelMes(datos: DatosFacturacion, mes: string, gastos: GastoServicio[] | null, hoy = new Date()): ReciboDelMes {
  const emitido = delMes(datos.facturas, mes);
  if (emitido) return { documento: emitido.documento, borrador: false, origen: "emitido" };
  const guardado = delMes(datos.borradores ?? [], mes);
  if (guardado) return { documento: guardado.documento, borrador: true, origen: "borrador" };
  const base = datos.config?.documento ?? nuevaFactura();
  let f = prepararNuevaFactura(base, [...datos.facturas, ...(datos.borradores ?? [])], "mensual", hoy);
  f = cambiarMes(f, mes);
  if (gastos?.length) f = aplicarGastosServicios(f, gastos);
  return { documento: f, borrador: true, origen: "nuevo" };
}

/** «Recibo-R-2026-004.pdf» (el mismo nombre que en Gestor Gasto) o «Recibo-mensual-2026-11-borrador.pdf». */
export function nombreArchivoRecibo(r: ReciboDelMes, mes: string): string {
  if (!r.borrador && r.documento.numero.trim()) return `Recibo-${r.documento.numero.trim().replace(/[^a-zA-Z0-9_-]/g, "-")}.pdf`;
  return `Recibo-mensual-${mes}-borrador.pdf`;
}
