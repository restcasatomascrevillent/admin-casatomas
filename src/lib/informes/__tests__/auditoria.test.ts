import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { INFORMES, puedeVerInforme } from "../registro";
import { fraseDelicada, type DatosAuditoria } from "../fuentes/auditoria";
import { cuandoLargo, franjaHabitual, modeloInformeAuditoria, nombrePersona, tablaCsvAuditoria, type InformeAuditoria } from "../auditoria/modelo";
import { claveProceso, cuantas, fraseAccion, fraseCuentas, textoCampos, textoProceso } from "../auditoria/textos";
import { csvInformeTabla } from "../tabla";

// Octubre de 2026 (UTC+2 hasta el 25, UTC+1 después).
const datos: DatosAuditoria = {
  usuarios: [
    {
      quien: "ana@staff.local",
      acciones: 30,
      dias: 4,
      ultima: "2026-10-20T16:30:00Z",
      borrados: 1,
      precios: 1,
      secciones: [{ tabla: "facturas", n: 20 }, { tabla: "Vinos", n: 10 }],
      primera: "2026-10-05T07:00:00Z",
      entradas: 9,
      por_dia: [{ dia: "2026-10-05", n: 2 }, { dia: "2026-10-06", n: 0 }, { dia: "2026-10-13", n: 8 }, { dia: "2026-10-20", n: 20 }],
      por_hora: [{ hora: 9, n: 2 }, { hora: 10, n: 18 }, { hora: 11, n: 6 }, { hora: 18, n: 4 }],
      tablas: [
        { tabla: "facturas", crear: 15, actualizar: 4, eliminar: 1, n: 20 },
        { tabla: "Vinos", crear: 0, actualizar: 10, eliminar: 0, n: 10 },
      ],
      servidor: [{ op: "rebuild-webs", n: 3, fallidas: 1 }],
      recientes: [
        { created_at: "2026-10-20T16:30:00Z", accion: "actualizar", tabla: "Vinos", nombre: "Ribera", campos: ["precio_eur", "imagen_url"] },
        { created_at: "2026-10-20T16:00:00Z", accion: "ejecutar", tabla: "acciones_servidor", op: "rebuild-webs", resultado: "fallida" },
        { created_at: "2026-10-19T10:00:00Z", accion: "eliminar", tabla: "storage.objects", nombre: "tmp/3f2a9c1e-77aa-4b1b-9e0d-5c1a2b3c4d5e.webp" },
      ],
    },
    { quien: "luis@casa.es", acciones: 0, dias: 1, ultima: "2026-10-02T09:00:00Z", borrados: 0, precios: 0, secciones: [], entradas: 1, por_dia: [{ dia: "2026-10-02", n: 0 }] },
  ],
  por_dia: [],
  por_hora: [],
  delicadas_total: 4,
  delicadas: [
    { created_at: "2026-10-20T16:30:00Z", actor_label: "ana@staff.local", accion: "actualizar", tabla: "Vinos", tipo_evento: "cambiar_precio", det: { antes: { nombre: "Ribera", precio_eur: "20" }, despues: { nombre: "Ribera", precio_eur: "22.5" } } },
    { created_at: "2026-10-19T10:00:00Z", actor_label: "ana@staff.local", accion: "eliminar", tabla: "storage.objects", tipo_evento: "eliminar", det: {} },
    { created_at: "2026-10-18T10:00:00Z", actor_label: "ana@staff.local", accion: "eliminar", tabla: "storage.objects", tipo_evento: "eliminar", det: {} },
    { created_at: "2026-10-17T10:00:00Z", actor_label: "ana@staff.local", accion: "eliminar", tabla: "reservas", tipo_evento: "eliminar", det: { antes: { nombre: "Mesa López" } } },
  ],
  sistema: [
    { actor_label: "API · service_role · ocr-trabajo", tabla: "facturas", accion: "crear", n: 58 },
    { actor_label: "API · service_role · ocr-trabajo", tabla: "productos_factura", accion: "crear", n: 183 },
    { actor_label: "Base de datos · postgres", tabla: "reservas", accion: "actualizar", n: 100 },
    { actor_label: "API · service_role · alta-botellas-touza", tabla: "storage.objects", accion: "crear", n: 7 },
    { actor_label: "API · service_role · carga-fotos-vinos", tabla: "storage.objects", accion: "crear", n: 5 },
    { actor_label: "API · service_role · algo-nuevo", tabla: "Vinos", accion: "actualizar", n: 1 },
  ],
  sistema_total: 354,
  accesos_fallidos: 2,
};

