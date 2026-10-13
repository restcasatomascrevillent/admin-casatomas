import { describe, expect, it } from "vitest";
import {
  CAPACIDAD_RESERVADO,
  MESA_LARGA_SALON,
  esGrupoGrande,
  esSalaMesaLarga,
  excedeReservado,
  limitesSala,
  mesaLargaPara,
  seAsignaSolo,
  sugerenciaGrupoGrande,
  type MesaPlanoMin,
} from "../grupoGrande";

// Salón de Casa Tomás según la migración 20261008190000 (pos en m, tamaño en cm).
const SALON: MesaPlanoMin[] = [
  { id: "s1", nombre: "1", piezas: 2, forma: "rectangular", ancho: 70, alto: 110, pos_x: 8.21, pos_y: 6.0 },
  { id: "s2", nombre: "2", piezas: 1, forma: "rectangular", ancho: 70, alto: 55, pos_x: 6.39, pos_y: 6.0 },
  { id: "s3", nombre: "3", piezas: 2, forma: "rectangular", ancho: 70, alto: 110, pos_x: 4.51, pos_y: 6.0 },
  { id: "s4", nombre: "4", piezas: 2, forma: "rectangular", ancho: 70, alto: 110, pos_x: 2.26, pos_y: 6.0 },
  { id: "s5", nombre: "5", piezas: null, forma: "circular", ancho: 150, alto: 150, pos_x: 13.91, pos_y: 5.35 },
  { id: "s7", nombre: "7", piezas: 1, forma: "rectangular", ancho: 70, alto: 55, pos_x: 9.0, pos_y: 5.03 },
  { id: "s8", nombre: "8", piezas: 2, forma: "rectangular", ancho: 70, alto: 110, pos_x: 5.26, pos_y: 4.3 },
  { id: "s9", nombre: "9", piezas: 2, forma: "rectangular", ancho: 70, alto: 110, pos_x: 2.26, pos_y: 4.3 },
  { id: "s10", nombre: "10", piezas: 2, forma: "rectangular", ancho: 70, alto: 110, pos_x: 15.2, pos_y: 2.0 },
  { id: "s11", nombre: "11", piezas: null, forma: "circular", ancho: 150, alto: 150, pos_x: 10.9, pos_y: 3.3 },
  { id: "s12", nombre: "12", piezas: null, forma: "circular", ancho: 150, alto: 150, pos_x: 7.25, pos_y: 2.25 },
  { id: "s13", nombre: "13", piezas: 2, forma: "rectangular", ancho: 110, alto: 70, pos_x: 11.6, pos_y: 0.9 },
  { id: "s14", nombre: "14", piezas: 2, forma: "rectangular", ancho: 110, alto: 70, pos_x: 9.7, pos_y: 0.9 },
];
const RESERVADO = { id: "R", nombre: "Reservado", capacidad: 14 };
const salon = (extra: Partial<{ ocupadas: Set<string> }> = {}) => ({ id: "S", nombre: "Salón", mesas: SALON, ...extra });

describe("reglas de lo automático", () => {
  it("hasta 7 se asigna solo; 8 o más lo revisa una persona", () => {
    expect(seAsignaSolo(7)).toBe(true);
    expect(seAsignaSolo(8)).toBe(false);
    expect(seAsignaSolo(0)).toBe(false);
    expect(esGrupoGrande(8)).toBe(true);
    expect(esGrupoGrande(7)).toBe(false);
  });

  it("el Reservado admite 14", () => {
    expect(CAPACIDAD_RESERVADO).toBe(14);
    expect(excedeReservado(14)).toBe(false);
    expect(excedeReservado(15)).toBe(true);
    expect(excedeReservado(15, null)).toBe(true);
    expect(excedeReservado(15, 20)).toBe(false);
  });

  it("reconoce el Salón sin importar tildes ni mayúsculas", () => {
    expect(esSalaMesaLarga("Salón")).toBe(true);
    expect(esSalaMesaLarga(" salon ")).toBe(true);
    expect(esSalaMesaLarga("Comedor")).toBe(false);
  });
});

