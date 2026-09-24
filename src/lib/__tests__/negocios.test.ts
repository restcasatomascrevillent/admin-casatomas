import { describe, it, expect } from "vitest";
import {
  agruparPorNegocio,
  coincideNegocio,
  espacioUnicoDeNegocio,
  etiquetaNegocio,
  marcaDeEspacio,
  marcaDeReserva,
  marcaDeSolicitud,
  marcaParaAlta,
  normalizarMarca,
} from "@/lib/reservas/negocios";
import {
  calcularOcupacionPorNegocio,
  horasBaseDeNegocio,
  repartirPorNegocio,
  type EspacioSala,
  type ReservaOcupacionSala,
} from "@/lib/reservas/ocupacionSalas";
import { resumirOcupacionPorNegocio } from "@/lib/reservas/resumenNegocios";
import { filtrarFilasUnificadas, unificarReservasYSolicitudes } from "@/lib/reservas/vistaUnificada";

// Decisión del dueño 2026-09-24: las reservas de "El Reservado" (Touza) se
// ven y se gestionan igual que las de Casa Tomás, con su aforo aparte.

const ESPACIOS_BD = [
  { id: "comedor", nombre: "Comedor", capacidad_maxima: 60, activa: true, caracteristicas: {} },
  { id: "salon", nombre: "Salón", capacidad_maxima: 60, activa: true, caracteristicas: null },
  { id: "terraza", nombre: "Terraza", capacidad_maxima: 30, activa: true, caracteristicas: { marca: "casa_tomas" } },
  { id: "reservado", nombre: "El Reservado", capacidad_maxima: 20, activa: true, caracteristicas: { privada: true, marca: "touza" } },
];

describe("negocios: de dónde sale la marca", () => {
  it("normaliza null/vacío a Casa Tomás", () => {
    expect(normalizarMarca(null)).toBe("casa_tomas");
    expect(normalizarMarca("  ")).toBe("casa_tomas");
    expect(normalizarMarca("touza")).toBe("touza");
  });

  it("reserva: columna marca; espacio: caracteristicas.marca (sin etiqueta = Casa Tomás, como el trigger)", () => {
    expect(marcaDeReserva({ marca: "touza" })).toBe("touza");
    expect(marcaDeReserva({})).toBe("casa_tomas");
    expect(marcaDeEspacio(ESPACIOS_BD[0])).toBe("casa_tomas");
    expect(marcaDeEspacio(ESPACIOS_BD[1])).toBe("casa_tomas");
    expect(marcaDeEspacio(ESPACIOS_BD[3])).toBe("touza");
  });

  it("alta desde el panel: elegir El Reservado => touza; sin sala => Casa Tomás", () => {
    expect(marcaParaAlta("reservado", ESPACIOS_BD)).toBe("touza");
    expect(marcaParaAlta("comedor", ESPACIOS_BD)).toBe("casa_tomas");
    expect(marcaParaAlta(null, ESPACIOS_BD)).toBe("casa_tomas");
  });

  it("solicitud: sala propuesta > marcador de El Reservado en notas > Casa Tomás", () => {
    expect(marcaDeSolicitud({ espacio_propuesto_id: "reservado" }, ESPACIOS_BD)).toBe("touza");
    expect(marcaDeSolicitud({ notas_cliente: "Solicitud de El Reservado\nCumpleaños" }, ESPACIOS_BD)).toBe("touza");
    expect(
      marcaDeSolicitud({ espacio_propuesto_id: "comedor", notas_cliente: "Solicitud de El Reservado" }, ESPACIOS_BD),
    ).toBe("casa_tomas");
    expect(marcaDeSolicitud({ notas_cliente: "Mesa junto a la ventana" }, ESPACIOS_BD)).toBe("casa_tomas");
  });

  it("sala única de un negocio: Touza => El Reservado; Casa Tomás no preselecciona", () => {
    expect(espacioUnicoDeNegocio("touza", ESPACIOS_BD)).toBe("reservado");
    expect(espacioUnicoDeNegocio("casa_tomas", ESPACIOS_BD)).toBeNull();
  });

  it("etiquetas y filtro", () => {
    expect(etiquetaNegocio("touza")).toBe("Touza · El Reservado");
    expect(etiquetaNegocio(null)).toBe("Casa Tomás");
    expect(coincideNegocio("touza", "all")).toBe(true);
    expect(coincideNegocio(null, "casa_tomas")).toBe(true);
    expect(coincideNegocio("touza", "casa_tomas")).toBe(false);
  });

  it("agrupa en orden fijo (Casa Tomás primero) e incluye los obligatorios", () => {
    const grupos = agruparPorNegocio([{ m: "touza" }, { m: null }], (x) => x.m ?? "", ["casa_tomas"]);
    expect(grupos.map((g) => g.negocio.marca)).toEqual(["casa_tomas", "touza"]);
    expect(agruparPorNegocio([{ m: "touza" }], (x) => x.m, ["casa_tomas"])[0].items).toEqual([]);
  });
});

