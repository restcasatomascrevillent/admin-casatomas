/**
 * Tests para src/config/permissions.ts
 *
 * Esta es la capa más pura del proyecto: funciones sin dependencias externas.
 * Cobertura objetivo: 100 %
 */
import { describe, it, expect } from "vitest";
import { isSuperAdmin, SUPER_ADMIN_EMAILS } from "@/config/permissions";

describe("isSuperAdmin", () => {
  it("devuelve true para cada email de super admin registrado", () => {
    for (const email of SUPER_ADMIN_EMAILS) {
      expect(isSuperAdmin(email)).toBe(true);
    }
  });

  it("es case-insensitive: acepta emails en mayúsculas", () => {
    expect(isSuperAdmin("MIGUELSANTIAGORES@GMAIL.COM")).toBe(true);
    expect(isSuperAdmin("INFO@CASATOMAS.ES")).toBe(true);
  });

  it("devuelve false para un email desconocido", () => {
    expect(isSuperAdmin("otro@ejemplo.com")).toBe(false);
  });

  it("devuelve false cuando el email es undefined", () => {
    expect(isSuperAdmin(undefined)).toBe(false);
  });

  it("devuelve false cuando el email es null", () => {
    expect(isSuperAdmin(null)).toBe(false);
  });

  it("devuelve false para cadena vacía", () => {
    expect(isSuperAdmin("")).toBe(false);
  });
});

describe("SUPER_ADMIN_EMAILS", () => {
  it("es un array no vacío", () => {
    expect(Array.isArray(SUPER_ADMIN_EMAILS)).toBe(true);
    expect(SUPER_ADMIN_EMAILS.length).toBeGreaterThan(0);
  });

  it("todos los emails son strings válidos", () => {
    for (const email of SUPER_ADMIN_EMAILS) {
      expect(typeof email).toBe("string");
      expect(email).toMatch(/@/);
    }
  });
});
