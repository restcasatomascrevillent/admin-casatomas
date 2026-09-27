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
//
// CAMBIO DEL 2026-09-27: las mesas FUSIONADAS (`is_merged = true`) ya NO suman.
// El editor de plano borra las originales sin comprobar el error del DELETE, así
// que en producción conviven la unión y sus originales y sumarlas todas cuenta
// las mismas sillas dos veces (ver la cabecera de `aforoMesas.ts`). El criterio
// es el mismo que el de las funciones SQL `fn_capacidad_efectiva_*`:
// `coalesce(is_merged, false) = false and activa is not false`.

const espacio = (o: Partial<EspacioParaCuadre> = {}): EspacioParaCuadre => ({
  id: "salon",
  nombre: "Salón",
  capacidad_maxima: 50,
  activa: true,
  ...o,
});

/** Mesas reales iguales (el caso normal: mesas de 4 en un salón). */
const mesas = (espacioId: string, cuantas: number, capacidad: number): MesaParaCuadre[] =>
  Array.from({ length: cuantas }, (_, i) => ({
    id: `${espacioId}-m${i}`,
    espacio_id: espacioId,
    capacidad,
    activa: true,
  }));

/** Filas de UNIÓN: las que crea el editor al juntar mesas. No aportan aforo. */
const uniones = (espacioId: string, cuantas: number, capacidad: number): MesaParaCuadre[] =>
  Array.from({ length: cuantas }, (_, i) => ({
    id: `${espacioId}-u${i}`,
    espacio_id: espacioId,
    capacidad,
    activa: true,
    is_merged: true,
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

  it("ignora las mesas FUSIONADAS: sus plazas ya las aportan las originales", () => {
    const lista: MesaParaCuadre[] = [
      { id: "1", espacio_id: "salon", capacidad: 4, activa: true },
      { id: "2", espacio_id: "salon", capacidad: 4, activa: true },
      // Unión de las dos anteriores. El editor debería haberlas borrado y no lo
      // hizo (DELETE sin comprobar error): si sumáramos esta fila, el salón
      // pasaría de 8 plazas reales a 16 inventadas.
      { id: "3", espacio_id: "salon", capacidad: 8, activa: true, is_merged: true },
    ];
    expect(plazasDeMesas(lista, "salon")).toBe(8);
  });

  it("is_merged null / undefined / sin el campo cuenta como mesa REAL (columna nullable)", () => {
    const lista: MesaParaCuadre[] = [
      { id: "1", espacio_id: "comedor", capacidad: 4, is_merged: null },
      { id: "2", espacio_id: "comedor", capacidad: 4, is_merged: undefined },
      { id: "3", espacio_id: "comedor", capacidad: 4, is_merged: false },
      { id: "4", espacio_id: "comedor", capacidad: 4 },
    ];
    expect(plazasDeMesas(lista, "comedor")).toBe(16);
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

describe("calcularCuadreEspacio: los cinco estados", () => {
  it("cuadra cuando la suma de mesas es igual a la capacidad declarada", () => {
    const c = calcularCuadreEspacio(espacio({ capacidad_maxima: 48 }), mesas("salon", 12, 4));
    expect(c).toMatchObject({
      capacidadDeclarada: 48,
      plazasMesas: 48,
      plazasFusionadas: 0,
      mesasActivas: 12,
      mesasReales: 12,
      mesasFusionadas: 0,
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
      mesasReales: 0,
      mesasFusionadas: 0,
      diferencia: -20,
      estado: "sin_mesas",
      descuadra: true,
    });
    // Tolera que no lleguen mesas (null) igual que una lista vacía.
    expect(calcularCuadreEspacio(espacio(), null as unknown as MesaParaCuadre[]).estado).toBe("sin_mesas");
  });

  it("solo_fusionadas: hay filas activas pero TODAS son uniones, así que no hay aforo real", () => {
    // Caso Terraza (ver el escenario de producción del 2026-09-27): 3 filas
    // vivas, las 3 uniones, cero mesas reales. No es "plano vacío"
    // (`sin_mesas`) ni "faltan plazas" (`por_debajo`): se perdieron las
    // originales al fusionarlas y hay que volver a darlas de alta.
    const c = calcularCuadreEspacio(
      espacio({ id: "terraza", nombre: "Terraza", capacidad_maxima: 50 }),
      uniones("terraza", 3, 4),
    );
    expect(c).toMatchObject({
      capacidadDeclarada: 50,
      plazasMesas: 0,
      plazasFusionadas: 12,
      mesasActivas: 3,
      mesasReales: 0,
      mesasFusionadas: 3,
      mesasInactivas: 0,
      diferencia: -50,
      estado: "solo_fusionadas",
      descuadra: true,
    });
  });

  it("una sola mesa real basta para salir de solo_fusionadas", () => {
    const c = calcularCuadreEspacio(espacio({ capacidad_maxima: 50 }), [
      ...uniones("salon", 3, 4),
      ...mesas("salon", 1, 2),
    ]);
    expect(c).toMatchObject({
      plazasMesas: 2,
      plazasFusionadas: 12,
      mesasActivas: 4,
      mesasReales: 1,
      mesasFusionadas: 3,
      estado: "por_debajo",
    });
  });

  it("una unión DESACTIVADA no cuenta ni como activa ni en plazasFusionadas", () => {
    const c = calcularCuadreEspacio(espacio({ capacidad_maxima: 8 }), [
      ...mesas("salon", 2, 4),
      { id: "u", espacio_id: "salon", capacidad: 8, activa: false, is_merged: true },
    ]);
    expect(c).toMatchObject({
      plazasMesas: 8,
      plazasFusionadas: 0,
      mesasActivas: 2,
      mesasReales: 2,
      mesasFusionadas: 0,
      mesasInactivas: 1,
      estado: "cuadra",
    });
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

  it("una mesa real activa con 0 plazas ya NO es sin_mesas (el plano no está vacío)", () => {
    const c = calcularCuadreEspacio(espacio({ capacidad_maxima: 10 }), [
      { id: "1", espacio_id: "salon", capacidad: 0, activa: true },
    ]);
    expect(c).toMatchObject({ mesasActivas: 1, mesasReales: 1, plazasMesas: 0, estado: "por_debajo" });
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
  // ahí el SQL filtra con `activa is not false`, así que un NULL sí cuenta.
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
    const listaMesas = [...mesas("salon", 3, 4), ...uniones("salon", 1, 8)];
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

  it("agrega las plazas REALES, no las de las uniones", () => {
    const cuadres = cuadresDe([espacio({ id: "salon", capacidad_maxima: 50 })], [
      ...mesas("salon", 8, 4),
      ...uniones("salon", 4, 8),
    ]);
    expect(calcularCuadrePorNegocio(cuadres)[0]).toMatchObject({
      capacidadDeclarada: 50,
      plazasMesas: 32,
      plazasFusionadas: 32,
      diferencia: -18,
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
        espacio({ id: "salon", capacidad_maxima: 40 }), // 40 plazas => cuadra
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
      espaciosSoloFusionadas: 0,
      espaciosDescuadrados: 2,
    });
  });

  it("espaciosSinMesas cuenta también los que solo tienen uniones; espaciosSoloFusionadas los separa", () => {
    // Para el aforo "plano vacío" y "solo uniones" son lo mismo: cero plazas.
    // Se separan porque el arreglo es distinto (dibujar el plano vs. rehacer
    // las mesas que se perdieron al fusionarlas).
    const cuadres = cuadresDe(
      [
        espacio({ id: "terraza", nombre: "Terraza", capacidad_maxima: 50 }),
        espacio({ id: "reservado", nombre: "Reservado", capacidad_maxima: 20 }),
        espacio({ id: "salon", capacidad_maxima: 50 }),
      ],
      [...uniones("terraza", 3, 4), ...mesas("salon", 9, 4)],
    );
    expect(calcularCuadrePorNegocio(cuadres)[0]).toMatchObject({
      capacidadDeclarada: 120,
      plazasMesas: 36,
      plazasFusionadas: 12,
      espaciosSinMesas: 2,
      espaciosSoloFusionadas: 1,
      espaciosDescuadrados: 3,
      bloquearia: false,
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

    // Y bloquearía IGUAL una marca cuyas salas solo tengan uniones: las plazas
    // de las uniones no son plazas, y `fn_capacidad_efectiva_marca` también las
    // excluye. Con el cálculo viejo (que sumaba las fusionadas) esto salía
    // `bloquearia: false` y era mentira.
    const marcaSoloUniones = calcularCuadrePorNegocio(
      cuadresDe(
        [espacio({ id: "t", capacidad_maxima: 20, caracteristicas: { marca: "touza" } })],
        uniones("t", 2, 6),
      ),
    );
    expect(marcaSoloUniones[0]).toMatchObject({
      marca: "touza",
      plazasMesas: 0,
      plazasFusionadas: 12,
      espaciosSoloFusionadas: 1,
      bloquearia: true,
    });

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

  it("distingue 'solo uniones' de 'sin mesas' y dice cuántas uniones hay", () => {
    expect(conEstado(50, uniones("salon", 3, 4))).toBe("Sin mesas reales: sus 3 mesas son uniones");
    expect(conEstado(50, uniones("salon", 1, 8))).toBe("Sin mesas reales: su única mesa es una unión");
  });

  it("usa singular cuando la diferencia es de una sola plaza", () => {
    expect(conEstado(13, mesas("salon", 3, 4))).toBe("Falta 1 plaza por dar de alta");
    expect(conEstado(11, mesas("salon", 3, 4))).toBe("Sobra 1 plaza sobre la capacidad declarada");
  });
});

describe("escenario real de producción (2026-09-27)", () => {
  // DATOS REALES DE PRODUCCIÓN VERIFICADOS EL 27/09/2026: 20 filas en `mesas`.
  // Las uniones se guardan como filas propias con `is_merged = true` y nombres
  // compuestos ("2+1", "3+4", "11+10", "13+12", "15+14") y sus originales
  // SIGUEN VIVAS, porque el editor de plano las borra sin comprobar el error
  // del DELETE (`EditorPlanoEspacio.tsx` ~551 y ~583).
  //
  //   Espacio   Declarada  Filas  Fusionadas  Suma de TODAS  Suma REAL
  //   Comedor       50       2         0            4            4
  //   Salón         50      15         7           64           36
  //   Terraza       50       3         3           12            0   ← sin mesas reales
  //
  // Terraza sale a 0 y ESO ES LO CORRECTO: su plano está roto y hay que volver
  // a dar de alta las mesas. No se maquilla.
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
  const MESAS: MesaParaCuadre[] = [
    // Comedor: 2 mesas reales de 2 = 4 plazas. (Una de ellas se llama "o" en
    // producción: un tecleo suelto. Para el aforo da igual, para el número no.)
    ...mesas("comedor", 2, 2),
    // Salón: 8 mesas reales (6 de 4 + 2 de 6 = 36) + 7 uniones de 4 = 28.
    // 15 filas, 64 plazas si se suman todas, 36 reales.
    ...mesas("salon", 6, 4),
    ...mesas("salon-grandes", 2, 6).map((m) => ({ ...m, espacio_id: "salon" })),
    ...uniones("salon", 7, 4),
    // Terraza: 3 filas y las 3 son uniones. Cero mesas reales.
    ...uniones("terraza", 3, 4),
  ];

  const cuadres = calcularCuadres(ESPACIOS, MESAS);
  const porId = (id: string) => cuadres.find((c) => c.espacioId === id)!;

  it("las 20 filas del fixture son las de producción", () => {
    expect(MESAS).toHaveLength(20);
  });

  it("Salón: 15 filas, 7 uniones, 64 plazas si se suman todas pero 36 reales", () => {
    const salon = porId("salon");
    expect(salon).toMatchObject({
      capacidadDeclarada: 50,
      mesasActivas: 15,
      mesasReales: 8,
      mesasFusionadas: 7,
      plazasMesas: 36,
      plazasFusionadas: 28,
      diferencia: -14,
      estado: "por_debajo",
    });
    // El número viejo (el que enseñaba la pantalla antes del 2026-09-27) era la
    // suma de TODAS las filas: 36 + 28 = 64, con 14 plazas de más inventadas.
    expect(salon.plazasMesas + salon.plazasFusionadas).toBe(64);
    expect(textoEstadoCuadre(salon)).toBe("Faltan 14 plazas por dar de alta");
  });

  it("Terraza: 3 filas, las 3 uniones → 12 plazas aparentes, 0 reales y estado solo_fusionadas", () => {
    const terraza = porId("terraza");
    expect(terraza).toMatchObject({
      capacidadDeclarada: 50,
      mesasActivas: 3,
      mesasReales: 0,
      mesasFusionadas: 3,
      plazasMesas: 0,
      plazasFusionadas: 12,
      diferencia: -50,
      estado: "solo_fusionadas",
      descuadra: true,
    });
    expect(textoEstadoCuadre(terraza)).toBe("Sin mesas reales: sus 3 mesas son uniones");
  });

  it("Comedor: sin uniones, 2 mesas y 4 plazas (el cambio no le afecta)", () => {
    expect(porId("comedor")).toMatchObject({
      mesasActivas: 2,
      mesasReales: 2,
      mesasFusionadas: 0,
      plazasMesas: 4,
      plazasFusionadas: 0,
      diferencia: -46,
      estado: "por_debajo",
    });
  });

  it("los espacios sin ninguna fila siguen en sin_mesas", () => {
    expect(cuadres).toHaveLength(7);
    for (const id of ["reservado", "tz-interior", "tz-terraza", "tz-reservado"]) {
      expect(porId(id)).toMatchObject({ mesasActivas: 0, mesasReales: 0, plazasMesas: 0, estado: "sin_mesas" });
    }
    // Los 7 descuadran: ni uno solo cuadraba el día del informe.
    expect(cuadres.filter((c) => c.descuadra)).toHaveLength(7);
  });

  it("agregado por negocio: Casa Tomás 170 declaradas y solo 40 plazas reales; Touza 80/0", () => {
    const porNegocio = calcularCuadrePorNegocio(cuadres);
    expect(porNegocio.map((n) => n.marca)).toEqual(["casa_tomas", "touza"]);

    expect(porNegocio[0]).toMatchObject({
      marca: "casa_tomas",
      capacidadDeclarada: 170,
      // 4 (Comedor) + 36 (Salón) + 0 (Terraza) + 0 (Reservado). Con el cálculo
      // viejo salían 80: 40 plazas de más, la mitad del aforo inventada.
      plazasMesas: 40,
      plazasFusionadas: 40,
      diferencia: -130,
      espaciosSinMesas: 2,
      espaciosSoloFusionadas: 1,
      espaciosDescuadrados: 4,
      // El restaurante sigue teniendo mesas reales, así que no se quedaría a 0.
      bloquearia: false,
    });

    expect(porNegocio[1]).toMatchObject({
      marca: "touza",
      capacidadDeclarada: 80,
      plazasMesas: 0,
      plazasFusionadas: 0,
      diferencia: -80,
      espaciosSinMesas: 3,
      espaciosSoloFusionadas: 0,
      espaciosDescuadrados: 3,
      // ESTA es la prueba de por qué el dueño quiere la regla DORMIDA: si hoy
      // mandara la suma de las mesas, el trigger calcularía capacidad 0 para
      // Touza y rechazaría todas las reservas de El Reservado (teléfono, web y
      // panel) hasta que alguien dibujase su plano.
      bloquearia: true,
    });
  });
});
