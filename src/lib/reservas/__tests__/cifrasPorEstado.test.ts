/**
 * Cifras por estado de «Cómo avanza una reserva» (`cifrasPorEstado.ts`), lógica pura.
 *
 * QUÉ SE FIJA
 * ----------------------------------------------------------------------------
 * · `contarPorEstado`: el recuento que ya hacía el timeline de la pestaña Hoy
 *   (ahora vive aquí para que Hoy y Lista cuenten igual): una cifra por cada uno de
 *   los seis estados, los que no son de los seis no cuentan, sin datos no hay cifras.
 * · `cifrasDeLaLista`: las cifras de la pestaña Lista. Cuentan las RESERVAS que
 *   pasan los filtros de la lista (fecha, búsqueda y canal) y NO el de estado: así,
 *   al filtrar por un estado, los otros cinco siguen mostrando su cifra. La
 *   propiedad que importa: la cifra de un estado es EXACTAMENTE el número de filas
 *   de reserva de Casa Tomás que la lista enseña al filtrar por ese estado (se
 *   comprueba contra `filtrarFilasUnificadas`, el filtro de la propia lista).
 * · TOUZA NO ADMITE RESERVAS (decisión del dueño, 2026-10-01): las reservas de
 *   `marca = 'touza'` no cuentan nunca, con cualquier filtro, y la lista tampoco las
 *   enseña: la regla es la común, `admiteReservas` (negocios.ts), aplicada en
 *   `unificarReservasYSolicitudes`. Ya no hay filtro «Negocio» en la lista.
 * · `alcanceCifrasDeLaLista`: cómo se rotulan esas cifras («cifras de la lista»,
 *   «…de hoy», «…del 3 oct 2026»), y el aviso de que el filtro de estado no cuenta.
 * · `cifraPorAtender` (2026-10-05): la cifra del botón «Por atender». Se cuenta como
 *   las del timeline (sin el filtro de estado) pero con las solicitudes sin resolver:
 *   es EXACTAMENTE el número de filas que la lista enseña al pulsar el botón.
 */
import { describe, it, expect } from "vitest";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import type { SolicitudPendiente } from "@/hooks/useSolicitudesPendientes";
import { ALCANCE_HOY, alcanceCifrasDeLaLista, cifraPorAtender, cifrasDeLaLista, contarPorEstado } from "../cifrasPorEstado";
import { admiteReservas } from "../negocios";
import {
  FILTRO_POR_ATENDER,
  FILTRO_SOLICITUDES,
  FILTRO_SOLICITUDES_CERRADAS,
  filtrarFilasUnificadas,
  unificarReservasYSolicitudes,
  type FiltrosListaUnificada,
  type ReservaListable,
} from "../vistaUnificada";
import { ORDEN_ESTADOS } from "../estadosReserva";

const reserva = (id: string, estado: string, o: Partial<ReservaListable> = {}): ReservaListable => ({
  id,
  fecha: "2026-10-01",
  hora: "21:00:00",
  nombre: `Cliente ${id}`,
  telefono: "600000000",
  email: null,
  estado,
  canal: "web",
  numero_comensales: 2,
  notas_cliente: null,
  marca: "casa_tomas",
  ...o,
});

/**
 * Una reserva de cada estado, repartidas en tres días y tres canales, más dos que NO cuentan: una de Touza
 * («c», una confirmada: Touza no admite reservas) y una con un estado que no existe («h»).
 */
