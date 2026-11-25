import { describe, expect, it } from "vitest";
import { nuevaFactura, totalesRecibo, type Factura } from "@/components/facturacion/modelo";
import { ID_CUOTA_MENSUAL } from "@/components/facturacion/catalogo";
import type { DatosFacturacion, FacturaGuardada } from "@/hooks/useFacturacionOficiososia";
import { nombreArchivoRecibo, reciboMensualDelMes } from "../reciboMensual";
import { INFORMES } from "../registro";

const config = (): Factura => ({
  ...nuevaFactura(),
  cliente: { nombre: "Casa Tomás", nif: "", direccion: "", email: "" },
  catalogo: { productos: [], paquetes: [], cuotaMensual: 100 },
  pago: "Transferencia",
});

let n = 0;
const guardada = (doc: Partial<Factura>, actualizado = "2026-11-01T10:00:00Z"): FacturaGuardada => ({
  id: `f${++n}`,
  numero: doc.numero ?? "",
  documento: { ...config(), ...doc },
  creado_en: actualizado,
  actualizado_en: actualizado,
});

const datos = (o: Partial<DatosFacturacion> = {}): DatosFacturacion => ({
  config: { documento: config(), actualizado_en: "2026-11-01T00:00:00Z" },
  facturas: [],
  borradores: [],
  ...o,
});

const GASTOS = [
  { proveedor: "openai", nombre: "OpenAI", categoria: "IA", importe: 12.5, origen: "manual" as const },
  { proveedor: "vercel", nombre: "Vercel", categoria: "Hosting", importe: 0, origen: "falta" as const },
];

describe("informe «Recibo mensual (Gestor Gasto)»", () => {
  it("está en el registro, solo para super admins y por meses", () => {
    const def = INFORMES.find((i) => i.id === "gestor-gasto-recibo-mensual");
    expect(def).toMatchObject({ seccion: "gestor-gasto", permiso: { tipo: "superadmin" }, periodo: "mes", formatos: ["pdf"] });
  });

  it("usa el recibo EMITIDO de ese mes (el más reciente) aunque haya borradores", () => {
    const viejo = guardada({ numero: "R-2026-003", tipo: "mensual", mes: "2026-11", fecha: "2026-11-02" });
    const nuevo = guardada({ numero: "R-2026-004", tipo: "mensual", mes: "2026-11", fecha: "2026-11-20" });
    const otroMes = guardada({ numero: "R-2026-005", tipo: "mensual", mes: "2026-10", fecha: "2026-11-25" });
    const licencia = guardada({ numero: "R-2026-006", tipo: "licencia", fecha: "2026-11-26" });
    const r = reciboMensualDelMes(datos({ facturas: [viejo, nuevo, otroMes, licencia], borradores: [{ ...guardada({ tipo: "mensual", mes: "2026-11" }), factura_id: null }] }), "2026-11", GASTOS);
    expect(r).toMatchObject({ origen: "emitido", borrador: false });
    expect(r.documento.numero).toBe("R-2026-004");
    expect(nombreArchivoRecibo(r, "2026-11")).toBe("Recibo-R-2026-004.pdf");
  });

  it("sin emitido, el borrador guardado de ese mes (marcado como borrador)", () => {
    const b = { ...guardada({ numero: "R-2026-007", tipo: "mensual", mes: "2026-11" }), factura_id: null };
    const r = reciboMensualDelMes(datos({ borradores: [b] }), "2026-11", GASTOS);
    expect(r).toMatchObject({ origen: "borrador", borrador: true });
    expect(r.documento.numero).toBe("R-2026-007");
    expect(nombreArchivoRecibo(r, "2026-11")).toBe("Recibo-mensual-2026-11-borrador.pdf");
  });

  it("sin nada guardado, uno nuevo como «Nuevo pago mensual»: número siguiente, cuota y gastos con importe", () => {
    const emitidoAntes = guardada({ numero: `R-${new Date().getFullYear()}-002`, tipo: "mensual", mes: "2026-09" });
    const r = reciboMensualDelMes(datos({ facturas: [emitidoAntes] }), "2026-10", GASTOS);
    expect(r).toMatchObject({ origen: "nuevo", borrador: true });
    const f = r.documento;
    expect(f.tipo).toBe("mensual");
    expect(f.mes).toBe("2026-10");
    expect(f.numero).toBe(`R-${new Date().getFullYear()}-003`);
    expect(f.cliente.nombre).toBe("Casa Tomás");
    const cuota = f.lineas.find((l) => l.productoId === ID_CUOTA_MENSUAL);
    expect(cuota).toMatchObject({ precio: 100, concepto: "Cuota mensual · octubre de 2026" });
    // Solo los gastos con importe (Vercel «falta» no entra, como en Gestor Gasto).
    expect(f.lineas.filter((l) => l.proveedor).map((l) => l.proveedor)).toEqual(["openai"]);
    expect(totalesRecibo(f).total).toBe(112.5);
  });

  it("sin gastos de Servicios (no se pueden leer) sale solo con la cuota; sin configuración, también", () => {
    const r = reciboMensualDelMes(datos(), "2026-11", null);
    expect(r.documento.lineas.map((l) => l.productoId)).toEqual([ID_CUOTA_MENSUAL]);
    const sinConfig = reciboMensualDelMes({ config: null, facturas: [] }, "2026-11", GASTOS);
    expect(sinConfig.origen).toBe("nuevo");
    expect(sinConfig.documento.mes).toBe("2026-11");
  });
});
