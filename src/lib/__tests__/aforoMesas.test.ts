import { describe, it, expect } from "vitest";
import {
  calcularCuadreEspacio,
  calcularCuadrePorNegocio,
  calcularCuadres,
  plazasDeMesas,
  textoEstadoCuadre,
  type CuadreEspacio,
  type EspacioParaCuadre,
  type MesaParaCuadre,
} from "@/lib/reservas/aforoMesas";

// Hoy manda `capacidad_maxima` (la suma de mesas no valida nada: la migración
// 20260926120000_capacidad_efectiva_mesas.sql está dormida y sin aplicar), así
// que este módulo solo INFORMA del descuadre. Estos tests fijan las cifras que
// enseña la pantalla de Configuración de /reservas.

const espacio = (o: Partial<EspacioParaCuadre> = {}): EspacioParaCuadre => ({
  id: "salon",
  nombre: "Salón",
  capacidad_maxima: 50,
  activa: true,
  ...o,
});

/** Mesas iguales (el caso normal: mesas de 4 en un salón). */
const mesas = (espacioId: string, cuantas: number, capacidad: number): MesaParaCuadre[] =>
  Array.from({ length: cuantas }, (_, i) => ({
    id: `${espacioId}-m${i}`,
    espacio_id: espacioId,
    capacidad,
    activa: true,
  }));

describe("plazasDeMesas", () => {
  it("suma la capacidad de las mesas del espacio", () => {
    const lista: MesaParaCuadre[] = [
      { id: "1", espacio_id: "comedor", capacidad: 2, activa: true },
      { id: "2", espacio_id: "comedor", capacidad: 4, activa: true },
      { id: "3", espacio_id: "comedor", capacidad: 6, activa: true },
    ];
    expect(plazasDeMesas(lista, "comedor")).toBe(12);
  });

  it("ignora las mesas inactivas y las de otros espacios", () => {
    const lista: MesaParaCuadre[] = [
      { id: "1", espacio_id: "comedor", capacidad: 4, activa: true },
      { id: "2", espacio_id: "comedor", capacidad: 100, activa: false },
      { id: "3", espacio_id: "salon", capacidad: 50, activa: true },
    ];
    expect(plazasDeMesas(lista, "comedor")).toBe(4);
    expect(plazasDeMesas(lista, "salon")).toBe(50);
  });

  it("activa null / sin el campo cuenta como activa (columna DEFAULT true)", () => {
    const lista: MesaParaCuadre[] = [
      { id: "1", espacio_id: "comedor", capacidad: 4, activa: null },
      { id: "2", espacio_id: "comedor", capacidad: 4, activa: undefined },
      { id: "3", espacio_id: "comedor", capacidad: 4 },
    ];
    expect(plazasDeMesas(lista, "comedor")).toBe(12);
  });

  it("capacidad null / NaN / Infinity / negativa / no numérica cuenta 0, nunca resta", () => {
    const lista = [
      { id: "1", espacio_id: "comedor", capacidad: 4 },
      { id: "2", espacio_id: "comedor", capacidad: null },
      { id: "3", espacio_id: "comedor", capacidad: Number.NaN },
      { id: "4", espacio_id: "comedor", capacidad: Number.POSITIVE_INFINITY },
      { id: "5", espacio_id: "comedor", capacidad: -10 },
      { id: "6", espacio_id: "comedor", capacidad: "cuatro" as unknown as number },
      { id: "7", espacio_id: "comedor", capacidad: undefined as unknown as number },
    ] satisfies MesaParaCuadre[];
    expect(plazasDeMesas(lista, "comedor")).toBe(4);
  });

  it("espacio sin mesas, lista vacía y lista null dan 0", () => {
    expect(plazasDeMesas(mesas("salon", 3, 4), "comedor")).toBe(0);
    expect(plazasDeMesas([], "comedor")).toBe(0);
    expect(plazasDeMesas(null as unknown as MesaParaCuadre[], "comedor")).toBe(0);
  });
});

