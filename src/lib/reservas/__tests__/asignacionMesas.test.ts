import { describe, it, expect } from "vitest";
import {
  ajusteCapacidad,
  esGradoAsignacion,
  esTurno,
  ETIQUETA_SIN_SALA,
  gradoDeReserva,
  mensajeErrorAsignacion,
  mesaOcupadaPor,
  PREFIJOS_ERROR_ASIGNACION,
  resumenDia,
  resumenPorEspacio,
  TEXTO_CAMBIO_INTERNO,
  textoQuitarMesas,
  turnoDeHora,
  type FilaResumenEspacio,
  type GradoAsignacion,
} from "@/lib/reservas/asignacionMesas";

// La asignación de mesas es el GRADO 2 del cierre del día (grado 1 = sala, que
// ya hace el kanban). Estos tests fijan lo único que no puede moverse:
//   · el corte de turno a las 17:00, que tiene que coincidir con el trigger de
//     aforo `validar_capacidad_reserva` y con la vista `vista_asignacion_dia`;
//   · que "con sala y sin mesa" es un ESTADO, nunca un error;
//   · que los porcentajes no mienten ni dividen por cero;
//   · que los 5 errores del RPC llegan traducidos al camarero.

describe("turnoDeHora", () => {
  it("corta a las 17:00 en punto: 16:59 es comida, 17:00 ya es cena", () => {
    expect(turnoDeHora("16:59")).toBe("comida");
    expect(turnoDeHora("17:00")).toBe("cena");
    expect(turnoDeHora("17:01")).toBe("cena");
  });

  it("mismo corte con segundos (la hora llega como `time` de Postgres)", () => {
    expect(turnoDeHora("16:59:00")).toBe("comida");
    expect(turnoDeHora("16:59:59")).toBe("comida");
    expect(turnoDeHora("17:00:00")).toBe("cena");
    expect(turnoDeHora("17:00:01")).toBe("cena");
  });

  it("los segundos nunca cambian el resultado respecto al formato corto", () => {
    for (const hora of ["13:30", "16:59", "17:00", "21:45"]) {
      expect(turnoDeHora(hora + ":00")).toBe(turnoDeHora(hora));
      expect(turnoDeHora(hora + ":59")).toBe(turnoDeHora(hora));
    }
  });

  it("horas normales de servicio", () => {
    expect(turnoDeHora("13:00")).toBe("comida");
    expect(turnoDeHora("14:30")).toBe("comida");
    expect(turnoDeHora("20:00")).toBe("cena");
    expect(turnoDeHora("22:15")).toBe("cena");
  });

  it("acepta la hora sin cero delante (9:30)", () => {
    expect(turnoDeHora("9:30")).toBe("comida");
  });

  it("basura, vacío y fuera de rango caen en 'cena', como el ELSE del SQL", () => {
    // En SQL la regla es `CASE WHEN hora < '17:00:00' THEN 'comida' ELSE 'cena'
    // END`: una comparación que no es verdadera cae en el ELSE. Si aquí
    // devolviéramos "comida" el panel contaría un turno distinto que la base.
    expect(turnoDeHora("")).toBe("cena");
    expect(turnoDeHora("   ")).toBe("cena");
    expect(turnoDeHora("no es una hora")).toBe("cena");
    expect(turnoDeHora("99:99")).toBe("cena");
    expect(turnoDeHora("12:70")).toBe("cena");
    expect(turnoDeHora(null as unknown as string)).toBe("cena");
    expect(turnoDeHora(undefined as unknown as string)).toBe("cena");
  });

  it("tolera espacios alrededor", () => {
    expect(turnoDeHora(" 14:00 ")).toBe("comida");
    expect(turnoDeHora(" 21:00 ")).toBe("cena");
  });
});