describe("aforo por negocio (mismo criterio que validar_capacidad_reserva)", () => {
  const espacios: EspacioSala[] = ESPACIOS_BD.map((e) => ({
    id: e.id,
    nombre: e.nombre,
    capacidad_maxima: e.capacidad_maxima,
    marca: marcaDeEspacio(e),
  }));
  const r = (o: Partial<ReservaOcupacionSala>): ReservaOcupacionSala => ({
    id: Math.random().toString(36).slice(2),
    hora: "14:00",
    numero_comensales: 2,
    estado: "confirmada",
    espacio_id: null,
    ...o,
  });
  const HORAS = ["13:00", "14:00", "20:00", "21:00"];

  it("reparte espacios y reservas por la columna marca", () => {
    const bloques = repartirPorNegocio(espacios, [
      r({ marca: "touza", espacio_id: "reservado", numero_comensales: 18 }),
      r({ marca: null, espacio_id: "comedor", numero_comensales: 4 }),
    ]);
    expect(bloques.map((b) => b.marca)).toEqual(["casa_tomas", "touza"]);
    expect(bloques[0].espacios.map((e) => e.id)).toEqual(["comedor", "salon", "terraza"]);
    expect(bloques[1].espacios.map((e) => e.id)).toEqual(["reservado"]);
    expect(bloques[1].reservas).toHaveLength(1);
  });

  it("los pax de Touza nunca cuentan contra el aforo de Casa Tomás (ni al revés)", () => {
    const reservas = [
      r({ marca: "touza", espacio_id: "reservado", numero_comensales: 18 }),
      r({ marca: "casa_tomas", espacio_id: "comedor", numero_comensales: 145 }),
    ];
    const bloques = repartirPorNegocio(espacios, reservas).map((b) => ({ ...b, horasBase: HORAS }));
    const [ct, touza] = calcularOcupacionPorNegocio({ bloques, comensales: 5, marcaEnJuego: "casa_tomas" });
    expect(ct.ocupacion.aforo.comida.capacidad).toBe(150);
    expect(ct.ocupacion.aforo.comida.ocupados).toBe(145);
    expect(ct.ocupacion.aforo.comida.cabe).toBe(true); // 145 + 5 = 150; las 18 de Touza no suman
    expect(touza.ocupacion.aforo.comida.capacidad).toBe(20);
    expect(touza.ocupacion.aforo.comida.ocupados).toBe(18);

    const [, touzaEnJuego] = calcularOcupacionPorNegocio({ bloques, comensales: 3, marcaEnJuego: "touza" });
    expect(touzaEnJuego.ocupacion.aforo.comida.cabe).toBe(false); // 18 + 3 > 20
  });

  it("una reserva de Touza con sala de otro negocio cuenta en Touza (sin asignar), como el trigger", () => {
    const bloques = repartirPorNegocio(espacios, [r({ marca: "touza", espacio_id: "comedor", numero_comensales: 6 })]).map(
      (b) => ({ ...b, horasBase: HORAS }),
    );
    const [ct, touza] = calcularOcupacionPorNegocio({ bloques, comensales: 0 });
    expect(ct.ocupacion.aforo.comida.ocupados).toBe(0);
    expect(touza.ocupacion.aforo.comida.ocupados).toBe(6);
    expect(touza.ocupacion.sinAsignar?.turnos.comida.ocupados).toBe(6);
  });

  it("franjas por negocio: El Reservado usa sus turnos propios; Casa Tomás, los generales", () => {
    const configuraciones = [
      { hora_inicio: "13:00", hora_fin: "15:00", intervalo_base_minutos: 60, espacio_id: null, activo: true },
      { hora_inicio: "21:00", hora_fin: "23:00", intervalo_base_minutos: 60, espacio_id: "reservado", activo: true },
    ];
    const [ct, touza] = repartirPorNegocio(espacios, []);
    const horasCt = horasBaseDeNegocio("2026-10-01", ct, configuraciones);
    const horasTouza = horasBaseDeNegocio("2026-10-01", touza, configuraciones);
    expect(horasCt.cerrado).toBe(false);
    expect(horasCt.horasBase.every((h) => h < "17:00")).toBe(true);
    expect(horasTouza.cerrado).toBe(false);
    expect(horasTouza.horasBase.length).toBeGreaterThan(0);
    expect(horasTouza.horasBase.every((h) => h >= "21:00")).toBe(true);
  });
});