describe("calcularCuadreEspacio: los cuatro estados", () => {
  it("cuadra cuando la suma de mesas es igual a la capacidad declarada", () => {
    const c = calcularCuadreEspacio(espacio({ capacidad_maxima: 48 }), mesas("salon", 12, 4));
    expect(c).toMatchObject({
      capacidadDeclarada: 48,
      plazasMesas: 48,
      mesasActivas: 12,
      mesasInactivas: 0,
      diferencia: 0,
      estado: "cuadra",
      descuadra: false,
    });
  });

  it("por_encima cuando las mesas suman más que lo declarado (diferencia positiva)", () => {
    const c = calcularCuadreEspacio(espacio({ capacidad_maxima: 50 }), mesas("salon", 16, 4));
    expect(c).toMatchObject({ plazasMesas: 64, diferencia: 14, estado: "por_encima", descuadra: true });
  });

  it("por_debajo cuando las mesas suman menos que lo declarado (diferencia negativa)", () => {
    const c = calcularCuadreEspacio(espacio({ capacidad_maxima: 50 }), mesas("salon", 2, 2));
    expect(c).toMatchObject({ plazasMesas: 4, diferencia: -46, estado: "por_debajo", descuadra: true });
  });

  it("sin_mesas cuando no hay ninguna mesa activa", () => {
    const c = calcularCuadreEspacio(espacio({ id: "reservado", nombre: "Reservado", capacidad_maxima: 20 }), []);
    expect(c).toMatchObject({
      capacidadDeclarada: 20,
      plazasMesas: 0,
      mesasActivas: 0,
      diferencia: -20,
      estado: "sin_mesas",
      descuadra: true,
    });
    // Tolera que no lleguen mesas (null) igual que una lista vacía.
    expect(calcularCuadreEspacio(espacio(), null as unknown as MesaParaCuadre[]).estado).toBe("sin_mesas");
  });

  it("sin_mesas manda sobre por_debajo: mesas dadas de baja no son 'faltan plazas'", () => {
    const c = calcularCuadreEspacio(espacio({ id: "terraza", nombre: "Terraza", capacidad_maxima: 20 }), [
      { id: "1", espacio_id: "terraza", capacidad: 4, activa: false },
      { id: "2", espacio_id: "terraza", capacidad: 6, activa: false },
    ]);
    expect(c.estado).toBe("sin_mesas");
    expect(c.mesasActivas).toBe(0);
    expect(c.mesasInactivas).toBe(2);
    expect(c.plazasMesas).toBe(0);
    expect(c.diferencia).toBe(-20);
  });

  it("una mesa activa con 0 plazas ya NO es sin_mesas (el plano no está vacío)", () => {
    const c = calcularCuadreEspacio(espacio({ capacidad_maxima: 10 }), [
      { id: "1", espacio_id: "salon", capacidad: 0, activa: true },
    ]);
    expect(c).toMatchObject({ mesasActivas: 1, plazasMesas: 0, estado: "por_debajo" });
  });
});

describe("calcularCuadreEspacio: marca y activa", () => {
  it("la marca sale de caracteristicas.marca; sin marca es casa_tomas (como el trigger)", () => {
    expect(calcularCuadreEspacio(espacio({ caracteristicas: { marca: "touza" } }), []).marca).toBe("touza");
    expect(calcularCuadreEspacio(espacio({ caracteristicas: { privada: true } }), []).marca).toBe("casa_tomas");
    expect(calcularCuadreEspacio(espacio({ caracteristicas: null }), []).marca).toBe("casa_tomas");
    expect(calcularCuadreEspacio(espacio(), []).marca).toBe("casa_tomas");
  });

  // Un espacio solo cuenta como activo con `activa === true`, NO con `!== false`.
  // `espacios_reserva.activa` es `boolean DEFAULT true` pero nullable, y la base
  // de datos trata el NULL como apagado en los dos sitios que deciden sobre él:
  // el `WHERE activa = true` del trigger de aforo y el `USING (activa = true)` de
  // su política RLS. Contarlo como activo aquí prometería plazas que el trigger
  // no daría. Las MESAS son el caso contrario (ver los tests de `plazasDeMesas`):
  // ahí nadie filtra con `= true`, así que un NULL sí cuenta.
  it("activa: un espacio sin valor explícito NO cuenta como activo (el trigger exige activa = true)", () => {
    expect(calcularCuadreEspacio(espacio({ activa: true }), []).activa).toBe(true);
    expect(calcularCuadreEspacio(espacio({ activa: false }), []).activa).toBe(false);
    expect(calcularCuadreEspacio(espacio({ activa: null }), []).activa).toBe(false);
    expect(calcularCuadreEspacio(espacio({ activa: undefined }), []).activa).toBe(false);
  });
});