describe("gradoDeReserva", () => {
  it("sin sala → sin_sala", () => {
    expect(gradoDeReserva({ espacio_id: null, mesas_asignadas: 0 })).toBe("sin_sala");
    expect(gradoDeReserva({ espacio_id: "", mesas_asignadas: 0 })).toBe("sin_sala");
    expect(gradoDeReserva({ espacio_id: "   ", mesas_asignadas: 0 })).toBe("sin_sala");
  });

  it("con sala y sin mesa → sin_mesa (estado NORMAL, no un error)", () => {
    expect(gradoDeReserva({ espacio_id: "salon", mesas_asignadas: 0 })).toBe("sin_mesa");
  });

  it("con sala y al menos una mesa → con_mesa", () => {
    expect(gradoDeReserva({ espacio_id: "salon", mesas_asignadas: 1 })).toBe("con_mesa");
    expect(gradoDeReserva({ espacio_id: "salon", mesas_asignadas: 3 })).toBe("con_mesa");
  });

  it("sin_sala manda aunque el contador de mesas venga incoherente", () => {
    // No debería pasar (el RPC lanza RESERVA_SIN_SALA:), pero un dato antiguo
    // así hay que arreglarlo por la sala, no pintarlo como cerrado.
    expect(gradoDeReserva({ espacio_id: null, mesas_asignadas: 2 })).toBe("sin_sala");
  });

  it("un contador roto no cuenta como mesa", () => {
    expect(gradoDeReserva({ espacio_id: "salon", mesas_asignadas: NaN })).toBe("sin_mesa");
    expect(gradoDeReserva({ espacio_id: "salon", mesas_asignadas: null as unknown as number })).toBe("sin_mesa");
    expect(gradoDeReserva({ espacio_id: "salon", mesas_asignadas: -1 })).toBe("sin_mesa");
  });
});

describe("ajusteCapacidad", () => {
  it("6 comensales en una mesa de 4 → excede, faltan 2", () => {
    expect(ajusteCapacidad(6, 4)).toEqual({ estado: "excede", diferencia: -2 });
  });

  it("sin plazas asignadas → sin_mesa (y la diferencia sigue siendo plazas - comensales)", () => {
    expect(ajusteCapacidad(6, 0)).toEqual({ estado: "sin_mesa", diferencia: -6 });
    expect(ajusteCapacidad(0, 0)).toEqual({ estado: "sin_mesa", diferencia: 0 });
  });

  it("plazas exactas → justo", () => {
    expect(ajusteCapacidad(4, 4)).toEqual({ estado: "justo", diferencia: 0 });
  });

  it("sobran plazas → holgado, sin umbrales", () => {
    expect(ajusteCapacidad(2, 4)).toEqual({ estado: "holgado", diferencia: 2 });
    expect(ajusteCapacidad(4, 5)).toEqual({ estado: "holgado", diferencia: 1 });
    expect(ajusteCapacidad(2, 12)).toEqual({ estado: "holgado", diferencia: 10 });
  });

  it("dos mesas de 4 para un grupo de 7 → holgado (la suma es lo que cuenta)", () => {
    expect(ajusteCapacidad(7, 8)).toEqual({ estado: "holgado", diferencia: 1 });
  });

  it("datos sucios no revientan ni inventan plazas", () => {
    expect(ajusteCapacidad(NaN, 4)).toEqual({ estado: "holgado", diferencia: 4 });
    expect(ajusteCapacidad(4, NaN)).toEqual({ estado: "sin_mesa", diferencia: -4 });
    expect(ajusteCapacidad(null as unknown as number, null as unknown as number)).toEqual({
      estado: "sin_mesa",
      diferencia: 0,
    });
    expect(ajusteCapacidad(-3, 4)).toEqual({ estado: "holgado", diferencia: 4 });
  });
});