const modelo = () => modeloInformeAuditoria(datos, "2026-10", "2026-11-18") as InformeAuditoria;

describe("informe mensual de auditoría: registro", () => {
  it("está en el registro, solo para super admin, por mes y con diapositivas propias", () => {
    const def = INFORMES.find((i) => i.id === "auditoria-mensual")!;
    expect(def.periodo).toBe("mes");
    expect(def.generador.tipo).toBe("componente");
    expect(def.formatos).toEqual(["pdf", "csv"]);
    expect(puedeVerInforme(def, { esSuperAdmin: false, permisos: [{ section_key: "usuarios", can_view: true, can_edit: true }] })).toBe(false);
    expect(puedeVerInforme(def, { esSuperAdmin: true, permisos: [] })).toBe(true);
  });
});

describe("informe mensual de auditoría: persona a persona", () => {
  it("vacío si no hay nada", () => {
    expect(modeloInformeAuditoria({ ...datos, usuarios: [], sistema_total: 0, delicadas_total: 0 }, "2026-10", "2026-11-18")).toEqual({
      vacio: true,
      motivo: "No hay nada en el registro de octubre de 2026.",
    });
  });

  it("una ficha por persona con su resumen en frases", () => {
    const m = modelo();
    expect(m.personas.map((p) => p.nombre)).toEqual(["Ana", "luis@casa.es"]);
    const ana = m.personas[0];
    expect(ana.etiqueta).toBe("ana@staff.local");
    expect(ana.titulares.ficha).toBe("Ana hizo 30 cosas en 4 días, sobre todo en Facturas de proveedores");
    expect(ana.resumen).toEqual([
      "Entró 4 de los 31 días del mes y abrió el panel 9 veces.",
      "Suele trabajar por la mañana, entre las 9:00 y las 12:00, y sobre todo los martes.",
      "La mayor parte de lo que hace es en «Facturas de proveedores» (67\u00a0% de sus acciones).",
      "Creó 15 cosas, cambió 14 y borró 1 y pidió 3 tareas al servidor.",
      "Hizo 4 cosas delicadas (borrados, precios o permisos): están en su última diapositiva.",
    ]);
    expect(ana.primera).toBe("lun 5 oct, 09:00");
    expect(ana.diapositivas).toEqual(["ficha", "cuando", "que", "ultimo"]);
  });

  it("cuándo trabaja: calendario del mes, horas y días de la semana", () => {
    const ana = modelo().personas[0];
    // Octubre de 2026 empieza en jueves: el día 1 va en la columna 3 (0 = lunes).
    expect(ana.calendario[0]).toMatchObject({ dia: "2026-10-01", columna: 3, fila: 0, n: 0, entro: false });
    expect(ana.calendario.find((d) => d.dia === "2026-10-06")).toMatchObject({ n: 0, entro: true });
    expect(ana.calendario.find((d) => d.dia === "2026-10-20")).toMatchObject({ n: 20, entro: true, columna: 1 });
    expect(ana.calendario).toHaveLength(31);
    expect(ana.horas[10]).toBe(18);
    expect(ana.semana.map((d) => d.n)).toEqual([2, 28, 0, 0, 0, 0, 0]);
    expect(ana.diaFuerte).toBe("los martes");
    expect(ana.mejorDia).toEqual({ dia: "2026-10-20", n: 20 });
    expect(ana.titulares.cuando).toBe("Ana trabaja sobre todo por la mañana y los martes");
  });

  it("qué hace: secciones, lo que pide al servidor y lo último, en frases", () => {
    const ana = modelo().personas[0];
    expect(ana.secciones[0]).toEqual({ nombre: "Facturas de proveedores", crear: 15, cambiar: 4, borrar: 1, total: 20 });
    expect(ana.servidor).toEqual([{ nombre: "Publicar los cambios en las webs", n: 3, fallidas: 1 }]);
    expect(ana.recientes.map((r) => r.frase)).toEqual([
      "Cambió un vino «Ribera» (precio y foto)",
      "Pidió: Publicar los cambios en las webs — no salió bien",
      "Borró un archivo",
    ]);
  });

  it("lo delicado: las iguales juntas", () => {
    const ana = modelo().personas[0];
    expect(ana.totalDelicadas).toBe(4);
    expect(ana.delicadas.map((d) => [d.frase.replace(/\s/g, " "), d.veces])).toEqual([
      ["Cambió el precio de «Ribera»: de 20,00 € a 22,50 €", 1],
      ["Borró un archivo", 2],
      ["Borró una reserva «Mesa López»", 1],
    ]);
    expect(ana.titulares.ultimo).toBe("Ana: 4 cosas delicadas que conviene mirar");
  });

  it("quien solo entró lleva solo su ficha", () => {
    const luis = modelo().personas[1];
    expect(luis.titulares.ficha).toBe("luis@casa.es entró 1 día pero no cambió nada");
    expect(luis.diapositivas).toEqual(["ficha"]);
    expect(luis.franja).toBeNull();
  });

  it("el equipo de un vistazo", () => {
    const m = modelo();
    expect(m.resumen).toMatchObject({ personas: 2, acciones: 30, delicadas: 4, fallidos: 2, sistema: 354 });
    expect(m.resumen.titular).toBe("2 personas usaron el panel; Ana fue quien más (30 cosas)");
    expect(m.equipo[0]).toEqual({ nombre: "Ana", acciones: 30, dias: 4, cuando: "Mañanas", donde: "Facturas de proveedores", delicadas: 4 });
    expect(m.textoPeriodo).toBe("Octubre de 2026");
    // Mes en curso: hasta hoy.
    const enCurso = modeloInformeAuditoria(datos, "2026-11", "2026-11-18") as InformeAuditoria;
    expect(enCurso.textoPeriodo).toBe("Noviembre de 2026 (hasta el día 18)");
    expect(enCurso.diasPeriodo).toBe(18);
  });
});

