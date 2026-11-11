/**
 * Sección que se abre al iniciar sesión (11/11/2026, petición del dueño: «Que en Usuarios se pueda
 * poner qué pestaña se le va a abrir por defecto cuando inician sesión»): a dónde se va al entrar.
 */
import { describe, expect, it } from "vitest";
import { esEntradaAlPanel, ESTADO_TRAS_LOGIN, opcionesInicio, rutaDeInicio } from "@/lib/seccionInicio";

const ver = (...secciones: string[]) => secciones.map((section_key) => ({ section_key, can_view: true, can_edit: false }));

describe("rutaDeInicio", () => {
  it("abre la sección elegida si puede verla", () => {
    expect(rutaDeInicio("reservas", ver("dashboard", "reservas"))).toBe("/reservas");
    expect(rutaDeInicio("facturas", ver("facturas_subida"))).toBe("/facturas");
    expect(rutaDeInicio("gestion_web", ver("gestor_carta"))).toBe("/gestion-web");
  });

  it("sin permiso para verla, lo de siempre (null)", () => {
    expect(rutaDeInicio("reservas", ver("dashboard"))).toBeNull();
    expect(rutaDeInicio("reservas", [{ section_key: "reservas", can_view: false }])).toBeNull();
  });

  it("sin elegir o con una clave que ya no existe, lo de siempre", () => {
    expect(rutaDeInicio(null, ver("reservas"))).toBeNull();
    expect(rutaDeInicio(undefined, ver("reservas"))).toBeNull();
    expect(rutaDeInicio("trabajadores", ver("reservas"))).toBeNull();
  });

  it("el super admin ve todo menos lo que es solo con permiso; Ayuda, todo el mundo", () => {
    expect(rutaDeInicio("cheques", [], true)).toBe("/cheques");
    expect(rutaDeInicio("albaranes", [], true)).toBeNull();
    expect(rutaDeInicio("ayuda", [])).toBe("/ayuda");
  });
});

describe("opcionesInicio", () => {
  it("son las entradas del menú que ve, en su orden", () => {
    expect(opcionesInicio(ver("facturas", "reservas")).map((o) => o.clave)).toEqual(["reservas", "facturas", "ayuda"]);
  });
});

describe("esEntradaAlPanel", () => {
  it("«/» y /dashboard tras iniciar sesión; el Dashboard del menú, no", () => {
    expect(esEntradaAlPanel("/", null)).toBe(true);
    expect(esEntradaAlPanel("/dashboard", ESTADO_TRAS_LOGIN)).toBe(true);
    expect(esEntradaAlPanel("/dashboard", null)).toBe(false);
    expect(esEntradaAlPanel("/reservas", ESTADO_TRAS_LOGIN)).toBe(false);
  });
});