describe("resumenDia", () => {
  const filas = (grados: GradoAsignacion[]) => grados.map((grado) => ({ grado }));

  it("lista vacía: todo a cero y 0% (no divide por cero)", () => {
    expect(resumenDia([])).toEqual({ total: 0, sinSala: 0, sinMesa: 0, conMesa: 0, porcentajeCerrado: 0 });
    expect(resumenDia(null as unknown as { grado: GradoAsignacion }[])).toEqual({
      total: 0,
      sinSala: 0,
      sinMesa: 0,
      conMesa: 0,
      porcentajeCerrado: 0,
    });
  });

  it("cuenta los tres grados", () => {
    const r = resumenDia(filas(["sin_sala", "sin_mesa", "sin_mesa", "con_mesa"]));
    expect(r).toEqual({ total: 4, sinSala: 1, sinMesa: 2, conMesa: 1, porcentajeCerrado: 25 });
  });

  it("las sin_sala cuentan en el denominador (un día sin salas no está cerrado)", () => {
    const r = resumenDia(filas(["sin_sala", "sin_sala", "con_mesa", "con_mesa"]));
    expect(r.porcentajeCerrado).toBe(50);
  });

  it("día entero cerrado → 100", () => {
    expect(resumenDia(filas(["con_mesa", "con_mesa", "con_mesa"])).porcentajeCerrado).toBe(100);
  });

  it("ninguna con mesa → 0", () => {
    expect(resumenDia(filas(["sin_mesa", "sin_mesa", "sin_sala"])).porcentajeCerrado).toBe(0);
  });

  it("no enseña 100% si queda algo por colocar (199 de 200 → 99)", () => {
    const grados: GradoAsignacion[] = Array.from({ length: 200 }, (_, i) => (i === 0 ? "sin_mesa" : "con_mesa"));
    const r = resumenDia(filas(grados));
    expect(r.conMesa).toBe(199);
    expect(r.porcentajeCerrado).toBe(99);
  });

  it("no enseña 0% si ya hay algo cerrado (1 de 250 → 1)", () => {
    const grados: GradoAsignacion[] = Array.from({ length: 250 }, (_, i) => (i === 0 ? "con_mesa" : "sin_mesa"));
    expect(resumenDia(filas(grados)).porcentajeCerrado).toBe(1);
  });

  it("un grado desconocido cuenta como lo menos cerrado, nunca infla", () => {
    const r = resumenDia([{ grado: "vete_a_saber" as GradoAsignacion }, { grado: "con_mesa" }]);
    expect(r).toEqual({ total: 2, sinSala: 1, sinMesa: 0, conMesa: 1, porcentajeCerrado: 50 });
  });
});

describe("resumenPorEspacio", () => {
  const fila = (o: Partial<FilaResumenEspacio> = {}): FilaResumenEspacio => ({
    grado: "sin_mesa",
    espacio_id: "salon",
    espacio_nombre: "Salón",
    numero_comensales: 4,
    ...o,
  });

  it("agrupa por sala con lo que tiene y lo que le falta", () => {
    const { porEspacio, sinSala } = resumenPorEspacio([
      fila({ grado: "con_mesa", numero_comensales: 2 }),
      fila({ grado: "sin_mesa", numero_comensales: 4 }),
      fila({ espacio_id: "terraza", espacio_nombre: "Terraza", grado: "con_mesa", numero_comensales: 6 }),
    ]);

    expect(porEspacio).toHaveLength(2);
    const salon = porEspacio.find((e) => e.espacio_id === "salon");
    expect(salon).toMatchObject({
      espacio_nombre: "Salón",
      total: 2,
      conMesa: 1,
      sinMesa: 1,
      comensales: 6,
      porcentajeCerrado: 50,
    });
    expect(porEspacio.find((e) => e.espacio_id === "terraza")).toMatchObject({
      total: 1,
      conMesa: 1,
      sinMesa: 0,
      comensales: 6,
      porcentajeCerrado: 100,
    });
    expect(sinSala.total).toBe(0);
  });

  it("las sin_sala van a su grupo aparte, nunca a una sala", () => {
    const { porEspacio, sinSala } = resumenPorEspacio([
      fila({ grado: "sin_sala", espacio_id: null, espacio_nombre: null, numero_comensales: 8 }),
      fila({ grado: "sin_sala", espacio_id: null, espacio_nombre: null, numero_comensales: 2 }),
      fila({ grado: "con_mesa" }),
    ]);

    expect(sinSala).toEqual({
      espacio_id: null,
      espacio_nombre: ETIQUETA_SIN_SALA,
      total: 2,
      sinMesa: 0,
      conMesa: 0,
      comensales: 10,
      porcentajeCerrado: 0,
    });
    expect(porEspacio).toHaveLength(1);
  });

  it("una fila incoherente (grado con sala pero sin espacio_id) cae en sin_sala y no se pierde", () => {
    const filas = [fila({ grado: "sin_mesa", espacio_id: null }), fila({ grado: "con_mesa" })];
    const { porEspacio, sinSala } = resumenPorEspacio(filas);
    // Los totales del desglose siempre suman igual que resumenDia.
    const totalDesglose = porEspacio.reduce((s, e) => s + e.total, 0) + sinSala.total;
    expect(totalDesglose).toBe(resumenDia(filas).total);
    expect(sinSala.total).toBe(1);
  });

  it("ordena las salas por nombre (es-ES)", () => {
    const { porEspacio } = resumenPorEspacio([
      fila({ espacio_id: "t", espacio_nombre: "Terraza" }),
      fila({ espacio_id: "c", espacio_nombre: "Comedor" }),
      fila({ espacio_id: "s", espacio_nombre: "Salón" }),
    ]);
    expect(porEspacio.map((e) => e.espacio_nombre)).toEqual(["Comedor", "Salón", "Terraza"]);
  });

  it("lista vacía: sin salas y grupo sin sala a cero", () => {
    const { porEspacio, sinSala } = resumenPorEspacio([]);
    expect(porEspacio).toEqual([]);
    expect(sinSala.total).toBe(0);
    expect(sinSala.porcentajeCerrado).toBe(0);
  });
});

