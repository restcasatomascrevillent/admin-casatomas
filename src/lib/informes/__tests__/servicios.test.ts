import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import type { InformeMes } from "@/lib/informeServicios";
import type { FilaCostePorUso } from "@/lib/costesServicios";
import type { ServicioContratado } from "@/lib/servicios";
import { INFORMES, puedeVerInforme } from "../registro";
import { tablasInformeServicios } from "../fuentes/servicios";
import type { InformeTabla } from "../tabla";

const fila = (nombre: string, totalEur: number, anteriorEur: number | null, extra: Partial<InformeMes["filas"][number]> = {}): InformeMes["filas"][number] => ({
  proveedor: nombre,
  nombre,
  categoria: "web",
  fijoEur: totalEur,
  usoEur: null,
  manualEur: null,
  manualNota: null,
  totalEur,
  origen: "estimado",
  falta: null,
  monedaDesconocida: false,
  anteriorEur,
  diferenciaEur: anteriorEur == null ? null : totalEur - anteriorEur,
  ...extra,
});

const informe = (cambios: Partial<InformeMes> = {}): InformeMes => ({
  mes: "2026-10-01",
  anterior: "2026-09-01",
  filas: [fila("Vercel", 20, 20), fila("Mapbox", 0, null, { origen: "falta", falta: "sin_coste_uso", totalEur: 0 })],
  totalEur: 20,
  totalAnteriorEur: 20,
  diferenciaEur: 0,
  diferenciaPct: 0,
  manualEur: 0,
  estimadoEur: 20,
  faltan: [fila("Mapbox", 0, null, { origen: "falta", falta: "sin_coste_uso", totalEur: 0 })],
  enCurso: false,
  eurPorUsd: 0.92,
  ...cambios,
});

describe("Super Admin › Informes · servicios y cheques (lote del 10/11/2026)", () => {
  it("los dos informes están en el registro: servicios solo para super admin, cheques con «Editar» en Cheques", () => {
    const servicios = INFORMES.find((i) => i.id === "servicios-mensual");
    const cheques = INFORMES.find((i) => i.id === "cheques-mensual");
    expect(servicios?.seccion).toBe("servicios");
    expect(cheques?.seccion).toBe("cheques");
    expect(cheques?.permiso).toEqual({ tipo: "seccion", seccion: "cheques", nivel: "edit" });
    const editorCheques = { esSuperAdmin: false, permisos: [{ section_key: "cheques", can_view: true, can_edit: true }] };
    const lectorCheques = { esSuperAdmin: false, permisos: [{ section_key: "cheques", can_view: true, can_edit: false }] };
    expect(puedeVerInforme(servicios!, editorCheques)).toBe(false);
    expect(puedeVerInforme(cheques!, editorCheques)).toBe(true);
    // Con solo «Ver» ya no (10/11/2026): como la pestaña Stripe.
    expect(puedeVerInforme(cheques!, lectorCheques)).toBe(false);
    expect(puedeVerInforme(cheques!, { esSuperAdmin: true, permisos: [] })).toBe(true);
    expect(puedeVerInforme(cheques!, { esSuperAdmin: false, permisos: [] })).toBe(false);
  });

  it("el informe de servicios sale como tablas: gasto por servicio con total y lo que falta por meter", () => {
    // `as InformeTabla`: sin strictNullChecks, `if (r.vacio)` no estrecha el tipo (lo comprueba el expect).
    const r = tablasInformeServicios(informe(), "2026-10") as InformeTabla;
    expect(r.vacio).toBe(false);
    expect(r.textoPeriodo.toLowerCase()).toContain("octubre");
    expect(r.nombreArchivo).toContain("2026-10");
    const [gasto, faltan] = r.tablas;
    expect(gasto.filas.map((f) => f.servicio)).toEqual(["Vercel", "Mapbox"]);
    // Lo que falta no cuenta como 0 €: sale «—».
    expect(gasto.filas[1].total).toBeNull();
    expect(gasto.total?.total).toBe(20);
    expect(faltan.titulo).toBe("Falta por meter");
    expect(faltan.filas).toEqual([{ servicio: "Mapbox", motivo: expect.any(String) }]);
  });

  it("sin nada por meter no hay segunda tabla; sin servicios, informe vacío", () => {
    const r = tablasInformeServicios(informe({ faltan: [] }), "2026-10") as InformeTabla;
    expect(r.vacio).toBe(false);
    expect(r.tablas.length).toBe(1);
    expect(tablasInformeServicios(informe({ filas: [] }), "2026-10").vacio).toBe(true);
  });
});

