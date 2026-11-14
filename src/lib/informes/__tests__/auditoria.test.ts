import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { INFORMES, puedeVerInforme } from "../registro";
import { barra, fraseDelicada, tablasInformeAuditoria, type DatosAuditoria } from "../fuentes/auditoria";
import type { InformeTabla } from "../tabla";

const datos: DatosAuditoria = {
  usuarios: [
    { quien: "ana@casa.es", acciones: 30, dias: 4, ultima: "2026-10-20T16:30:00Z", borrados: 1, precios: 1, secciones: [{ tabla: "facturas", n: 20 }, { tabla: "Vinos", n: 10 }] },
    { quien: "luis@casa.es", acciones: 5, dias: 1, ultima: "2026-10-02T09:00:00Z", borrados: 0, precios: 0, secciones: [] },
  ],
  por_dia: [{ dia: "2026-10-20", n: 30 }, { dia: "2026-10-02", n: 5 }],
  por_hora: [{ hora: 9, n: 5 }, { hora: 18, n: 30 }],
  delicadas_total: 2,
  delicadas: [
    { created_at: "2026-10-20T16:30:00Z", actor_label: "ana@casa.es", accion: "actualizar", tabla: "Vinos", tipo_evento: "cambiar_precio", det: { antes: { nombre: "Ribera", precio_eur: "20" }, despues: { nombre: "Ribera", precio_eur: "22.5" } } },
    { created_at: "2026-10-19T10:00:00Z", actor_label: "ana@casa.es", accion: "eliminar", tabla: "reservas", tipo_evento: "eliminar", det: {} },
  ],
  sistema: [{ actor_label: "Base de datos · postgres", tabla: "productos_factura", accion: "actualizar", n: 100 }],
  sistema_total: 100,
  accesos_fallidos: 0,
};

describe("informe mensual de auditoría", () => {
  it("está en el registro, solo para super admin y por mes", () => {
    const def = INFORMES.find((i) => i.id === "auditoria-mensual")!;
    expect(def.periodo).toBe("mes");
    expect(puedeVerInforme(def, { esSuperAdmin: false, permisos: [{ section_key: "usuarios", can_view: true, can_edit: true }] })).toBe(false);
    expect(puedeVerInforme(def, { esSuperAdmin: true, permisos: [] })).toBe(true);
  });

  it("genera ranking, gráficos, delicadas y sistema aparte", () => {
    const r = tablasInformeAuditoria(datos, "2026-10") as InformeTabla;
    expect(r.vacio).toBe(false);
    expect(r.tablas.map((t) => t.titulo)).toEqual([
      "Quién usa más el panel", "Gráfico por días", "Gráfico por horas", "Acciones delicadas: resumen", "Acciones delicadas: una por una", "Lo que hace el sistema solo",
    ]);
    expect(r.tablas[0].filas[0]).toMatchObject({ puesto: "1º", quien: "ana@casa.es", acciones: 30, dias: 4 });
    expect(r.tablas[0].filas[0].donde).toContain("Facturas de proveedores (20)");
    expect(r.tablas[1].filas).toHaveLength(31);
    expect(r.tablas[2].filas.map((f) => f.hora)).toEqual(["09:00", "18:00"]);
    expect(String(r.tablas[4].filas[0].que).replace(/\s/g, " ")).toBe("Cambió el precio de «Ribera»: de 20,00 € a 22,50 €");
    expect(r.tablas[5].filas[0].quien).toBe("La base de datos (automático)");
  });

  it("vacío si no hay nada y barra mínima de un bloque", () => {
    expect(tablasInformeAuditoria({ ...datos, usuarios: [], sistema_total: 0, delicadas_total: 0 }, "2026-10").vacio).toBe(true);
    expect(barra(1, 1000)).toBe("█");
    expect(barra(0, 10)).toBe("");
    expect(fraseDelicada(datos.delicadas[1])).toBe("Borró reservas");
  });
});