describe("mensajeErrorAsignacion", () => {
  it("reconoce los 5 prefijos del contrato SQL", () => {
    expect(PREFIJOS_ERROR_ASIGNACION).toEqual([
      "MESA_OCUPADA",
      "MESA_OTRA_SALA",
      "RESERVA_SIN_SALA",
      "RESERVA_CANCELADA",
      "MESA_INACTIVA",
    ]);

    for (const prefijo of PREFIJOS_ERROR_ASIGNACION) {
      const mensaje = mensajeErrorAsignacion({ message: prefijo + ": algo" });
      expect(mensaje).not.toBe("");
      // Nunca se le escupe el prefijo crudo al camarero.
      expect(mensaje).not.toContain(prefijo);
      expect(mensaje).not.toBe("No se pudieron guardar las mesas. Vuelve a intentarlo.");
    }
  });

  it("mesa ocupada: frase en español y con el detalle de QUÉ mesa", () => {
    const mensaje = mensajeErrorAsignacion({ message: "MESA_OCUPADA: la mesa 12 ya tiene reserva" });
    expect(mensaje).toContain("ya está ocupada a esa hora");
    expect(mensaje).toContain("la mesa 12 ya tiene reserva");
  });

  it("mesa ocupada con la frase de la base de datos (franjas): se enseña tal cual", () => {
    const mensaje = mensajeErrorAsignacion({
      code: "23514",
      message: "MESA_OCUPADA: La mesa 3 está ocupada de 14:00 a 16:00 por Oscar Diaz Vidal",
    });
    expect(mensaje).toBe("La mesa 3 está ocupada de 14:00 a 16:00 por Oscar Diaz Vidal. Elige otra mesa o quítasela primero.");
  });

  it("mesa de otra sala", () => {
    expect(mensajeErrorAsignacion({ message: "MESA_OTRA_SALA: mesa de Terraza" })).toContain("no es de la sala");
  });

  it("reserva sin sala: dice que primero hay que dar sala", () => {
    const mensaje = mensajeErrorAsignacion({ message: "RESERVA_SIN_SALA: falta espacio_id" });
    expect(mensaje).toContain("darle sala");
  });

  it("reserva cancelada", () => {
    expect(mensajeErrorAsignacion({ message: "RESERVA_CANCELADA: estado cancelada" })).toContain("cancelada");
  });

  it("mesa inactiva", () => {
    expect(mensajeErrorAsignacion({ message: "MESA_INACTIVA: mesa 4 desactivada" })).toContain("desactivada");
  });

  it("busca el prefijo también en details y hint (PostgREST los reparte)", () => {
    expect(mensajeErrorAsignacion({ message: "error", details: "MESA_INACTIVA: mesa fuera de uso" })).toContain(
      "desactivada",
    );
    expect(mensajeErrorAsignacion({ message: "", hint: "RESERVA_CANCELADA: nada que hacer" })).toContain("cancelada");
  });

  it("acepta el error como string pelado y como Error", () => {
    expect(mensajeErrorAsignacion("MESA_OCUPADA: mesa 3 pillada")).toContain("ya está ocupada");
    expect(mensajeErrorAsignacion(new Error("MESA_OTRA_SALA: no toca"))).toContain("no es de la sala");
  });

  it("no pega detalles inservibles (uuid pelado o una sola palabra)", () => {
    expect(mensajeErrorAsignacion({ message: "MESA_OCUPADA: 3f0b9c2e-1111-4222-8333-444455556666" })).toBe(
      "Esa mesa ya está ocupada a esa hora por otra reserva.",
    );
    expect(mensajeErrorAsignacion({ message: "MESA_INACTIVA:mesa4" })).toBe(
      "Esa mesa está desactivada. Actívala en el plano o elige otra.",
    );
  });

  it("la unique (mesa_id, fecha, turno) saltando por una carrera se lee como mesa ocupada", () => {
    const mensaje = mensajeErrorAsignacion({
      code: "23505",
      message: 'duplicate key value violates unique constraint "asignaciones_mesa_mesa_fecha_turno_key"',
    });
    expect(mensaje).toBe("Esa mesa ya está ocupada a esa hora por otra reserva.");
  });

  it("si el RPC o la vista no existen, lo dice en vez de mandar a los logs", () => {
    expect(mensajeErrorAsignacion({ code: "PGRST202", message: "Could not find the function" })).toContain(
      "falta aplicar la migración",
    );
    expect(mensajeErrorAsignacion({ code: "42P01", message: 'relation "vista_asignacion_dia" does not exist' })).toContain(
      "falta aplicar la migración",
    );
  });

  it("fallback: frase genérica, con el texto original si es legible", () => {
    expect(mensajeErrorAsignacion(null)).toBe("No se pudieron guardar las mesas. Vuelve a intentarlo.");
    expect(mensajeErrorAsignacion(undefined)).toBe("No se pudieron guardar las mesas. Vuelve a intentarlo.");
    expect(mensajeErrorAsignacion({})).toBe("No se pudieron guardar las mesas. Vuelve a intentarlo.");

    const conTexto = mensajeErrorAsignacion({ message: "connection reset by peer" });
    expect(conTexto).toContain("No se pudieron guardar las mesas");
    expect(conTexto).toContain("connection reset by peer");
  });

  it("recorta los mensajes kilométricos", () => {
    const mensaje = mensajeErrorAsignacion({ message: "fallo raro " + "x ".repeat(300) });
    expect(mensaje.length).toBeLessThan(200);
  });
});