const LISTA: ReservaListable[] = [
  reserva("a", "pendiente", { nombre: "Ana Pendiente", canal: "telefono" }),
  reserva("b", "verificada", { nombre: "Berta Verificada" }),
  reserva("c", "confirmada", { nombre: "Carlos Touza", marca: "touza" }),
  reserva("d", "completada", { nombre: "Elena Llegó", canal: "manual" }),
  reserva("e", "confirmada", { nombre: "Fede Segundodia", fecha: "2026-10-02", canal: "telefono", telefono: "611222333" }),
  reserva("f", "cancelada", { nombre: "Gema Cancelada", fecha: "2026-10-02" }),
  // Sin canal: la lista lo trata como «web».
  reserva("g", "no_show", { nombre: "Hugo NoVino", fecha: "2026-10-03", canal: null }),
  // Un estado que no existe (el CHECK no lo permite): pasa los filtros de la lista, pero no cuenta en ningún estado.
  reserva("h", "rechazada", { nombre: "Ines Rara" }),
];

const CERO = { pendiente: 0, verificada: 0, confirmada: 0, completada: 0, cancelada: 0, no_show: 0 };
const con = (o: Partial<typeof CERO>) => ({ ...CERO, ...o });

describe("contarPorEstado", () => {
  const filas = (estado: string, cuantas: number) => Array.from({ length: cuantas }, () => ({ estado }));

  it("sin reservas (cargando, o con error) no hay cifras: mejor nada que un 0 falso", () => {
    expect(contarPorEstado(undefined)).toBeNull();
    expect(contarPorEstado(null)).toBeNull();
    expect(contarPorEstado(null, 4)).toBeNull();
  });

  it("una cifra por cada uno de los seis estados", () => {
    expect(
      contarPorEstado([
        ...filas("pendiente", 2),
        ...filas("confirmada", 3),
        ...filas("completada", 1),
        ...filas("no_show", 1),
        ...filas("cancelada", 5),
      ]),
    ).toEqual(con({ pendiente: 2, confirmada: 3, completada: 1, no_show: 1, cancelada: 5 }));
  });

  it("una lista vacía son seis ceros (dato real, no ausencia de dato)", () => {
    expect(contarPorEstado([])).toEqual(CERO);
  });

  it("un estado que no es de los seis no cuenta en ninguno", () => {
    expect(contarPorEstado([...filas("rechazada", 2), ...filas("confirmada", 1)])).toEqual(con({ confirmada: 1 }));
  });

  it("`canceladas`, si llega, manda sobre las filas (Hoy no trae las canceladas en la consulta)", () => {
    expect(contarPorEstado([...filas("pendiente", 1), ...filas("cancelada", 9)], 4)).toEqual(
      con({ pendiente: 1, cancelada: 4 }),
    );
    expect(contarPorEstado([], 0)).toEqual(CERO);
  });

  it("sin `canceladas` (o `null`) la cifra de canceladas sale de las propias filas (la Lista sí las trae)", () => {
    expect(contarPorEstado(filas("cancelada", 3))).toEqual(con({ cancelada: 3 }));
    expect(contarPorEstado(filas("cancelada", 3), null)).toEqual(con({ cancelada: 3 }));
  });
});

