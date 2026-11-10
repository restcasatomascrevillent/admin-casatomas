import { describe, expect, it } from "vitest";
import { aptitudesPlato } from "@/lib/aptitudes-plato";

const apto = (datos: Parameters<typeof aptitudesPlato>[0]) =>
  Object.fromEntries(Object.entries(aptitudesPlato(datos)).map(([k, v]) => [k, v.apto]));

describe("«Apto para» de un plato (mismas reglas que los filtros de la web)", () => {
  it("sin alérgenos rellenos no se puede asegurar nada", () => {
    const e = aptitudesPlato({ alergenos: [] });
    expect(e.celiaquia).toEqual({ apto: false, motivo: "Faltan los alérgenos" });
    expect(e.lactosa).toEqual({ apto: false, motivo: "Faltan los alérgenos" });
    expect(e.vegetariano).toEqual({ apto: false, motivo: "Sin marcar" });
  });
  it("«sin alérgenos declarados» cuenta como dato: apto para celíacos y sin lactosa", () => {
    expect(apto({ alergenos: ["sin alérgenos declarados"] })).toEqual({ celiaquia: true, lactosa: true, vegetariano: false });
  });
  it("gluten y lácteos (con o sin tilde, oficiales o inferidos)", () => {
    expect(apto({ alergenos: ["gluten", "lácteos"] })).toMatchObject({ celiaquia: false, lactosa: false });
    expect(aptitudesPlato({ alergenos: ["huevos"], inferidos: ["Lacteos"] }).lactosa).toEqual({ apto: false, motivo: "Lleva lácteos" });
    expect(aptitudesPlato({ alergenos: ["gluten"], sinGluten: true }).celiaquia).toEqual({ apto: true, motivo: "Se puede hacer sin gluten" });
  });
  it("la nota de alérgenos manda como en la web", () => {
    expect(aptitudesPlato({ alergenos: ["huevos"], notas: "Puede contener trazas de gluten." }).celiaquia.motivo).toBe("La nota de alérgenos habla de gluten");
    expect(aptitudesPlato({ alergenos: ["huevos"], notas: "Para los alérgenos consultar al personal" }).lactosa.motivo).toBe("La nota de alérgenos remite al personal");
  });
  it("vegetariano: casilla marcada y sin carne, pescado ni marisco", () => {
    expect(aptitudesPlato({ alergenos: ["huevos", "lácteos"], vegetariano: true, nombre: "Flan" }).vegetariano).toEqual({ apto: true, motivo: "Marcado como vegetariano" });
    expect(aptitudesPlato({ alergenos: ["pescado"], vegetariano: true }).vegetariano.motivo).toBe("Marcado, pero lleva pescado");
    expect(aptitudesPlato({ alergenos: ["crustáceos"], vegetariano: true }).vegetariano.motivo).toBe("Marcado, pero lleva crustáceos");
    expect(aptitudesPlato({ alergenos: ["huevos"], vegetariano: true, descripcion: "Patata, huevo y atún" }).vegetariano.motivo).toBe("Marcado, pero el texto dice «atun»");
  });
  it("lo decidido a mano manda sobre los alérgenos; NULL es automático", () => {
    expect(aptitudesPlato({ alergenos: ["gluten"], aptoCeliacos: true }).celiaquia).toEqual({ apto: true, motivo: "Marcado a mano" });
    expect(aptitudesPlato({ alergenos: ["huevos"], aptoCeliacos: false }).celiaquia).toEqual({ apto: false, motivo: "Desmarcado a mano" });
    expect(aptitudesPlato({ alergenos: ["gluten"], sinGluten: true, aptoCeliacos: false }).celiaquia.apto).toBe(false);
    expect(aptitudesPlato({ alergenos: [], aptoSinLactosa: true }).lactosa).toEqual({ apto: true, motivo: "Marcado a mano" });
    expect(aptitudesPlato({ alergenos: ["huevos"], aptoSinLactosa: false }).lactosa).toEqual({ apto: false, motivo: "Desmarcado a mano" });
    expect(aptitudesPlato({ alergenos: ["lácteos"], aptoSinLactosa: null }).lactosa.motivo).toBe("Lleva lácteos");
  });
});