describe("calcularCuadres", () => {
  const ESPACIOS: EspacioParaCuadre[] = [
    espacio({ id: "salon", nombre: "Salón", capacidad_maxima: 50 }),
    espacio({ id: "comedor", nombre: "Comedor", capacidad_maxima: 50 }),
    espacio({ id: "reservado", nombre: "El Reservado", capacidad_maxima: 20, caracteristicas: { marca: "touza" } }),
  ];

  it("devuelve un cuadre por espacio en el mismo orden en que llegan", () => {
    const cuadres = calcularCuadres(ESPACIOS, mesas("salon", 2, 4));
    expect(cuadres.map((c) => c.espacioId)).toEqual(["salon", "comedor", "reservado"]);
    expect(cuadres.map((c) => c.nombre)).toEqual(["Salón", "Comedor", "El Reservado"]);
    expect(cuadres.map((c) => c.marca)).toEqual(["casa_tomas", "casa_tomas", "touza"]);
  });

  it("es pura: no muta ni los espacios ni las mesas que recibe", () => {
    const listaMesas = mesas("salon", 3, 4);
    const copiaEspacios = JSON.parse(JSON.stringify(ESPACIOS));
    const copiaMesas = JSON.parse(JSON.stringify(listaMesas));
    calcularCuadres(Object.freeze(ESPACIOS), Object.freeze(listaMesas));
    expect(ESPACIOS).toEqual(copiaEspacios);
    expect(listaMesas).toEqual(copiaMesas);
  });

  it("tolera listas vacías o ausentes", () => {
    expect(calcularCuadres([], [])).toEqual([]);
    expect(calcularCuadres(null as unknown as EspacioParaCuadre[], [])).toEqual([]);
  });
});

