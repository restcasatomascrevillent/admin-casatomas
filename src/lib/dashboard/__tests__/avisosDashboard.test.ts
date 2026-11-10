import { describe, expect, it } from "vitest";
import type { NotificacionDashboard } from "@/hooks/useNotificacionesDashboard";
import { avisosParaDashboard, puedeVerAviso, seccionDeAviso, sinLeerPorSeccion, type PermisosAvisos } from "@/lib/dashboard/avisosDashboard";

const n = (id: string, tipo: string, extra: Partial<NotificacionDashboard> = {}): NotificacionDashboard => ({
  id,
  tipo,
  titulo: id,
  mensaje: null,
  referencia_id: null,
  referencia_tipo: null,
  leida: false,
  created_at: "2026-11-10T08:00:00Z",
  ...extra,
});

const TODO: PermisosAvisos = { reservas: true, facturas: true, rrss: true, superAdmin: true };
const NADA: PermisosAvisos = { reservas: false, facturas: false, rrss: false, superAdmin: false };
const AHORA = Date.parse("2026-11-10T12:00:00Z");

describe("Dashboard › Avisos: cada aviso solo a quien ve su sección", () => {
  it("sección de cada aviso", () => {
    expect(seccionDeAviso(n("1", "solicitud_pendiente"))).toBe("reservas");
    expect(seccionDeAviso(n("2", "reserva_sin_asignar"))).toBe("reservas");
    expect(seccionDeAviso(n("3", "facturas_precio_mejor", { referencia_tipo: "facturas_alerta" }))).toBe("facturas");
    expect(seccionDeAviso(n("4", "subida_precio"))).toBe("facturas");
    expect(seccionDeAviso(n("5", "original_sin_drive", { referencia_tipo: "facturas_original" }))).toBe("facturas");
    expect(seccionDeAviso(n("6", "instagram_encargo", { referencia_tipo: "instagram_encargo" }))).toBe("rrss");
    expect(seccionDeAviso(n("7", "ia_modelo_nuevo", { referencia_tipo: "ia_modelos" }))).toBe("super_admin");
    expect(seccionDeAviso(n("8", "sistema"))).toBe("general");
  });

  it("sin permiso de una sección no ve sus avisos; los generales los ve cualquiera", () => {
    expect(puedeVerAviso(n("1", "reserva_nueva"), { ...NADA, reservas: true })).toBe(true);
    expect(puedeVerAviso(n("1", "reserva_nueva"), { ...NADA, facturas: true })).toBe(false);
    expect(puedeVerAviso(n("2", "facturas_precio_sube"), { ...NADA, reservas: true })).toBe(false);
    expect(puedeVerAviso(n("3", "ia_modelo_retirado"), { ...TODO, superAdmin: false })).toBe(false);
    expect(puedeVerAviso(n("4", "sistema"), NADA)).toBe(true);
  });

  it("fuera caducados y los que no van a la campana; sin leer primero y, dentro, del más nuevo al más viejo", () => {
    const lista = [
      n("leida-nueva", "reserva_nueva", { leida: true, created_at: "2026-11-10T11:00:00Z" }),
      n("vieja", "reserva_nueva", { created_at: "2026-11-09T08:00:00Z" }),
      n("nueva", "facturas_precio_sube", { created_at: "2026-11-10T10:00:00Z" }),
      n("caducada", "facturas_precio_mejor", { caduca_en: "2026-11-10T09:00:00Z" }),
      n("pequena", "facturas_precio_sube", { datos: { campana: false } }),
      n("sin-permiso", "instagram_encargo"),
    ];
    const ids = avisosParaDashboard(lista, { ...TODO, rrss: false }, AHORA).map((a) => a.id);
    expect(ids).toEqual(["nueva", "vieja", "leida-nueva"]);
  });

  it("sin leer por sección, en el orden del menú", () => {
    const lista = [n("1", "facturas_precio_sube"), n("2", "reserva_nueva"), n("3", "facturas_revision"), n("4", "reserva_nueva", { leida: true })];
    expect(sinLeerPorSeccion(lista)).toEqual([
      { seccion: "reservas", n: 1 },
      { seccion: "facturas", n: 2 },
    ]);
  });
});
