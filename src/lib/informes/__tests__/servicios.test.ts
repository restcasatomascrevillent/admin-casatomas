import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import type { InformeMes } from "@/lib/informeServicios";
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
