/**
 * «Pestaña al iniciar sesión» (11/11/2026): qué pestaña se abre al entrar y cuándo se considera «entrar».
 * Misma regla que el menú lateral (menuPanel.ts).
 */
import { describe, it, expect } from "vitest";
import { elegirPestanaInicial, pestanasVisibles, type ContextoMenuPanel } from "@/components/menuPanel";
import { esEntradaAlPanel, ESTADO_INICIO_SESION } from "@/lib/pestanaInicial";

const ver = (...secciones: string[]) => secciones.map((section_key) => ({ section_key, can_view: true }));
const ctx = (over: Partial<ContextoMenuPanel> = {}): ContextoMenuPanel => ({
  permisos: ver("dashboard", "reservas", "facturas"),
  esSuperAdmin: false,
  isEnabled: () => true,
  ...over,
});

describe("elegirPestanaInicial", () => {
  it("con una elección que el usuario ve, la abre", () => {
    expect(elegirPestanaInicial("/reservas", ctx())).toBe("/reservas");
    expect(elegirPestanaInicial("/facturas", ctx())).toBe("/facturas");
  });

  it("sin elección, null (se entra como siempre)", () => {
    expect(elegirPestanaInicial(null, ctx())).toBeNull();
    expect(elegirPestanaInicial(undefined, ctx())).toBeNull();
    expect(elegirPestanaInicial("", ctx())).toBeNull();
  });

  it("con una elección que ya no ve (permiso quitado), null", () => {
    expect(elegirPestanaInicial("/cheques", ctx())).toBeNull();
    expect(elegirPestanaInicial("/reservas", ctx({ permisos: ver("dashboard") }))).toBeNull();
    // «Ver» a false cuenta como sin permiso.
    expect(
      elegirPestanaInicial("/reservas", ctx({ permisos: [{ section_key: "reservas", can_view: false }] })),
    ).toBeNull();
  });

  it("con la sección apagada por el Super Admin, null (como en el menú)", () => {
    expect(elegirPestanaInicial("/reservas", ctx({ isEnabled: (k) => k !== "reservas" }))).toBeNull();
  });

  it("una ruta que no es del menú se ignora", () => {
    expect(elegirPestanaInicial("/super-admin", ctx({ esSuperAdmin: true }))).toBeNull();
    expect(elegirPestanaInicial("/no-existe", ctx())).toBeNull();
  });

  it("Ayuda la ve todo el mundo; Subir albaranes solo con su permiso, también para el super admin", () => {
    expect(elegirPestanaInicial("/ayuda", ctx({ permisos: [] }))).toBe("/ayuda");
    expect(elegirPestanaInicial("/albaranes", ctx({ esSuperAdmin: true, permisos: [] }))).toBeNull();
    expect(elegirPestanaInicial("/albaranes", ctx({ permisos: ver("facturas_albaranes") }))).toBe("/albaranes");
  });

  it("las pestañas permitidas salen en el orden del menú (Gestor Web con cualquiera de sus secciones)", () => {
    expect(pestanasVisibles(ctx({ permisos: ver("facturas", "gestor_carta", "dashboard") })).map((p) => p.url)).toEqual([
      "/dashboard",
      "/gestion-web",
      "/facturas",
      "/ayuda",
    ]);
  });
});

describe("esEntradaAlPanel", () => {
  it("la raíz siempre es entrada", () => {
    expect(esEntradaAlPanel("/", null)).toBe(true);
  });
  it("/dashboard solo si viene del acceso (marcado)", () => {
    expect(esEntradaAlPanel("/dashboard", ESTADO_INICIO_SESION)).toBe(true);
    expect(esEntradaAlPanel("/dashboard", null)).toBe(false);
    expect(esEntradaAlPanel("/dashboard", { otra: 1 })).toBe(false);
  });
  it("navegar a otra sección no es entrada", () => {
    expect(esEntradaAlPanel("/reservas", ESTADO_INICIO_SESION)).toBe(false);
    expect(esEntradaAlPanel("/reservas", null)).toBe(false);
  });
});