describe("cifrasDeLaLista", () => {
  it("sin filtros cuenta las reservas de Casa Tomás por estado, canceladas incluidas", () => {
    expect(cifrasDeLaLista(LISTA, {})).toEqual(
      con({ pendiente: 1, verificada: 1, confirmada: 1, completada: 1, cancelada: 1, no_show: 1 }),
    );
  });

  it("una lista vacía son seis ceros", () => {
    expect(cifrasDeLaLista([], { busqueda: "nadie" })).toEqual(CERO);
  });

  it("el filtro de ESTADO no recorta nada: sea cual sea su valor, las cifras son las de «Todos»", () => {
    const todos = cifrasDeLaLista(LISTA, { estado: "all" });
    for (const estado of [...ORDEN_ESTADOS, FILTRO_SOLICITUDES, FILTRO_SOLICITUDES_CERRADAS, "valor-raro"]) {
      expect(cifrasDeLaLista(LISTA, { estado }), estado).toEqual(todos);
    }
  });

  it("sigue el filtro de fecha", () => {
    // El 1 de octubre hay además una reserva de Touza («c»), que no cuenta.
    expect(cifrasDeLaLista(LISTA, { fecha: "2026-10-01" })).toEqual(
      con({ pendiente: 1, verificada: 1, completada: 1 }),
    );
    expect(cifrasDeLaLista(LISTA, { fecha: "2026-10-02" })).toEqual(con({ confirmada: 1, cancelada: 1 }));
    expect(cifrasDeLaLista(LISTA, { fecha: "2030-01-01" })).toEqual(CERO);
  });

  it("sigue la búsqueda (nombre, teléfono, email o notas; sin distinguir mayúsculas)", () => {
    expect(cifrasDeLaLista(LISTA, { busqueda: "BERTA" })).toEqual(con({ verificada: 1 }));
    expect(cifrasDeLaLista(LISTA, { busqueda: "611222" })).toEqual(con({ confirmada: 1 }));
    expect(cifrasDeLaLista(LISTA, { busqueda: "  hugo  " })).toEqual(con({ no_show: 1 }));
    expect(cifrasDeLaLista(LISTA, { busqueda: "cliente-que-no-existe" })).toEqual(CERO);
  });

  it("sigue el canal (una reserva sin canal cuenta como «web», igual que en la lista)", () => {
    expect(cifrasDeLaLista(LISTA, { canal: "telefono" })).toEqual(con({ pendiente: 1, confirmada: 1 }));
    expect(cifrasDeLaLista(LISTA, { canal: "manual" })).toEqual(con({ completada: 1 }));
    // «c» (Touza, web) no cuenta; «g» (sin canal) sí, como «web».
    expect(cifrasDeLaLista(LISTA, { canal: "web" })).toEqual(con({ verificada: 1, cancelada: 1, no_show: 1 }));
  });

  it("los filtros se combinan: cuenta lo que cumple todos a la vez", () => {
    expect(cifrasDeLaLista(LISTA, { fecha: "2026-10-02", canal: "telefono" })).toEqual(con({ confirmada: 1 }));
    expect(cifrasDeLaLista(LISTA, { fecha: "2026-10-01", canal: "manual", busqueda: "elena" })).toEqual(
      con({ completada: 1 }),
    );
    // Con un filtro de estado puesto además, no cambia nada: es justo lo que se pide.
    expect(cifrasDeLaLista(LISTA, { fecha: "2026-10-02", canal: "telefono", estado: "cancelada" })).toEqual(
      con({ confirmada: 1 }),
    );
  });

  describe("TOUZA NO ADMITE RESERVAS: las de otro negocio que Casa Tomás no cuentan", () => {
    const deTouza = (id: string, estado: string, o: Partial<ReservaListable> = {}) =>
      reserva(id, estado, { marca: "touza", ...o });

    it("no cuentan en ningún estado, con o sin filtros", () => {
      const soloTouza = [deTouza("t1", "pendiente"), deTouza("t2", "confirmada"), deTouza("t3", "cancelada")];

      expect(cifrasDeLaLista(soloTouza, {})).toEqual(CERO);
      expect(cifrasDeLaLista(soloTouza, { fecha: "2026-10-01", canal: "web", busqueda: "cliente" })).toEqual(CERO);
    });

    it("mezcladas con las de Casa Tomás, las cifras son las mismas que sin ellas", () => {
      const casaTomas = [reserva("a", "pendiente"), reserva("b", "confirmada"), reserva("c", "confirmada")];
      const conTouza = [...casaTomas, deTouza("t1", "pendiente"), deTouza("t2", "no_show"), deTouza("t3", "confirmada")];

      expect(cifrasDeLaLista(conTouza, {})).toEqual(cifrasDeLaLista(casaTomas, {}));
      expect(cifrasDeLaLista(conTouza, {})).toEqual(con({ pendiente: 1, confirmada: 2 }));
      expect(cifrasDeLaLista(conTouza, { busqueda: "t" })).toEqual(cifrasDeLaLista(casaTomas, { busqueda: "t" }));
    });

    it("una reserva SIN marca (vacía, ausente o null) es de Casa Tomás y sí cuenta", () => {
      const sinMarca = [
        reserva("a", "pendiente", { marca: null }),
        reserva("b", "pendiente", { marca: "" }),
        reserva("c", "pendiente", { marca: undefined }),
        reserva("d", "pendiente", { marca: "casa_tomas" }),
      ];

      expect(cifrasDeLaLista(sinMarca, {})).toEqual(con({ pendiente: 4 }));
    });

    // Touza no admite reservas (decisión del dueño 2026-10-01): antes la regla era el filtro local `esDeCasaTomas`.
    it("la regla es la común, `admiteReservas` (el único sitio donde se decide), para cualquier marca", () => {
      for (const marca of ["casa_tomas", "touza", "otra", "", null, undefined]) {
        const cuenta = cifrasDeLaLista([reserva("x", "pendiente", { marca })], {}).pendiente === 1;
        expect(cuenta, String(marca)).toBe(admiteReservas(marca));
      }
    });
  });

  describe("coherencia con la lista (el filtro de la propia lista, `filtrarFilasUnificadas`)", () => {
    // Touza no admite reservas (decisión del dueño 2026-10-01): la lista ya no tiene filtro «Negocio» ni enseña
    // las filas de Touza, así que cifras y filas cuadran SIEMPRE (antes la tabla podía tener alguna fila más).
    const filtros: Record<string, FiltrosListaUnificada> = {
      "sin filtros": {},
      "un día": { fecha: "2026-10-02" },
      "una búsqueda": { busqueda: "e" },
      "un canal": { canal: "telefono" },
      "día + canal": { fecha: "2026-10-01", canal: "web" },
      "todo a la vez": { fecha: "2026-10-01", canal: "web", busqueda: "ber" },
    };
    /** Las filas de RESERVA que la lista enseña con esos filtros (todas de Casa Tomás: ver el test siguiente). */
    const reservasQueEnseña = (f: FiltrosListaUnificada) =>
      filtrarFilasUnificadas(unificarReservasYSolicitudes(LISTA, []), f).filter((fila) => fila.tipo === "reserva");

    it("la lista no enseña la reserva de Touza («c») con ningún filtro", () => {
      for (const f of Object.values(filtros)) {
        const filas = reservasQueEnseña({ ...f, estado: "all" });
        expect(filas.every((fila) => fila.tipo === "reserva" && admiteReservas(fila.reserva.marca))).toBe(true);
        expect(filas.some((fila) => fila.id === "c")).toBe(false);
      }
    });

    for (const [nombre, f] of Object.entries(filtros)) {
      it(`${nombre}: la cifra de cada estado es las filas que la lista enseña al filtrar por ese estado`, () => {
        const cifras = cifrasDeLaLista(LISTA, f);
        for (const estado of ORDEN_ESTADOS) {
          expect(cifras[estado], estado).toBe(reservasQueEnseña({ ...f, estado }).length);
        }
      });

      it(`${nombre}: las seis cifras suman las reservas que enseña «Todos» (salvo los estados que no existen)`, () => {
        const cifras = cifrasDeLaLista(LISTA, f);
        const suma = Object.values(cifras).reduce((a, b) => a + b, 0);
        const conocidas = reservasQueEnseña({ ...f, estado: "all" }).filter(
          (fila) => fila.tipo === "reserva" && (ORDEN_ESTADOS as readonly string[]).includes(fila.reserva.estado),
        );
        expect(suma).toBe(conocidas.length);
      });
    }
  });

  it("no toca lo que recibe", () => {
    const copia = JSON.parse(JSON.stringify(LISTA));
    const filtros = { busqueda: "a", estado: "pendiente" };
    cifrasDeLaLista(LISTA, filtros);
    expect(LISTA).toEqual(copia);
    expect(filtros).toEqual({ busqueda: "a", estado: "pendiente" });
  });
});