describe("Informe mensual de costes (13/11/2026): IA por función, cuánto cuesta cada cosa y precios por confirmar", () => {
  const ia: FilaCostePorUso[] = [
    { funcion: "ocr-trabajo", queHace: "Lee las facturas", accion: "Leer una factura", unidad: "documento", orden: 25, llamadas: 586, usos: 316, usosConCoste: 316,
      costeUsd: 1.5, filasSinTarifa: 0, modelosSinTarifa: [], medianaUsd: 0.0062, mediaUsd: 0.0047, servidorPropio: false },
    { funcion: "chat-facturas", queHace: null, accion: null, unidad: "pregunta", orden: 30, llamadas: 10, usos: 5, usosConCoste: 0,
      costeUsd: null, filasSinTarifa: 5, modelosSinTarifa: ["gpt-6.1-terra"], medianaUsd: null, mediaUsd: null, servidorPropio: false },
  ];
  const servicio = (p: Partial<ServicioContratado> & Pick<ServicioContratado, "proveedor" | "nombre">): ServicioContratado => ({
    plan: "Free", precio_mensual: 0, moneda: "EUR", ciclo: "gratuito", renovacion: null, cuenta: null, panel_url: null, limites: {}, notas: null,
    actualizado_en: "", categoria: "otros", orden: 1, activo: true, por_confirmar: false, precio_anual: null, fuente_precio: null, ...p,
  });

  it("añade las tablas de la IA y los precios por confirmar, y la portada dice cuánto fue de IA", () => {
    const r = tablasInformeServicios(informe(), "2026-10", {
      ia,
      eurPorUsd: 0.9,
      servicios: [
        servicio({ proveedor: "vercel", nombre: "Vercel" }),
        servicio({ proveedor: "loading", nombre: "Loading", plan: "Por confirmar", ciclo: "anual", precio_mensual: null, por_confirmar: true, panel_url: "https://www.loading.es/clientes" }),
        servicio({ proveedor: "quitado", nombre: "Quitado", por_confirmar: true, activo: false }),
      ],
    }) as InformeTabla;
    expect(r.titulo).toBe("Informe mensual de costes");
    expect(r.tablas.map((x) => x.titulo)).toEqual(["Gasto por servicio", "IA, función por función", "Cuánto cuesta cada cosa", "Falta por meter", "Precios por confirmar"]);
    expect(r.descripcion.replace(/\u00a0/g, " ")).toContain("De ello, inteligencia artificial: unos 1,35 €.");
    expect(r.descripcion).toContain("Precios por confirmar: 1.");
    const [, iaTabla, cosas, , porConfirmar] = r.tablas;
    expect(iaTabla.filas[0]).toEqual({ que: "Lee las facturas", llamadas: 586, coste: 1.35, uso: "0,6 céntimos por documento" });
    // Sin coste conocido: «—», nunca 0.
    expect(iaTabla.filas[1]).toEqual({ que: "chat-facturas", llamadas: 10, coste: null, uso: null });
    expect(iaTabla.nota).toContain("5 llamadas de gpt-6.1-terra sin tarifa");
    expect(cosas.filas[0]).toEqual({ accion: "Leer una factura", coste: "≈ 0,6 céntimos", detalle: "mediana de 316 documentos de octubre de 2026" });
    expect(cosas.filas.map((f) => f.accion)).toEqual(["Leer una factura", "Leer la etiqueta de un vino", "Traducir un plato", "Recortar una foto"]);
    expect(porConfirmar.filas).toEqual([{ servicio: "Loading", plan: "Por confirmar", precio: "Sin precio", donde: "https://www.loading.es/clientes" }]);
  });

  it("sin datos de IA (o sin la migración), el informe sale igual, sin sus tablas", () => {
    const r = tablasInformeServicios(informe({ faltan: [] }), "2026-10", { ia: null }) as InformeTabla;
    expect(r.tablas.map((x) => x.titulo)).toEqual(["Gasto por servicio"]);
    expect((tablasInformeServicios(informe({ faltan: [] }), "2026-10", { ia: [] }) as InformeTabla).tablas.length).toBe(1);
  });
});
