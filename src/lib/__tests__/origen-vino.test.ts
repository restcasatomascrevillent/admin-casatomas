/**
 * Origen obligatorio de los vinos (04/11/2026, dueño: «deja de subir vinos si
 * el origen no está claro»): país, región y categoría con denominación.
 */
import { describe, expect, it } from "vitest";
import {
  avisoTarjetaSinOrigen,
  categoriasConOrigen,
  categoriaVino,
  faltasOrigenVino,
  MENSAJE_CATEGORIA_PENDIENTE,
  mensajeFaltaOrigen,
  mensajeNoPublicarSinOrigen,
  origenVinoClaro,
  paisVino,
  regionVino,
} from "../origen-vino";
import { categoriaCorta, esCategoriaOrigenPendiente, tipoVino } from "../tipos-vino";

const bueno = { categoria: "VINOS TINTOS — RIOJA", ubicacion_pais: "España", ubicacion_region: "Haro, La Rioja" };

describe("tipos-vino (mismo criterio que la carta de la web)", () => {
  it("tipo por el texto de la categoría", () => {
    expect(tipoVino("VINOS TINTOS — RIBERA DEL DUERO")).toBe("tinto");
    expect(tipoVino("VINOS BLANCOS — RÍAS BAIXAS")).toBe("blanco");
    expect(tipoVino("VINOS ROSADOS — NAVARRA")).toBe("rosado");
    expect(tipoVino("VINOS ESPUMOSOS — CHAMPAGNE")).toBe("espumoso");
    expect(tipoVino("Cava")).toBe("espumoso");
    expect(tipoVino("Generosos")).toBe("otro");
    expect(tipoVino(null)).toBe("otro");
  });

  it("denominación legible y «Origen por confirmar» para las pendientes", () => {
    expect(categoriaCorta("VINOS TINTOS — RIBERA DEL DUERO")).toBe("Ribera del Duero");
    expect(categoriaCorta("VINOS TINTOS — RIOJA")).toBe("Rioja");
    expect(categoriaCorta("VINOS BLANCOS — IGP CASTILLA Y LEÓN")).toBe("IGP Castilla y León");
    expect(categoriaCorta("VINOS ESPUMOSOS — MOSCATO D’ASTI")).toBe("Moscato d’asti");
    expect(categoriaCorta("VINOS TINTOS — ORIGEN PENDIENTE")).toBe("Origen por confirmar");
  });

  it("categoría de origen pendiente: «pendiente» o «por confirmar», sin mirar mayúsculas", () => {
    expect(esCategoriaOrigenPendiente("VINOS BLANCOS — ORIGEN PENDIENTE")).toBe(true);
    expect(esCategoriaOrigenPendiente("Vinos tintos — origen pendiente")).toBe(true);
    expect(esCategoriaOrigenPendiente("VINOS TINTOS — POR CONFIRMAR")).toBe(true);
    expect(esCategoriaOrigenPendiente("VINOS TINTOS — RIOJA")).toBe(false);
    expect(esCategoriaOrigenPendiente(null)).toBe(false);
  });
});

describe("origen claro", () => {
  it("país, región y categoría con denominación", () => {
    expect(origenVinoClaro(bueno)).toBe(true);
    expect(faltasOrigenVino({ ...bueno, ubicacion_pais: "  " })).toEqual(["pais"]);
    expect(faltasOrigenVino({ ...bueno, ubicacion_region: null })).toEqual(["region"]);
    expect(faltasOrigenVino({ ...bueno, categoria: "VINOS TINTOS — ORIGEN PENDIENTE" })).toEqual(["categoria"]);
    expect(faltasOrigenVino({ categoria: "", ubicacion_pais: "", ubicacion_region: "" })).toEqual(["pais", "region", "categoria"]);
  });

  it("mensajes claros de qué falta", () => {
    expect(mensajeFaltaOrigen(bueno)).toBe("");
    expect(mensajeFaltaOrigen({ ...bueno, ubicacion_pais: "", ubicacion_region: "" })).toBe(
      "Falta el país y la región: sin el origen claro el mapa de la carta no sabe dónde poner el vino.",
    );
    expect(mensajeFaltaOrigen({ ...bueno, categoria: "VINOS ESPUMOSOS — ORIGEN PENDIENTE" })).toMatch(
      /^Falta la categoría con su denominación \(no vale «Origen pendiente»\)/,
    );
    expect(mensajeNoPublicarSinOrigen({ ...bueno, nombre: " Burbujas ", ubicacion_pais: "" })).toBe(
      "«Burbujas» no se puede publicar sin origen. Falta el país: sin el origen claro el mapa de la carta no sabe dónde poner el vino. Edítalo y complétalo.",
    );
  });

  it("aviso corto de la tarjeta: qué falta y qué hacer", () => {
    expect(avisoTarjetaSinOrigen(bueno)).toBe("");
    expect(avisoTarjetaSinOrigen({ ...bueno, categoria: "VINOS TINTOS — ORIGEN PENDIENTE" })).toBe(
      "No se puede publicar: falta elegir su categoría con la denominación de origen. Pulsa «Editar» y complétalo.",
    );
    expect(avisoTarjetaSinOrigen({ ...bueno, ubicacion_pais: "", ubicacion_region: "" })).toBe(
      "No se puede publicar: falta el país y la región. Pulsa «Editar» y complétalo.",
    );
    expect(avisoTarjetaSinOrigen({ categoria: "VINOS TINTOS — ORIGEN PENDIENTE", ubicacion_pais: "", ubicacion_region: "Haro" })).toBe(
      "No se puede publicar: falta el país y falta elegir su categoría con la denominación de origen. Pulsa «Editar» y complétalo.",
    );
  });

  it("campos del formulario: no vale vacío ni «ORIGEN PENDIENTE»", () => {
    expect(categoriaVino.safeParse("VINOS TINTOS — RIOJA").success).toBe(true);
    const pendiente = categoriaVino.safeParse("VINOS TINTOS — ORIGEN PENDIENTE");
    expect(pendiente.success).toBe(false);
    expect(pendiente.error?.issues[0].message).toBe(MENSAJE_CATEGORIA_PENDIENTE);
    expect(categoriaVino.safeParse("  ").success).toBe(false);
    expect(paisVino.safeParse(" ").error?.issues[0].message).toMatch(/El país es obligatorio/);
    expect(regionVino.safeParse("").error?.issues[0].message).toMatch(/La región es obligatoria/);
    expect(regionVino.parse(" Haro ")).toBe("Haro");
  });

  it("el formulario no ofrece las categorías de origen pendiente", () => {
    expect(
      categoriasConOrigen(["VINOS TINTOS — RIOJA", "VINOS TINTOS — ORIGEN PENDIENTE", null, "", "VINOS BLANCOS — RUEDA"]),
    ).toEqual(["VINOS TINTOS — RIOJA", "VINOS BLANCOS — RUEDA"]);
  });
});
