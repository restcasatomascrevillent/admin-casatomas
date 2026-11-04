import { describe, expect, it } from "vitest";
import { emailVisible, etiquetaRol, fechaHoraLegible, iniciales, nombreVisible } from "@/lib/usuario-actual";
import { reglasContrasena } from "@/lib/contrasena";

const usuario = (email: string | undefined, display_name?: unknown) => ({ id: "12345678-aaaa", email, user_metadata: display_name === undefined ? {} : { display_name } });

describe("usuario conectado", () => {
  it("nombre: el guardado, si no el email, y de @staff.local solo el usuario", () => {
    expect(nombreVisible(usuario("laura@casatomas.test", "  Laura Gómez "))).toBe("Laura Gómez");
    expect(nombreVisible(usuario("laura@casatomas.test", ""))).toBe("laura@casatomas.test");
    expect(nombreVisible(usuario("laura@casatomas.test", 42))).toBe("laura@casatomas.test");
    expect(nombreVisible(usuario("camarero1@staff.local"))).toBe("camarero1");
    expect(nombreVisible(usuario(undefined))).toBe("12345678…");
    expect(nombreVisible(null)).toBe("");
    expect(emailVisible(usuario("camarero1@staff.local"))).toBeNull();
    expect(emailVisible(usuario("laura@casatomas.test"))).toBe("laura@casatomas.test");
  });

  it.each([
    ["Laura Gómez", "LG"],
    ["laura gómez pérez", "LG"],
    ["Álvaro", "ÁL"],
    ["camarero1", "CA"],
    ["marta.lopez@casatomas.test", "ML"],
    ["pepe@staff.local", "PE"],
    ["  ", "?"],
    ["#!", "?"],
  ])("iniciales de «%s» → %s", (nombre, esperado) => {
    expect(iniciales(nombre)).toBe(esperado);
  });

  it("rol con los nombres del panel", () => {
    expect(etiquetaRol({ esSuperAdmin: true, rol: "staff" })).toBe("Super Admin");
    expect(etiquetaRol({ esSuperAdmin: false, rol: "admin" })).toBe("Admin");
    expect(etiquetaRol({ esSuperAdmin: false, rol: "manager" })).toBe("Manager");
    expect(etiquetaRol({ esSuperAdmin: false, rol: "staff" })).toBe("Staff");
    expect(etiquetaRol({ esSuperAdmin: false, rol: null })).toBe("Sin rol");
  });

  it("fechas legibles o nada", () => {
    expect(fechaHoraLegible("2026-01-15T09:30:00Z")).toMatch(/2026/);
    expect(fechaHoraLegible("no es fecha")).toBeNull();
    expect(fechaHoraLegible(undefined)).toBeNull();
  });
});

describe("reglas de la nueva contraseña", () => {
  const cumple = (actual: string, nueva: string, repetir = nueva) =>
    Object.fromEntries(reglasContrasena({ actual, nueva, repetir }).map((r) => [r.id, r.cumple]));

  it("mínimo 10, máximo 72 bytes, distinta de la actual y repetida igual", () => {
    expect(cumple("vieja-1234", "nueva-12345!")).toEqual({ longitud: true, distinta: true, coincide: true, variedad: true });
    expect(cumple("vieja-1234", "corta")).toMatchObject({ longitud: false });
    expect(cumple("vieja-1234", "x".repeat(72))).toMatchObject({ longitud: true });
    expect(cumple("vieja-1234", "ñ".repeat(37))).toMatchObject({ longitud: false }); // 74 bytes
    expect(cumple("vieja-1234", "vieja-1234")).toMatchObject({ distinta: false });
    expect(cumple("vieja-1234", "nueva-12345", "otra-12345")).toMatchObject({ coincide: false });
    expect(cumple("vieja-1234", "", "")).toMatchObject({ distinta: false, coincide: false });
  });

  it("la variedad es solo un consejo", () => {
    const variedad = reglasContrasena({ actual: "", nueva: "solo-letras", repetir: "" }).find((r) => r.id === "variedad")!;
    expect(variedad).toMatchObject({ cumple: false, obligatoria: false });
    expect(reglasContrasena({ actual: "", nueva: "", repetir: "" }).filter((r) => r.obligatoria).map((r) => r.id)).toEqual(["longitud", "distinta", "coincide"]);
  });
});