describe("calcularCuadrePorNegocio", () => {
  const cuadresDe = (espacios: EspacioParaCuadre[], listaMesas: MesaParaCuadre[]) =>
    calcularCuadres(espacios, listaMesas);

  it("solo agrega los espacios ACTIVOS (el trigger suma con activa = true)", () => {
    const cuadres = cuadresDe(
      [
        espacio({ id: "salon", capacidad_maxima: 50, activa: true }),
        espacio({ id: "viejo", nombre: "Comedor viejo", capacidad_maxima: 200, activa: false }),
      ],
      mesas("salon", 10, 4),
    );
    const porNegocio = calcularCuadrePorNegocio(cuadres);
    expect(porNegocio).toHaveLength(1);
    // Sin el filtro, lo declarado saldría 250 en vez de 50.
    expect(porNegocio[0]).toMatchObject({
      marca: "casa_tomas",
      capacidadDeclarada: 50,
      plazasMesas: 40,
      diferencia: -10,
    });
  });

  it("ordena casa_tomas, touza y las marcas desconocidas al final por orden alfabético", () => {
    const cuadres = cuadresDe(
      [
        espacio({ id: "p", nombre: "Pulpería", capacidad_maxima: 10, caracteristicas: { marca: "pulperia" } }),
        espacio({ id: "t", nombre: "El Reservado", capacidad_maxima: 20, caracteristicas: { marca: "touza" } }),
        espacio({ id: "b", nombre: "Bodega", capacidad_maxima: 10, caracteristicas: { marca: "bodega" } }),
        espacio({ id: "c", nombre: "Comedor", capacidad_maxima: 50 }),
      ],
      [],
    );
    expect(calcularCuadrePorNegocio(cuadres).map((n) => n.marca)).toEqual([
      "casa_tomas",
      "touza",
      "bodega",
      "pulperia",
    ]);
  });

  it("cuenta espaciosSinMesas y espaciosDescuadrados del negocio", () => {
    const cuadres = cuadresDe(
      [
        espacio({ id: "salon", capacidad_maxima: 40 }), // 40 mesas => cuadra
        espacio({ id: "comedor", nombre: "Comedor", capacidad_maxima: 50 }), // 4 => por_debajo
        espacio({ id: "terraza", nombre: "Terraza", capacidad_maxima: 30 }), // sin mesas
      ],
      [...mesas("salon", 10, 4), ...mesas("comedor", 2, 2)],
    );
    expect(calcularCuadrePorNegocio(cuadres)[0]).toMatchObject({
      capacidadDeclarada: 120,
      plazasMesas: 44,
      diferencia: -76,
      espaciosSinMesas: 1,
      espaciosDescuadrados: 2,
    });
  });

  it("bloquearia solo si TODA la marca se queda a 0 con capacidad declarada", () => {
    // Un espacio a 0 mesas no bloquea nada si un hermano de su marca aporta plazas.
    const conHermano = calcularCuadrePorNegocio(
      cuadresDe(
        [
          espacio({ id: "salon", capacidad_maxima: 50 }),
          espacio({ id: "reservado", nombre: "Reservado", capacidad_maxima: 20 }),
        ],
        mesas("salon", 10, 4),
      ),
    );
    expect(conHermano[0]).toMatchObject({ plazasMesas: 40, espaciosSinMesas: 1, bloquearia: false });

    // Marca entera sin mesas y con capacidad declarada: el trigger daría 0.
    const marcaEnteraVacia = calcularCuadrePorNegocio(
      cuadresDe([espacio({ id: "t", capacidad_maxima: 20, caracteristicas: { marca: "touza" } })], []),
    );
    expect(marcaEnteraVacia[0]).toMatchObject({ marca: "touza", plazasMesas: 0, bloquearia: true });

    // Sin capacidad declarada no hay nada que romper.
    const sinDeclarar = calcularCuadrePorNegocio(cuadresDe([espacio({ capacidad_maxima: 0 })], []));
    expect(sinDeclarar[0]).toMatchObject({ capacidadDeclarada: 0, bloquearia: false });
  });

  it("sin espacios activos devuelve array vacío", () => {
    expect(calcularCuadrePorNegocio([])).toEqual([]);
    expect(calcularCuadrePorNegocio(cuadresDe([espacio({ activa: false })], []))).toEqual([]);
    expect(calcularCuadrePorNegocio(null as unknown as CuadreEspacio[])).toEqual([]);
  });
});

describe("textoEstadoCuadre", () => {
  const conEstado = (capacidad_maxima: number, listaMesas: MesaParaCuadre[]) =>
    textoEstadoCuadre(calcularCuadreEspacio(espacio({ capacidad_maxima }), listaMesas));

  it("da una frase corta por estado", () => {
    expect(conEstado(20, [])).toBe("Sin mesas dadas de alta");
    expect(conEstado(50, mesas("salon", 2, 2))).toBe("Faltan 46 plazas por dar de alta");
    expect(conEstado(50, mesas("salon", 16, 4))).toBe("Sobran 14 plazas sobre la capacidad declarada");
    expect(conEstado(48, mesas("salon", 12, 4))).toBe("Cuadra");
  });

  it("usa singular cuando la diferencia es de una sola plaza", () => {
    expect(conEstado(13, mesas("salon", 3, 4))).toBe("Falta 1 plaza por dar de alta");
    expect(conEstado(11, mesas("salon", 3, 4))).toBe("Sobra 1 plaza sobre la capacidad declarada");
  });
});