describe("informe mensual de auditoría: lo que hace el sistema solo", () => {
  it("proceso a proceso, explicado, y las cargas puntuales juntas", () => {
    const { sistema } = modelo();
    expect(sistema.titular).toBe("Además, el sistema hizo 354 cosas solo");
    expect(sistema.procesos.map((p) => [p.nombre, p.n])).toEqual([
      ["Lectura de facturas largas", 241],
      ["La base de datos, por su cuenta", 100],
      ["Cargas puntuales del equipo técnico", 12],
      ["Proceso «algo-nuevo»", 1],
    ]);
    expect(sistema.procesos[0].explicacion).toMatch(/lee con IA/);
    expect(sistema.procesos[0].detalle).toBe("Creó 183 líneas de factura y 58 facturas.");
    expect(sistema.procesos[2].detalle).toBe("«alta-botellas-touza» (7) y «carga-fotos-vinos» (5).");
    expect(sistema.nota).toBeNull();
    // Si la base de datos manda solo los procesos más activos, se dice.
    const recortado = modeloInformeAuditoria({ ...datos, sistema_total: 1000 }, "2026-10", "2026-11-18") as InformeAuditoria;
    expect(recortado.sistema.nota).toBe("Salen los procesos más activos (354 de 1.000 cosas).");
  });

  it("textos de los procesos", () => {
    expect(claveProceso("API · service_role · ocr-trabajo")).toBe("ocr-trabajo");
    expect(claveProceso("Base de datos · postgres")).toBe("base_de_datos");
    expect(textoProceso("emails-reserva").nombre).toBe("Correos de las reservas");
    expect(textoProceso("tmp-subir-stickers-demo").nombre).toBe("Carga puntual «tmp-subir-stickers-demo»");
    expect(textoProceso("desconocido").explicacion).toMatch(/sin que nadie pulse nada/);
  });
});