describe("mesaOcupadaPor", () => {
  const asignaciones = [
    { id: "a1", mesa_id: "m1", reserva_id: "r1" },
    { id: "a2", mesa_id: "m2", reserva_id: "r2" },
    { id: "a3", mesa_id: "m3", reserva_id: "r1" },
  ];

  it("devuelve la asignación que estorba (para poder decir de quién es la mesa)", () => {
    expect(mesaOcupadaPor(asignaciones, "m2")).toMatchObject({ id: "a2", reserva_id: "r2" });
  });

  it("null si la mesa está libre", () => {
    expect(mesaOcupadaPor(asignaciones, "m9")).toBeNull();
  });

  it("excluyendo la propia reserva, sus mesas NO salen como ocupadas", () => {
    // Si no, al editar r1 sus propias mesas se pintarían en rojo.
    expect(mesaOcupadaPor(asignaciones, "m1", "r1")).toBeNull();
    expect(mesaOcupadaPor(asignaciones, "m3", "r1")).toBeNull();
    // Pero las de otra reserva siguen ocupadas.
    expect(mesaOcupadaPor(asignaciones, "m2", "r1")).toMatchObject({ id: "a2" });
  });

  it("sin exclusión, incluso las propias cuentan como ocupadas", () => {
    expect(mesaOcupadaPor(asignaciones, "m1")).toMatchObject({ id: "a1" });
    expect(mesaOcupadaPor(asignaciones, "m1", null)).toMatchObject({ id: "a1" });
    expect(mesaOcupadaPor(asignaciones, "m1", undefined)).toMatchObject({ id: "a1" });
  });

  it("aguanta lista vacía, lista nula, huecos y mesaId vacío", () => {
    expect(mesaOcupadaPor([], "m1")).toBeNull();
    expect(mesaOcupadaPor(null as unknown as typeof asignaciones, "m1")).toBeNull();
    expect(mesaOcupadaPor([null as unknown as (typeof asignaciones)[0], ...asignaciones], "m1")).toMatchObject({
      id: "a1",
    });
    expect(mesaOcupadaPor(asignaciones, "")).toBeNull();
  });
});

