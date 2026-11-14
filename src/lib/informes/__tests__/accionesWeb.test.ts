import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { INFORMES, puedeVerInforme } from "../registro";
import { tablasInformeAccionesWeb, textoCambio, type DatosAccionesWeb } from "../fuentes/accionesWeb";
import type { InformeTabla } from "../tabla";

const datos: DatosAccionesWeb = {
  mes: "2026-10",
  entorno: "produccion",
  sesiones: 200,
  sesiones_anterior: 100,
  datos_desde: null,
  acciones: [
    { id: "ver_carta", n: 300, sesiones: 150, n_anterior: 120, sesiones_anterior: 60 },
    { id: "pulsar_reservar", n: 50, sesiones: 40, n_anterior: 20, sesiones_anterior: 20 },
    { id: "llamar", n: 0, sesiones: 0, n_anterior: 0, sesiones_anterior: 0 },
    { id: "desconocida", n: 9, sesiones: 9, n_anterior: 0, sesiones_anterior: 0 },
  ],
};

describe("informe mensual de acciones web", () => {
  it("está en el registro, solo super admin y por mes", () => {
    const def = INFORMES.find((i) => i.id === "acciones-web-mensual")!;
    expect(def.periodo).toBe("mes");
    expect(puedeVerInforme(def, { esSuperAdmin: false, permisos: [] })).toBe(false);
  });
  it("ordena por visitas, calcula % y avisa de las cookies", () => {
    const r = tablasInformeAccionesWeb(datos, "2026-10") as InformeTabla;
    const f = r.tablas[0].filas;
    expect(f).toHaveLength(2);
    expect(f[0]).toMatchObject({ puesto: "1º", veces: 300, pct: 75, pct_ant: 60, cambio: "Sube 15,0 puntos" });
    expect(f[1]).toMatchObject({ pct: 20, pct_ant: 20, cambio: "Igual" });
    expect(r.descripcion).toMatch(/cookies/);
    expect(r.tablas[0].nota).toMatch(/aceptó las cookies/);
  });
  it("vacío sin visitas", () => {
    expect(tablasInformeAccionesWeb({ ...datos, sesiones: 0, acciones: [] }, "2026-10").vacio).toBe(true);
  });
  it("textoCambio", () => {
    expect(textoCambio(5, 0)).toBe("Nuevo este mes");
    expect(textoCambio(5, null)).toBe("—");
  });
});