describe("informe mensual de auditoría: frases", () => {
  it("acciones, cuentas y campos sin jerga", () => {
    expect(fraseAccion({ accion: "crear", tabla: "reservas", nombre: "Mesa López" })).toBe("Creó una reserva «Mesa López»");
    expect(fraseAccion({ accion: "actualizar", tabla: "configuracion_turnos" })).toBe("Cambió algo en «Turnos»");
    expect(fraseAccion({ accion: "eliminar", tabla: "storage.objects", nombre: "carta/foto-ribera.webp" })).toBe("Borró un archivo «foto-ribera.webp»");
    expect(fraseAccion({ accion: "ejecutar", tabla: "acciones_servidor", op: "nueva-funcion" })).toBe("Pidió: Acción del servidor «nueva-funcion»");
    expect(cuantas(1, "facturas")).toBe("1 factura");
    expect(cuantas(3, "configuracion_turnos")).toBe("3 en «Turnos»");
    expect(textoCampos(["precio_eur", "nombre_en", "nombre_fr", "orden", "descripcion"])).toBe("precio, traducciones, orden y 1 más");
    expect(fraseCuentas([{ tabla: "facturas", accion: "eliminar", n: 1 }, { tabla: "Vinos", accion: "actualizar", n: 2 }])).toBe("Cambió 2 vinos. Borró 1 factura.");
    expect(fraseDelicada({ ...datos.delicadas[3] })).toBe("Borró una reserva «Mesa López»");
    expect(fraseDelicada({ created_at: "", actor_label: null, accion: "actualizar", tabla: "user_roles", tipo_evento: "cambiar_roles", det: {} })).toBe("Cambió el rol de alguien");
  });

  it("nombres, fechas y franja horaria", () => {
    expect(nombrePersona("maria.jose@staff.local")).toBe("Maria Jose");
    expect(nombrePersona("ana@gmail.com")).toBe("ana@gmail.com");
    expect(cuandoLargo("2026-11-14T17:30:00Z")).toBe("sáb 14 nov, 18:30");
    const horas = Array.from({ length: 24 }, () => 0);
    horas[22] = 5;
    horas[23] = 4;
    expect(franjaHabitual(horas)).toMatchObject({ desde: 21, hasta: 24, momento: "por la noche", texto: "entre las 21:00 y las 24:00" });
    expect(franjaHabitual(Array.from({ length: 24 }, () => 0))).toBeNull();
  });

  it("CSV con todo lo de cada persona y el sistema", () => {
    const m = modelo();
    const csv = csvInformeTabla(tablaCsvAuditoria(m, datos));
    expect(csv).toContain("# Cada persona: resumen · Octubre de 2026");
    expect(csv).toContain("ana@staff.local;30;4;9;lun 5 oct, 09:00");
    expect(csv).toContain("ana@staff.local;Facturas de proveedores;15;4;1;20");
    expect(csv).toContain("ana@staff.local;Publicar los cambios en las webs;3;1");
    expect(csv).toContain("ana@staff.local;2026-10-20;20");
    expect(csv).toContain("# Lo que hace el sistema solo");
    expect(csv).toContain("Total;;;354");
  });
});