describe("guardas de tipo", () => {
  it("esTurno", () => {
    expect(esTurno("comida")).toBe(true);
    expect(esTurno("cena")).toBe(true);
    expect(esTurno("merienda")).toBe(false);
    expect(esTurno(null)).toBe(false);
  });

  it("esGradoAsignacion", () => {
    expect(esGradoAsignacion("sin_sala")).toBe(true);
    expect(esGradoAsignacion("sin_mesa")).toBe(true);
    expect(esGradoAsignacion("con_mesa")).toBe(true);
    expect(esGradoAsignacion("con_sala")).toBe(false);
    expect(esGradoAsignacion(undefined)).toBe(false);
  });
});

// El trigger `trg_reservas_sincronizar_asignaciones` BORRA las mesas de una reserva
// cuando cambia su sala. Dos pantallas lo avisan antes (Asignación y el kanban de
// Hoy) y dicen lo mismo palabra por palabra: la frase sale de aquí.
describe("textoQuitarMesas (aviso de «cambiar de sala y quitar sus mesas»)", () => {
  it("con una mesa, sus nombres y su sala de origen", () => {
    expect(
      textoQuitarMesas({ nombre: "Ana", cantidad: 1, mesasNombres: ["4"], salaActual: "Salón", destinoNombre: "Terraza" }),
    ).toBe("Ana tiene 1 mesa asignada (4) en Salón. Al pasarla a Terraza se quitarán esas mesas y habrá que asignarlas de nuevo.");
  });

  it("con varias mesas, en plural y con todos los nombres", () => {
    expect(
      textoQuitarMesas({ nombre: "Ana", cantidad: 2, mesasNombres: ["4", "5"], salaActual: "Salón", destinoNombre: "Terraza" }),
    ).toBe("Ana tiene 2 mesas asignadas (4, 5) en Salón. Al pasarla a Terraza se quitarán esas mesas y habrá que asignarlas de nuevo.");
  });

  it("sin nombres de mesa ni sala conocida no inventa nada", () => {
    expect(
      textoQuitarMesas({ nombre: "Ana", cantidad: 3, mesasNombres: [], salaActual: null, destinoNombre: "Sin asignar" }),
    ).toBe("Ana tiene 3 mesas asignadas. Al pasarla a Sin asignar se quitarán esas mesas y habrá que asignarlas de nuevo.");
  });

  it.each([null, undefined, ""])("una reserva sin nombre (%j) es «Esta reserva»", (nombre) => {
    expect(
      textoQuitarMesas({ nombre, cantidad: 1, mesasNombres: ["7"], salaActual: undefined, destinoNombre: "Terraza" }),
    ).toBe("Esta reserva tiene 1 mesa asignada (7). Al pasarla a Terraza se quitarán esas mesas y habrá que asignarlas de nuevo.");
  });

  it("y se aclara siempre que es un cambio interno: al cliente no se le manda nada", () => {
    expect(TEXTO_CAMBIO_INTERNO).toBe("Es un cambio interno: al cliente no se le envía nada.");
  });
});