describe("cifraPorAtender (el botón «Por atender»)", () => {
  const solicitud = (id: string, estado: string, o: Partial<SolicitudPendiente> = {}): SolicitudPendiente => ({
    id,
    nombre: `Solicitud ${id}`,
    telefono: "699000000",
    email: null,
    fecha_solicitada: "2026-10-01",
    hora_solicitada: "14:00",
    numero_comensales: 12,
    notas_cliente: null,
    motivo_rechazo: "grupo_grande",
    descripcion_rechazo: null,
    estado,
    notas_internas: null,
    created_at: null,
    updated_at: null,
    marca: "casa_tomas",
    ...o,
  });
  /** Dos sin resolver (pendiente, contactado), dos cerradas y una de Touza sin resolver (no cuenta). */
  const SOLICITUDES: SolicitudPendiente[] = [
    solicitud("s1", "pendiente", { nombre: "Familia Navarro" }),
    solicitud("s2", "contactado", { fecha_solicitada: "2026-10-02" }),
    solicitud("s3", "resuelta"),
    solicitud("s4", "descartada"),
    solicitud("s5", "pendiente", { marca: "touza" }),
  ];

  it("sin filtros: las reservas `pendiente` MÁS las solicitudes sin resolver (ni otros estados, ni cerradas, ni Touza)", () => {
    // LISTA: una pendiente de Casa Tomás («a»). SOLICITUDES: dos sin resolver de Casa Tomás.
    expect(cifraPorAtender(LISTA, SOLICITUDES, {})).toBe(3);
    expect(cifraPorAtender(LISTA, [], {})).toBe(1);
    expect(cifraPorAtender([], SOLICITUDES, {})).toBe(2);
  });

  it("sin nada por atender es 0 (dato real)", () => {
    expect(cifraPorAtender([reserva("x", "confirmada")], [solicitud("y", "resuelta")], {})).toBe(0);
    expect(cifraPorAtender([], [], {})).toBe(0);
  });

  it("el filtro de ESTADO no la cambia, sea cual sea (como las cifras del timeline)", () => {
    const todos = cifraPorAtender(LISTA, SOLICITUDES, {});
    for (const estado of [...ORDEN_ESTADOS, "all", FILTRO_POR_ATENDER, FILTRO_SOLICITUDES, FILTRO_SOLICITUDES_CERRADAS, "valor-raro"]) {
      expect(cifraPorAtender(LISTA, SOLICITUDES, { estado }), estado).toBe(todos);
    }
  });

  it("sigue la búsqueda, la fecha y el canal", () => {
    expect(cifraPorAtender(LISTA, SOLICITUDES, { busqueda: "navarro" })).toBe(1);
    expect(cifraPorAtender(LISTA, SOLICITUDES, { busqueda: "ana pendiente" })).toBe(1);
    expect(cifraPorAtender(LISTA, SOLICITUDES, { fecha: "2026-10-01" })).toBe(2); // «a» y «s1»
    expect(cifraPorAtender(LISTA, SOLICITUDES, { fecha: "2026-10-02" })).toBe(1); // «s2»
    // Las solicitudes solo salen con «teléfono»; «a» es de teléfono.
    expect(cifraPorAtender(LISTA, SOLICITUDES, { canal: "telefono" })).toBe(3);
    expect(cifraPorAtender(LISTA, SOLICITUDES, { canal: "web" })).toBe(0);
  });

  it("es justo el número de filas que la lista enseña con «Por atender» puesto, con cualquier combinación de filtros", () => {
    const combinaciones: FiltrosListaUnificada[] = [
      {},
      { fecha: "2026-10-01" },
      { canal: "telefono" },
      { busqueda: "e" },
      { fecha: "2026-10-02", canal: "telefono", busqueda: "solicitud" },
    ];
    for (const f of combinaciones) {
      const filas = filtrarFilasUnificadas(unificarReservasYSolicitudes(LISTA, SOLICITUDES), { ...f, estado: FILTRO_POR_ATENDER });
      expect(cifraPorAtender(LISTA, SOLICITUDES, f), JSON.stringify(f)).toBe(filas.length);
    }
  });

  it("no toca lo que recibe", () => {
    const copiaReservas = JSON.parse(JSON.stringify(LISTA));
    const copiaSolicitudes = JSON.parse(JSON.stringify(SOLICITUDES));
    const filtros = { busqueda: "a", estado: "confirmada" };
    cifraPorAtender(LISTA, SOLICITUDES, filtros);
    expect(LISTA).toEqual(copiaReservas);
    expect(SOLICITUDES).toEqual(copiaSolicitudes);
    expect(filtros).toEqual({ busqueda: "a", estado: "confirmada" });
  });
});

