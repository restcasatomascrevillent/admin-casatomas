/** Qué puede hacer cada perfil en Facturas (dueño, 06/11/2026). */
import { describe, expect, it } from "vitest";
import { permisosFacturas, pestanaPermitida, pestanasFacturas, puedeCorregirDocumento } from "@/lib/facturas/permisos";

const soloVer = permisosFacturas({ ver: true, editar: false, subida: false });
const soloSubida = permisosFacturas({ ver: false, editar: false, subida: true });
const subidaVer = permisosFacturas({ ver: true, editar: false, subida: true });
const editar = permisosFacturas({ ver: true, editar: true, subida: false });
const nada = permisosFacturas({ ver: false, editar: false, subida: false });

describe("permisosFacturas", () => {
  it("«Ver» consulta; Subida sube; «Editar» hace todo (sube incluido, aunque no tenga «Ver» marcado)", () => {
    expect(soloVer).toEqual({ consultar: true, editar: false, subir: false });
    expect(soloSubida).toEqual({ consultar: false, editar: false, subir: true });
    expect(subidaVer).toEqual({ consultar: true, editar: false, subir: true });
    expect(editar).toEqual({ consultar: true, editar: true, subir: true });
    expect(permisosFacturas({ ver: false, editar: true, subida: false })).toEqual({ consultar: true, editar: true, subir: true });
    expect(nada).toEqual({ consultar: false, editar: false, subir: false });
  });
});

describe("pestañas", () => {
  it("se ven según el perfil, en el orden de la barra", () => {
    expect(pestanasFacturas(soloVer)).toEqual(["chat", "compras"]);
    expect(pestanasFacturas(soloSubida)).toEqual(["cargar"]);
    expect(pestanasFacturas(subidaVer)).toEqual(["chat", "compras", "cargar"]);
    expect(pestanasFacturas(editar)).toEqual(["chat", "compras", "cargar"]);
    expect(pestanasFacturas(nada)).toEqual([]);
  });

  it("la pedida si se ve; si no, la primera que sí", () => {
    expect(pestanaPermitida("compras", soloSubida)).toBe("cargar");
    expect(pestanaPermitida("chat", soloSubida)).toBe("cargar");
    expect(pestanaPermitida("cargar", soloVer)).toBe("chat");
    expect(pestanaPermitida("compras", subidaVer)).toBe("compras");
    expect(pestanaPermitida("cargar", nada)).toBeNull();
  });
});

describe("puedeCorregirDocumento", () => {
  it("«Editar», cualquiera; Subida, solo lo que subió él; «Ver», nada", () => {
    expect(puedeCorregirDocumento(editar, "otra", "u1")).toBe(true);
    expect(puedeCorregirDocumento(editar, null, null)).toBe(true);
    expect(puedeCorregirDocumento(soloSubida, "u1", "u1")).toBe(true);
    expect(puedeCorregirDocumento(subidaVer, "u1", "u1")).toBe(true);
    expect(puedeCorregirDocumento(soloSubida, "otra", "u1")).toBe(false);
    expect(puedeCorregirDocumento(soloSubida, null, "u1")).toBe(false);
    expect(puedeCorregirDocumento(soloSubida, "u1", null)).toBe(false);
    expect(puedeCorregirDocumento(soloVer, "u1", "u1")).toBe(false);
  });
});
