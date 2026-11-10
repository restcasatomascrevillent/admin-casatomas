import { describe, expect, it } from "vitest";
import { errorPrecioMenu, leerPrecioMenu, precioMenuParaCampo, textoInsigniaMenu } from "@/lib/reservas/menuCerrado";
import { calcularCambiosEdicion, valoresFormularioDesdeReserva, type ReservaEditable } from "@/lib/reservas/edicionReserva";

describe("menú cerrado: precio", () => {
  it("lee coma o punto, con o sin €, y vacío = sin precio", () => {
    expect(leerPrecioMenu("18")).toBe(18);
    expect(leerPrecioMenu("18,5")).toBe(18.5);
    expect(leerPrecioMenu(" 18.50 € ")).toBe(18.5);
    expect(leerPrecioMenu("")).toBeNull();
    expect(leerPrecioMenu(null)).toBeNull();
  });

  it("rechaza negativos, letras, más de 2 decimales y lo que no cabe en numeric(6,2)", () => {
    for (const malo of ["-5", "abc", "18,555", "10000", "1.2.3"]) expect(leerPrecioMenu(malo)).toBeUndefined();
    expect(errorPrecioMenu("abc")).toMatch(/precio válido/);
    expect(errorPrecioMenu("")).toBeNull();
  });

  it("insignia «Menú 55 €» / «Menú 18,50 €» y «Menú cerrado» sin precio", () => {
    expect(textoInsigniaMenu(55)).toBe("Menú 55 €");
    expect(textoInsigniaMenu("18.50")).toBe("Menú 18,50 €");
    expect(textoInsigniaMenu(null)).toBe("Menú cerrado");
    expect(precioMenuParaCampo("18.00")).toBe("18");
  });
});

describe("edición: diff del menú cerrado (no toca el menú del día)", () => {
  const base: ReservaEditable = {
    id: "r",
    nombre: "Ana",
    telefono: "+34612345678",
    email: null,
    fecha: "2026-11-20",
    hora: "14:00",
    numero_comensales: 2,
    estado: "confirmada",
    notas_cliente: null,
    espacio_id: null,
  };
  const editar = (original: ReservaEditable, menu: boolean, menu_precio: string) => {
    const v = valoresFormularioDesdeReserva(original);
    return calcularCambiosEdicion(original, { ...v, menu_cerrado: menu, menu_precio });
  };

  it("sin tocar el menú no hay cambios (también con precio guardado como texto)", () => {
    const conMenu = { ...base, menu_cerrado: true, menu_precio: "18.50" };
    const v = valoresFormularioDesdeReserva(conMenu);
    expect(v).toMatchObject({ menu_cerrado: true, menu_precio: "18,50" });
    expect(calcularCambiosEdicion(conMenu, v)).toEqual({});
  });

  it("Sí con precio, cambio de precio y No", () => {
    expect(editar(base, true, "18")).toEqual({ menu_cerrado: true, menu_precio: 18 });
    expect(editar({ ...base, menu_cerrado: true, menu_precio: 18 }, true, "20")).toEqual({ menu_precio: 20 });
    expect(editar({ ...base, menu_cerrado: true, menu_precio: 18 }, false, "")).toEqual({ menu_cerrado: false, menu_precio: null });
    expect(editar({ ...base, menu_cerrado: true }, false, "")).toEqual({ menu_cerrado: false });
  });
});
