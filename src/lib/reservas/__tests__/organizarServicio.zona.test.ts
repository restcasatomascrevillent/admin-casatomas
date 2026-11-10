// «Organizar servicio» respeta «¿Dentro o fuera?» (`zonaPreferida`, 10/11/2026).
import { describe, expect, it } from "vitest";
import { organizarServicio, type EntradaOrg, type ReservaOrg, type SalaOrg } from "../organizarServicio";
import type { FilaMesaSala } from "../sentarAhora";

const SALAS: SalaOrg[] = [
  { id: "C", nombre: "Comedor", terraza: false },
  { id: "S", nombre: "Salón", terraza: false },
  { id: "T", nombre: "Terraza", terraza: true },
];

const pieza = (sala: string, nombre: string, piezas: number): FilaMesaSala => ({
  id: `${sala}${nombre}`,
  nombre,
  espacio_id: sala,
  capacidad: piezas * 2,
  forma: "rectangular",
  ancho: piezas * 55,
  alto: 70,
  pos_x: 0,
  pos_y: 0,
  piezas,
  picos_base: 0,
  picos_max: 1,
  piezas_max: piezas,
  grupo_piezas: null,
});
const sitio = (nombre: string): FilaMesaSala => ({
  id: `T${nombre}`, nombre, espacio_id: "T", capacidad: 4, forma: "rectangular", ancho: 65, alto: 65,
  pos_x: 0, pos_y: 0, piezas: null, plazas_min: 2, plazas_max: 6, grupo_piezas: "terraza",
});
const res = (id: string, comensales: number, hora: string, mesaIds: string[] = [], extra: Partial<ReservaOrg> = {}): ReservaOrg => ({
  id, nombre: id, hora, comensales, estado: "confirmada", importante: false,
  espacioId: mesaIds[0]?.[0] ?? null, mesaIds, ...extra,
});
const entrada = (mesas: FilaMesaSala[], reservas: ReservaOrg[], extra: Partial<EntradaOrg> = {}): EntradaOrg => ({
  salas: SALAS, mesas, ajustes: [], reservas, ...extra,
});
const salaDe = (r: ReturnType<typeof organizarServicio>, id: string) => r.movimientos.find((m) => m.reservaId === id)?.hacia.salaId;

describe("organizarServicio · «¿Dentro o fuera?»", () => {
  const mesas = [pieza("C", "1", 2), pieza("S", "2", 2), sitio("1")];

  it("«fuera» va a la Terraza aunque haya sitio dentro", () => {
    const r = organizarServicio(entrada(mesas, [res("Ana", 2, "21:00:00", [], { zonaPreferida: "fuera" })]));
    expect(salaDe(r, "Ana")).toBe("T");
  });

  it("«dentro» nunca va a la Terraza", () => {
    const r = organizarServicio(
      entrada([sitio("1"), pieza("C", "1", 2)], [res("Luis", 2, "21:00:00", [], { zonaPreferida: "dentro" })]),
    );
    expect(salaDe(r, "Luis")).toBe("C");
  });

  it("«fuera» con la Terraza cerrada: sin sitio, con el motivo", () => {
    const r = organizarServicio(
      entrada(mesas, [res("Eva", 2, "21:00:00", [], { zonaPreferida: "fuera" })], { terrazaCerrada: true }),
    );
    expect(r.sinSitio.map((s) => s.reservaId)).toEqual(["Eva"]);
    expect(r.sinSitio[0].motivo).toMatch(/fuera/);
  });

  it("una reserva «fuera» ya puesta en el Comedor se pasa a la Terraza", () => {
    const r = organizarServicio(entrada(mesas, [res("Pepe", 2, "21:00:00", ["C1"], { zonaPreferida: "fuera" })]));
    expect(salaDe(r, "Pepe")).toBe("T");
  });

  it("menú del día + dentro → el Comedor (el Salón no vale para menú)", () => {
    const r = organizarServicio(
      entrada([pieza("S", "2", 2), pieza("C", "1", 2), sitio("1")], [
        res("Mar", 2, "14:00:00", [], { zonaPreferida: "dentro", servicioComida: "menu_del_dia" }),
      ]),
    );
    expect(salaDe(r, "Mar")).toBe("C");
  });

  it("sin zona, como siempre (cualquier sala)", () => {
    const r = organizarServicio(entrada(mesas, [res("Rosa", 2, "21:00:00")]));
    expect(r.sinSitio).toEqual([]);
    expect(salaDe(r, "Rosa")).toBeDefined();
  });

  it("el dato `exterior` de la sala manda sobre el nombre", () => {
    const r = organizarServicio({
      salas: [
        { id: "C", nombre: "Comedor", terraza: false },
        { id: "P", nombre: "Patio", terraza: false, exterior: true },
      ],
      mesas: [pieza("C", "1", 2), pieza("P", "9", 2)],
      ajustes: [],
      reservas: [res("Sol", 2, "21:00:00", [], { zonaPreferida: "fuera" })],
    });
    expect(salaDe(r, "Sol")).toBe("P");
  });
});