describe("mesa larga en el Salón (pared de abajo, esquina derecha)", () => {
  it("sin paredes en el plano usa las del Salón (x 1,3–16,7; abajo 8,1)", () => {
    expect(limitesSala(null)).toEqual(MESA_LARGA_SALON.paredesPorDefecto);
  });

  it("con paredes dibujadas, la esquina sale de ellas (px a 50 px/m)", () => {
    const plano = {
      pixels_per_meter: 50,
      configuracion: {
        elementos: [
          { tipo: "wall", props: { x1: 50, y1: 25, x2: 950, y2: 25 } },
          { tipo: "wall", props: { x1: 50, y1: 500, x2: 950, y2: 500 } },
          { tipo: "wall", props: { x1: 50, y1: 25, x2: 50, y2: 500 } },
          { tipo: "wall", props: { x1: 950, y1: 25, x2: 950, y2: 500 } },
          { tipo: "area", props: { left: 1, top: 1, width: 5, height: 5 } },
        ],
      },
    };
    expect(limitesSala(plano)).toEqual({ izquierda: 1, derecha: 19, arriba: 0.5, abajo: 10 });
    const m = mesaLargaPara({ comensales: 16, mesas: [], plano });
    // 7 piezas × 55 cm = 3,85 m; 0,6 m de holgura en cada pared.
    expect(m.pos_x).toBeCloseTo(19 - 0.6 - 3.85, 2);
    expect(m.pos_y).toBeCloseTo(10 - 0.6 - 0.7, 2);
  });

  it("18 personas: 8 piezas + 2 picos, horizontal, pegada abajo a la derecha", () => {
    const m = mesaLargaPara({ comensales: 18, mesas: SALON });
    expect([m.piezas, m.picos, m.plazas]).toEqual([8, 2, 18]);
    expect(m.ancho).toBe(440);
    expect(m.alto).toBe(70);
    expect(m.pos_x).toBeCloseTo(16.7 - 0.6 - 4.4, 2);
    expect(m.pos_y).toBeCloseTo(8.1 - 0.6 - 0.7, 2);
    // La redonda 5 está en esa esquina: hay que retirarla.
    expect(m.estorban).toEqual(["5"]);
    // Las piezas salen de las mesas de piezas libres más cercanas (nunca de redondas).
    expect(m.donantes.reduce((s, d) => s + d.piezas, 0)).toBe(8);
    expect(m.donantes.map((d) => d.nombre)).not.toContain("5");
    expect(m.faltanPiezas).toBe(0);
  });

  it("no coge piezas de mesas con reserva en ese servicio y avisa si no llegan", () => {
    const todas = new Set(SALON.filter((x) => x.id !== "s10").map((x) => x.id));
    const m = mesaLargaPara({ comensales: 20, mesas: SALON, ocupadas: todas });
    expect(m.donantes).toEqual([{ mesaId: "s10", nombre: "10", piezas: 2 }]);
    expect(m.faltanPiezas).toBe(7);
  });

  it("la pared y la esquina se cambian en la configuración", () => {
    const m = mesaLargaPara({
      comensales: 16,
      mesas: [],
      config: { ...MESA_LARGA_SALON, pared: "derecha", extremo: "abajo" },
    });
    expect(m.ancho).toBe(70);
    expect(m.alto).toBe(385);
    expect(m.pos_x).toBeCloseTo(16.7 - 0.6 - 0.7, 2);
    expect(m.pos_y).toBeCloseTo(8.1 - 0.6 - 3.85, 2);
  });
});

describe("sugerenciaGrupoGrande", () => {
  it("de 7 para abajo no hay sugerencia (se asigna solo)", () => {
    expect(sugerenciaGrupoGrande({ comensales: 7, reservado: RESERVADO, salon: salon() })).toBeNull();
  });

  it("de 8 a 14: al Reservado", () => {
    const s = sugerenciaGrupoGrande({ comensales: 12, reservado: RESERVADO, salon: salon() });
    expect(s).toMatchObject({ tipo: "reservado", capacidad: 14, texto: "Grupo de 12: al Reservado (hasta 14)." });
  });

  it("más de 14: mesa larga en el Salón, pegada a la pared de abajo a la derecha", () => {
    const s = sugerenciaGrupoGrande({ comensales: 15, reservado: RESERVADO, salon: salon() });
    expect(s?.tipo).toBe("mesa_larga");
    expect(s?.texto).toMatch(
      /^Grupo de 15 \(más de 14: no caben en el Reservado\): mesa larga en el Salón, pegada a la pared de abajo a la derecha, 7 piezas \+ pico \(15 plazas, 3,85 m\)\. Piezas de la /,
    );
    expect(s?.texto).toMatch(/retira antes la 5\.$/);
  });

  it("Reservado ocupado en ese turno: también al Salón", () => {
    const s = sugerenciaGrupoGrande({ comensales: 10, reservado: { ...RESERVADO, ocupadoPor: "García" }, salon: salon() });
    expect(s?.tipo).toBe("mesa_larga");
    expect(s?.texto).toMatch(/Reservado ya lo tiene García en este turno/);
  });

  it("sin la capacidad del Reservado en la BD, se supone 14", () => {
    const sinCap = { id: "R", nombre: "Reservado" };
    expect(sugerenciaGrupoGrande({ comensales: 14, reservado: sinCap, salon: salon() })?.tipo).toBe("reservado");
    expect(sugerenciaGrupoGrande({ comensales: 15, reservado: sinCap, salon: salon() })?.tipo).toBe("mesa_larga");
  });

  it("forzarSalon: una reserva del Reservado que no cabe va al Salón aunque sea de menos de 8", () => {
    expect(sugerenciaGrupoGrande({ comensales: 6, reservado: RESERVADO, salon: salon(), forzarSalon: true })?.tipo).toBe(
      "mesa_larga",
    );
  });

  it("sin Salón ni Reservado: a mano", () => {
    expect(sugerenciaGrupoGrande({ comensales: 20 })).toEqual({ tipo: "manual", texto: "Grupo de 20: asígnalo a mano." });
  });
});