describe("resumen de hoy por negocio", () => {
  it("total del grupo + desglose; % de cada negocio contra su propio aforo", () => {
    const res = resumirOcupacionPorNegocio(
      [
        { estado: "confirmada", numero_comensales: 30, marca: "casa_tomas" },
        { estado: "verificada", numero_comensales: 10, marca: "touza" },
        { estado: "cancelada", numero_comensales: 8, marca: "touza" },
      ],
      ESPACIOS_BD,
    );
    expect(res.totalReservas).toBe(2);
    expect(res.totalComensales).toBe(40);
    expect(res.capacidadTotal).toBe(170);
    const [ct, touza] = res.porNegocio;
    expect(ct.negocio.marca).toBe("casa_tomas");
    expect(ct.capacidadTotal).toBe(150);
    expect(ct.porcentajeTotal).toBe(20);
    expect(touza.capacidadTotal).toBe(20);
    expect(touza.porcentajeTotal).toBe(50);
    expect(touza.reservasCanceladas).toBe(1);
  });
});

describe("lista unificada: filtro Negocio", () => {
  const reservas = [
    { id: "a", fecha: "2026-10-01", hora: "14:00", estado: "confirmada", numero_comensales: 2, marca: "casa_tomas" },
    { id: "b", fecha: "2026-10-01", hora: "21:00", estado: "verificada", numero_comensales: 12, marca: "touza" },
  ];
  const solicitudes = [
    {
      id: "s1",
      estado: "pendiente",
      fecha_solicitada: "2026-10-01",
      hora_solicitada: "21:00",
      numero_comensales: 15,
      notas_cliente: "Solicitud de El Reservado\nCena de empresa",
      created_at: "2026-09-24T10:00:00Z",
      motivo_rechazo: "grupo_grande",
    },
  ] as any[];

  it("Touza muestra sus reservas y las solicitudes de El Reservado", () => {
    const filas = unificarReservasYSolicitudes(reservas as any, solicitudes);
    const touza = filtrarFilasUnificadas(filas, { negocio: "touza" });
    expect(touza.map((f) => (f.tipo === "reserva" ? f.reserva.id : f.solicitud.id)).sort()).toEqual(["b", "s1"]);
    const ct = filtrarFilasUnificadas(filas, { negocio: "casa_tomas" });
    expect(ct.map((f) => (f.tipo === "reserva" ? f.reserva.id : f.solicitud.id))).toEqual(["a"]);
    expect(filtrarFilasUnificadas(filas, { negocio: "all" })).toHaveLength(3);
  });
});
