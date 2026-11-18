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
    // 18/11/2026: la misma lista que `public.seccion_aviso` (20261212100000).
    expect(seccionDeAviso(n("8", "sistema"))).toBe("super_admin");
    expect(seccionDeAviso(n("9", "email_fallido", { referencia_tipo: "reserva" }))).toBe("reservas");
    expect(seccionDeAviso(n("10", "propuesta_fallida", { referencia_tipo: "solicitud" }))).toBe("reservas");
    expect(seccionDeAviso(n("11", "mesa_borrada_con_asignaciones"))).toBe("reservas");
    expect(seccionDeAviso(n("12", "facturas_margen_bajo", { referencia_tipo: "facturas_alerta" }))).toBe("facturas");
    expect(seccionDeAviso(n("13", "instagram_story_tapas", { referencia_tipo: "instagram_story_tapas" }))).toBe("rrss");
    expect(seccionDeAviso(n("14", "peticion_urgente", { referencia_tipo: "peticion" }))).toBe("super_admin");
    expect(seccionDeAviso(n("15", "tipo_que_aun_no_existe"))).toBe("super_admin");
  });

  it("sin permiso de una sección no ve sus avisos; lo que no es de ninguna, solo el super admin", () => {
    expect(puedeVerAviso(n("1", "reserva_nueva"), { ...NADA, reservas: true })).toBe(true);
    expect(puedeVerAviso(n("1", "reserva_nueva"), { ...NADA, facturas: true })).toBe(false);
    expect(puedeVerAviso(n("2", "facturas_precio_sube"), { ...NADA, reservas: true })).toBe(false);
    expect(puedeVerAviso(n("3", "ia_modelo_retirado"), { ...TODO, superAdmin: false })).toBe(false);
    expect(puedeVerAviso(n("4", "sistema"), NADA)).toBe(false);
    expect(puedeVerAviso(n("4", "sistema"), { ...NADA, superAdmin: true })).toBe(true);
  });

  it("el camarero (Reservas, sin Facturas) solo ve los de Reservas", () => {
    const camarero: PermisosAvisos = { ...NADA, reservas: true };
    const lista = [
      n("reserva", "reserva_nueva"),
      n("email", "email_fallido"),
      n("albaran", "facturas_albaran_sin_factura", { referencia_tipo: "facturas_alerta" }),
      n("margen", "facturas_margen_bajo", { referencia_tipo: "facturas_alerta" }),
      n("subida", "subida_precio"),
      n("story", "instagram_story_tapas"),
      n("sistema", "sistema"),
    ];
    expect(avisosParaDashboard(lista, camarero, AHORA).map((a) => a.id).sort()).toEqual(["email", "reserva"]);
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