describe("alcanceCifrasDeLaLista", () => {
  const HOY = new Date(2026, 9, 1, 10, 30);

  it("Hoy: «cifras de hoy», que es lo que decía el timeline antes de llegar a la Lista", () => {
    expect(ALCANCE_HOY).toEqual({ cabecera: "cifras de hoy", lectura: "hoy" });
  });

  it("sin filtro de fecha: «cifras de la lista»", () => {
    expect(alcanceCifrasDeLaLista({ hoy: HOY })).toEqual({ cabecera: "cifras de la lista", lectura: "en la lista" });
    expect(alcanceCifrasDeLaLista({ fecha: undefined, hoy: HOY }).cabecera).toBe("cifras de la lista");
    expect(alcanceCifrasDeLaLista({ fecha: null, hoy: HOY }).cabecera).toBe("cifras de la lista");
  });

  it("con el día de hoy elegido: «cifras de la lista de hoy»", () => {
    // Da igual la hora: es el mismo día.
    expect(alcanceCifrasDeLaLista({ fecha: new Date(2026, 9, 1, 0, 0), hoy: HOY })).toEqual({
      cabecera: "cifras de la lista de hoy",
      lectura: "hoy",
    });
    expect(alcanceCifrasDeLaLista({ fecha: new Date(2026, 9, 1, 23, 59), hoy: HOY }).lectura).toBe("hoy");
  });

  it("con otro día elegido: «cifras de la lista del 3 oct 2026» (el mismo formato que el botón de fecha)", () => {
    const dia = new Date(2026, 9, 3);
    const texto = format(dia, "d MMM yyyy", { locale: es });
    expect(texto).toBe("3 oct 2026");
    expect(alcanceCifrasDeLaLista({ fecha: dia, hoy: HOY })).toEqual({
      cabecera: "cifras de la lista del 3 oct 2026",
      lectura: "el 3 oct 2026",
    });
    // Ayer tampoco es hoy.
    const ayer = new Date(2026, 8, 30);
    expect(alcanceCifrasDeLaLista({ fecha: ayer, hoy: HOY }).cabecera).toBe(
      `cifras de la lista del ${format(ayer, "d MMM yyyy", { locale: es })}`,
    );
  });

  it("con un filtro de estado puesto avisa de que no cuenta: las demás cifras no son las de las filas visibles", () => {
    expect(alcanceCifrasDeLaLista({ hoy: HOY, filtroDeEstado: true })).toEqual({
      cabecera: "cifras de la lista, sin el filtro de estado",
      lectura: "en la lista",
    });
    expect(alcanceCifrasDeLaLista({ fecha: HOY, hoy: HOY, filtroDeEstado: true }).cabecera).toBe(
      "cifras de la lista de hoy, sin el filtro de estado",
    );
    expect(alcanceCifrasDeLaLista({ hoy: HOY, filtroDeEstado: false }).cabecera).toBe("cifras de la lista");
  });
});