describe("escenario real de producción (2026-09-26)", () => {
  // Datos tal cual estaban en la base el día del informe: Casa Tomás declara
  // 170 plazas y solo tiene 80 dadas de alta en mesas; Touza declara 80 y no
  // tiene NINGUNA mesa.
  const ESPACIOS: EspacioParaCuadre[] = [
    { id: "comedor", nombre: "Comedor", capacidad_maxima: 50, activa: true, caracteristicas: {} },
    { id: "salon", nombre: "Salón", capacidad_maxima: 50, activa: true, caracteristicas: null },
    { id: "terraza", nombre: "Terraza", capacidad_maxima: 50, activa: true, caracteristicas: { marca: "casa_tomas" } },
    { id: "reservado", nombre: "Reservado", capacidad_maxima: 20, activa: true, caracteristicas: {} },
    { id: "tz-interior", nombre: "Interior", capacidad_maxima: 30, activa: true, caracteristicas: { marca: "touza" } },
    { id: "tz-terraza", nombre: "Terraza", capacidad_maxima: 30, activa: true, caracteristicas: { marca: "touza" } },
    {
      id: "tz-reservado",
      nombre: "El Reservado",
      capacidad_maxima: 20,
      activa: true,
      caracteristicas: { marca: "touza", privada: true },
    },
  ];
  // Comedor: 2 mesas = 4 plazas. Salón: 15 mesas = 64 (13 de 4 + 2 de 6, una de
  // ellas fusionada en el editor de plano: su fila ya trae la capacidad
  // combinada, no hay que excluir is_merged). Terraza: 3 mesas = 12.
  const MESAS: MesaParaCuadre[] = [
    ...mesas("comedor", 2, 2),
    ...mesas("salon", 13, 4),
    ...mesas("salon-grandes", 2, 6).map((m) => ({ ...m, espacio_id: "salon" })),
    ...mesas("terraza", 3, 4),
  ];

  const cuadres = calcularCuadres(ESPACIOS, MESAS);
  const porId = (id: string) => cuadres.find((c) => c.espacioId === id)!;

  it("cada espacio con su estado y su diferencia", () => {
    expect(cuadres).toHaveLength(7);
    expect(porId("salon")).toMatchObject({ mesasActivas: 15, plazasMesas: 64, diferencia: 14, estado: "por_encima" });
    expect(porId("comedor")).toMatchObject({ mesasActivas: 2, plazasMesas: 4, diferencia: -46, estado: "por_debajo" });
    expect(porId("terraza")).toMatchObject({ mesasActivas: 3, plazasMesas: 12, diferencia: -38, estado: "por_debajo" });
    for (const id of ["reservado", "tz-interior", "tz-terraza", "tz-reservado"]) {
      expect(porId(id)).toMatchObject({ mesasActivas: 0, plazasMesas: 0, estado: "sin_mesas" });
    }
    // Los 7 descuadran: ni uno solo cuadraba el día del informe.
    expect(cuadres.filter((c) => c.descuadra)).toHaveLength(7);
    expect(textoEstadoCuadre(porId("salon"))).toBe("Sobran 14 plazas sobre la capacidad declarada");
  });

  it("agregado por negocio: Casa Tomás 170/80 y Touza 80/0", () => {
    const porNegocio = calcularCuadrePorNegocio(cuadres);
    expect(porNegocio.map((n) => n.marca)).toEqual(["casa_tomas", "touza"]);

    expect(porNegocio[0]).toMatchObject({
      marca: "casa_tomas",
      capacidadDeclarada: 170,
      plazasMesas: 80,
      diferencia: -90,
      espaciosSinMesas: 1,
      espaciosDescuadrados: 4,
      // El restaurante tiene mesas de sobra para seguir reservando.
      bloquearia: false,
    });

    expect(porNegocio[1]).toMatchObject({
      marca: "touza",
      capacidadDeclarada: 80,
      plazasMesas: 0,
      diferencia: -80,
      espaciosSinMesas: 3,
      espaciosDescuadrados: 3,
      // ESTA es la prueba de por qué el dueño quiere la regla DORMIDA: si hoy
      // mandara la suma de las mesas, el trigger calcularía capacidad 0 para
      // Touza y rechazaría todas las reservas de El Reservado (teléfono, web y
      // panel) hasta que alguien dibujase su plano.
      bloquearia: true,
    });
  });
});
