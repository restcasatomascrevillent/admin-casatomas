import { describe, expect, it } from "vitest";
import { errorPrecioMenu, leerPrecioMenu, precioMenuParaCampo, textoInsigniaMenu } from "@/lib/reservas/menuCerrado";
import { eligeMenuOCarta, salaAdmiteServicio, servicioComidaDeReserva } from "@/lib/reservas/menuDelDia";
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

describe("menú del día o carta (martes a jueves, comida)", () => {
  it("solo martes a jueves antes de las 17:00", () => {
    expect(eligeMenuOCarta("2026-11-17", "14:00")).toBe(true); // martes
    expect(eligeMenuOCarta("2026-11-19", "16:59")).toBe(true); // jueves
    expect(eligeMenuOCarta("2026-11-17", "21:00")).toBe(false);
    expect(eligeMenuOCarta("2026-11-21", "14:00")).toBe(false); // sábado
    expect(servicioComidaDeReserva({ fecha: "2026-11-18", hora: "14:00:00", menu_del_dia: true })).toBe("menu_del_dia");
    expect(servicioComidaDeReserva({ fecha: "2026-11-18", hora: "14:00", menu_del_dia: false })).toBe("carta");
    expect(servicioComidaDeReserva({ fecha: "2026-11-21", hora: "14:00", menu_del_dia: true })).toBeNull();
  });

  it("salas: menú del día → Comedor o Terraza; carta → Salón, Comedor o Terraza", () => {
    expect(salaAdmiteServicio("Comedor", "menu_del_dia")).toBe(true);
    expect(salaAdmiteServicio("Terraza", "menu_del_dia")).toBe(true);
    expect(salaAdmiteServicio("Salón", "menu_del_dia")).toBe(false);
    expect(salaAdmiteServicio("Reservado", "menu_del_dia")).toBe(false);
    expect(salaAdmiteServicio("Salón", "carta")).toBe(true);
    expect(salaAdmiteServicio("Reservado", "carta")).toBe(false);
    expect(salaAdmiteServicio("Reservado", null)).toBe(true);
  });

  it("edición: elegir menú del día / carta cambia menu_del_dia; fuera de esos días queda en false", () => {
    const martes: ReservaEditable = {
      id: "r", nombre: "Ana", telefono: null, email: null, fecha: "2026-11-17", hora: "14:00",
      numero_comensales: 2, estado: "confirmada", notas_cliente: null, espacio_id: null,
    };
    const v = valoresFormularioDesdeReserva(martes);
    expect(v.servicio_comida).toBe("carta");
    expect(calcularCambiosEdicion(martes, { ...v, servicio_comida: "menu_del_dia" })).toEqual({ menu_del_dia: true });
    const conMenu = { ...martes, menu_del_dia: true };
    expect(valoresFormularioDesdeReserva(conMenu).servicio_comida).toBe("menu_del_dia");
    expect(calcularCambiosEdicion(conMenu, { ...valoresFormularioDesdeReserva(conMenu), servicio_comida: "carta" })).toEqual({ menu_del_dia: false });
    // Pasarla a la cena: deja de ser menú del día.
    expect(calcularCambiosEdicion(conMenu, { ...valoresFormularioDesdeReserva(conMenu), hora: "21:00" })).toEqual({ hora: "21:00", menu_del_dia: false });
  });
});
