import { describe, expect, it } from "vitest";
import type { DatosInformeTrafico, FilaSerie } from "@/hooks/useTraficoWeb";
import {
  construirInforme,
  construirInformeMensual,
  describirDias,
  mesesSeleccionables,
  mesPorDefecto,
  rangoDatos,
  rangoInforme,
  type ApartadoTouzaConDatos,
  type ApartadoTouzaSinDatos,
  type DatosInformeMensual,
  type InformeTrafico,
  type InformeVacio,
  type OpcionesInforme,
} from "../informe/modelo";
import { fmtCifra, fmtCuota, fmtEntero, fmtMedia, fmtVariacion, unirLista } from "../informe/formatoInforme";
import { esRutaTouza, idiomaDeRuta, nombrePagina, nombreProcedencia, nombreWeb } from "../informe/nombres";
import {
  DATOS_DEMO_OCTUBRE_2026,
  DATOS_DEMO_TOUZA_OCTUBRE_2026,
  DATOS_TOUZA_SIN_VISITAS,
  datosMesCompleto,
  filaSerie,
} from "./fixtures/informeDemo";

/** Los «%» del informe llevan espacio de no separación; en las aserciones se escribe normal. */
const t = (s: string) => s.replace(/\u00A0/g, " ");

const OCTUBRE: OpcionesInforme = { proyecto: "casa-tomas-story", mes: "2026-10", hoy: "2026-11-03" };

function informe(datos: DatosInformeTrafico, op: Partial<OpcionesInforme> = {}): InformeTrafico {
  const r = construirInforme(datos, { ...OCTUBRE, ...op });
  if (r.vacio === true) throw new Error(`Informe vacío: ${r.motivo}`);
  return r;
}

/** Datos del mes completo con las visitas de octubre multiplicadas por `factor`. */
function conOctubrePor(factor: number): DatosInformeTrafico {
  const d = datosMesCompleto();
  return {
    ...d,
    serie: d.serie.map((f) => (f.fecha.startsWith("2026-10") && f.visitas !== null ? { ...f, visitas: Math.round(f.visitas * factor) } : f)),
  };
}

describe("formato del informe (es-ES)", () => {
  it("agrupa los miles con punto también con 4 cifras, como el informe de redes", () => {
    expect(fmtEntero(16850)).toBe("16.850");
    expect(fmtEntero(9903)).toBe("9.903");
    expect(fmtEntero(442)).toBe("442");
    expect(fmtCifra(1234.56, 2)).toBe("1.234,56");
  });

  it("variaciones con signo, coma decimal y espacio antes de %", () => {
    expect(t(fmtVariacion(0.3))).toBe("+0,3 %");
    expect(t(fmtVariacion(10.84))).toBe("+10,8 %");
    expect(t(fmtVariacion(-66))).toBe("−66,0 %");
    expect(t(fmtVariacion(250))).toBe("+250 %");
    expect(t(fmtVariacion(0))).toBe("0,0 %");
    // El espacio no se rompe: «%» nunca queda solo al principio de una línea.
    expect(fmtVariacion(5)).toContain("\u00A0%");
  });

  it("cuotas: enteras en el medio y con un decimal en los extremos (no redondea 99,5 a 100)", () => {
    expect(t(fmtCuota(66.52))).toBe("67 %");
    expect(t(fmtCuota(99.55))).toBe("99,5 %");
    expect(t(fmtCuota(0.45))).toBe("0,5 %");
    expect(t(fmtCuota(3.62))).toBe("3,6 %");
    expect(t(fmtCuota(0))).toBe("0 %");
    expect(t(fmtCuota(100))).toBe("100 %");
  });

  it("medias con un decimal solo si hace falta", () => {
    expect(fmtMedia(17)).toBe("17");
    expect(fmtMedia(4.857)).toBe("4,9");
    expect(fmtMedia(123.4)).toBe("123");
  });

  it("une listas en castellano", () => {
    expect(unirLista(["1 oct"])).toBe("1 oct");
    expect(unirLista(["1", "3", "4 oct"])).toBe("1, 3 y 4 oct");
  });
});

describe("nombres comprensibles", () => {
  it("páginas de la web de Casa Tomás", () => {
    expect(nombrePagina("/", "casa-tomas-story")).toBe("Inicio");
    expect(nombrePagina("/carta/vinos", "casa-tomas-story")).toBe("Carta de vinos");
    expect(nombrePagina("/carta/novedades-del-dia", "casa-tomas-story")).toBe("Novedades del día");
    expect(nombrePagina("/reservas/", "casa-tomas-story")).toBe("Reservas");
    expect(nombrePagina("/regala", "casa-tomas-story")).toBe("Cheques regalo");
    expect(nombrePagina("/carta/entrantes-frios", "casa-tomas-story")).toBe("Carta: Entrantes fríos");
    expect(nombrePagina("/carta/arroces", "casa-tomas-story")).toBe("Carta: Arroces");
    expect(nombrePagina("/carta/mariscos/gamba-roja", "casa-tomas-story")).toBe("Mariscos: Gamba roja");
    expect(nombrePagina("/algo-nuevo?x=1", "casa-tomas-story")).toBe("Algo nuevo");
  });

  it("versiones en otro idioma y web de Touza", () => {
    expect(nombrePagina("/en", "casa-tomas-story")).toBe("Inicio (en inglés)");
    expect(nombrePagina("/fr/carta/vinos", "casa-tomas-story")).toBe("Carta de vinos (en francés)");
    expect(idiomaDeRuta("/en/carta")).toEqual({ idioma: "en", ruta: "/carta" });
    expect(idiomaDeRuta("/entrantes")).toEqual({ idioma: "es", ruta: "/entrantes" });
    expect(nombrePagina("/galeria", "touza-restaurant-website")).toBe("Galería");
    expect(nombrePagina("/", "touza-restaurant-website", true)).toBe("Touza · Inicio");
    expect(nombrePagina("/", "casa-tomas-story", true)).toBe("Inicio");
  });

  it("procedencias agrupadas en llano", () => {
    expect(nombreProcedencia("(directo)")).toMatchObject({ nombre: "Directo", grupo: "directo" });
    expect(nombreProcedencia("www.google.es")).toMatchObject({ nombre: "Google", grupo: "buscador" });
    expect(nombreProcedencia("l.instagram.com")).toMatchObject({ nombre: "Instagram", grupo: "redes" });
    expect(nombreProcedencia("m.facebook.com")).toMatchObject({ nombre: "Facebook", grupo: "redes" });
    expect(nombreProcedencia("checkout.stripe.com")).toMatchObject({ grupo: "pago" });
    expect(nombreProcedencia("vercel.com")).toMatchObject({ nombre: "Pruebas internas", grupo: "interno" });
    expect(nombreProcedencia("https://www.ejemplo.com/ruta")).toMatchObject({ nombre: "ejemplo.com", grupo: "web" });
  });

  it("nombre de la web del informe", () => {
    expect(nombreWeb("casa-tomas-story")).toBe("la web de Casa Tomás");
    expect(nombreWeb("touza-restaurant-website")).toBe("la web de Touza");
    expect(nombreWeb("ambos")).toBe("las webs de Casa Tomás y Touza");
  });

  it("la página «Touza» dentro de la web de Casa Tomás, en cualquier idioma", () => {
    expect(esRutaTouza("/touza")).toBe(true);
    expect(esRutaTouza("/en/touza/")).toBe(true);
    expect(esRutaTouza("/touza-algo")).toBe(false);
    expect(esRutaTouza("/")).toBe(false);
  });
});

describe("meses del informe", () => {
  it("un mes cerrado va del 1 al último día y se compara con el anterior", () => {
    const r = rangoInforme("2026-10", "2026-11-03");
    expect(r).toMatchObject({ desde: "2026-10-01", hasta: "2026-10-31", desdeAnterior: "2026-09-01", hastaAnterior: "2026-09-30" });
    expect(r).toMatchObject({ enCurso: false, diasMes: 31, diasCerrados: 31, diasMesAnterior: 30 });
  });

  it("el mes en curso llega hasta ayer; el día 1 aún no tiene días cerrados", () => {
    expect(rangoInforme("2026-11", "2026-11-03")).toMatchObject({ hasta: "2026-11-02", diasCerrados: 2, enCurso: true });
    const dia1 = rangoInforme("2026-11", "2026-11-01");
    expect(dia1.diasCerrados).toBe(0);
    expect(rangoDatos(dia1)).toBeNull();
  });

  it("por defecto el último mes cerrado; la lista empieza por el mes en curso si ya tiene días", () => {
    expect(mesPorDefecto("2026-11-03")).toBe("2026-10");
    expect(mesPorDefecto("2027-01-15")).toBe("2026-12");
    const meses = mesesSeleccionables("2026-11-03");
    expect(meses[0]).toMatchObject({ clave: "2026-11", enCurso: true, etiqueta: "Noviembre 2026 (en curso)" });
    expect(meses[1]).toMatchObject({ clave: "2026-10", etiqueta: "Octubre 2026" });
    expect(meses).toHaveLength(13);
    expect(mesesSeleccionables("2026-11-01")[0].clave).toBe("2026-10");
  });

  it("describe tramos de días seguidos", () => {
    expect(describirDias(["2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"])).toBe("del 27 al 31 de octubre");
    expect(describirDias(["2026-10-05", "2026-10-09", "2026-10-10"])).toBe("el 5 de octubre y del 9 al 10 de octubre");
  });
});

describe("construirInforme con los datos reales de la demo (octubre 2026)", () => {
  const inf = informe(DATOS_DEMO_OCTUBRE_2026);

  it("cifras del mes: páginas vistas, visitantes, media diaria y páginas por visitante", () => {
    expect(inf.titulo).toBe("Tráfico de la web de Casa Tomás: octubre 2026");
    expect(inf.nombreArchivo).toBe("Trafico-de-la-web-de-Casa-Tomas-octubre-2026.pdf");
    expect(inf.resumen.paginasVistas.valor).toBe(442);
    expect(inf.resumen.visitantes.valor).toBe(91);
    expect(inf.resumen.mediaDiaria.valor).toBeCloseTo(17, 5);
    expect(inf.resumen.paginasPorVisitante).toBeCloseTo(4.857, 2);
    expect(inf.mes.diasConDato).toBe(26);
  });

  it("los ceros de antes de la primera visita (23-09) son «aún no se medía»: no hay comparación válida", () => {
    expect(inf.mesAnterior.diasConDato).toBe(8);
    expect(inf.resumen.comparable).toBe(false);
    expect(inf.resumen.paginasVistas.variacion).toBeNull();
    expect(inf.resumen.comparacion).toBe("septiembre solo tiene 8 días medidos: aún no se puede comparar");
    expect(inf.resumen.titular).toBe("Octubre cierra con 442 páginas vistas de 91 visitantes");
    expect(inf.evolucion.hayAnterior).toBe(false);
    expect(inf.notas).toContain("La web empezó a registrar visitas el 23 de septiembre; antes no hay datos.");
  });

  it("los días sin sincronizar (27–31 oct) son un hueco, no ceros", () => {
    expect(inf.evolucion.huecos).toEqual([{ desde: 27, hasta: 31 }]);
    expect(inf.evolucion.puntos[26]).toMatchObject({ dia: 27, actual: null });
    expect(inf.evolucion.puntos[10]).toMatchObject({ dia: 11, actual: 0 });
    expect(inf.notas).toContain("Sin datos del 27 al 31 de octubre: esos días no se pudieron copiar.");
  });

  it("mejor día y anomalías: las del arranque (sin 8 semanas de historia) no cuentan", () => {
    expect(inf.evolucion.mejorDia).toMatchObject({ fecha: "2026-10-01", visitas: 53, dia: 1, texto: "jueves 1 de octubre" });
    expect(inf.evolucion.titular).toBe("El día con más movimiento fue el jueves 1 de octubre, con 53 páginas vistas");
    expect(inf.evolucion.notaAnomalias).toBeNull();
  });

  it("páginas con nombres comprensibles, cuota de la carta y reservas", () => {
    const p = inf.paginas!;
    expect(p.items.map((i) => i.nombre)).toEqual([
      "Inicio",
      "Carta de vinos",
      "Novedades del día",
      "Carta",
      "Reservas",
      "Carta: Entrantes calientes",
      "Carta: Entrantes fríos",
    ]);
    expect(p.items[0]).toMatchObject({ visitas: 200, destacado: true });
    expect(p.items[0].pct).toBeCloseTo(45.25, 1);
    expect(p.restantes).toBe(15);
    expect(p.cuotaCarta).toBeCloseTo(47.74, 1);
    expect(p.visitasReservas).toBe(16);
    expect(t(p.titular)).toBe("La carta reúne el 48 % de todo lo que se mira en la web");
    expect(p.idiomas?.map((i) => i.nombre)).toEqual(["Español", "Inglés"]);
  });

  it("procedencia, dispositivo y país en llano", () => {
    expect(t(inf.procedencias!.titular)).toBe("El 90 % llega directamente, sin pasar por buscadores ni redes");
    expect(inf.procedencias!.items.map((i) => i.nombre)).toEqual(["Directo", "Vuelta de un pago", "Pruebas internas"]);
    expect(inf.procedencias!.explicaciones.map((e) => e.nombre)).toContain("Directo");
    expect(t(inf.audiencia!.titular)).toBe("El 67 % entra desde el móvil, y casi todo desde España");
    expect(inf.audiencia!.dispositivos!.map((d) => d.nombre)).toEqual(["Móvil", "Ordenador"]);
    expect(inf.audiencia!.pctEspana).toBeCloseTo(99.55, 1);
  });

  it("días de la semana con al menos 14 días de datos", () => {
    expect(inf.diasSemana!.titular).toBe("Los jueves son el día de la semana con más visitas");
    expect(inf.diasSemana!.mejor).toMatchObject({ singular: "jueves", dias: 4 });
    expect(inf.diasSemana!.mejor.media).toBeCloseTo(34.25, 2);
  });

  it("conclusiones por reglas: honestas, en positivo y sin cifras rotas", () => {
    expect(inf.conclusiones.length).toBeGreaterThanOrEqual(3);
    expect(inf.conclusiones.length).toBeLessThanOrEqual(5);
    expect(inf.conclusiones[0]).toBe("Octubre es el primer mes con datos casi completos: servirá de referencia para comparar los siguientes.");
    expect(t(inf.conclusiones.join(" "))).toContain("El 67 % entra desde el móvil");
    expect(t(inf.conclusiones.join(" "))).toContain("casi nadie desde Google");
    for (const c of inf.conclusiones) expect(c).not.toMatch(/NaN|undefined|null|Infinity/);
  });
});

describe("construirInforme: comparación con el mes anterior", () => {
  it("meses completos: compara totales y lo dice en el titular", () => {
    const inf = informe(datosMesCompleto());
    expect(inf.resumen.comparable).toBe(true);
    expect(inf.resumen.paginasVistas.variacion?.base).toBe("total");
    expect(inf.resumen.paginasVistas.variacion?.valor).toBeCloseTo((100 * (1620 - 1216)) / 1216, 5);
    expect(inf.resumen.paginasVistas.anterior).toBe(1216);
    expect(t(inf.resumen.titular)).toBe("Octubre cierra con 1.620 páginas vistas, un 33,2 % más que septiembre");
    expect(t(inf.conclusiones[0])).toBe("La web gana público: +33,2 % de páginas vistas frente a septiembre.");
    expect(inf.evolucion.hayAnterior).toBe(true);
    expect(inf.periodo).toBe("Del 1 al 31 de octubre de 2026 · comparado con septiembre");
  });

  it("si faltan días compara la media por día (un hueco no es una caída)", () => {
    const d = datosMesCompleto();
    // Quita 4 días de octubre: el total baja, la media por día no.
    const serie: FilaSerie[] = d.serie.map((f) => (["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"].includes(f.fecha) ? { ...f, visitas: null, visitantes: null } : f));
    const inf = informe({ ...d, serie });
    expect(inf.resumen.paginasVistas.variacion?.base).toBe("media");
    expect(inf.resumen.paginasVistas.variacion!.valor).toBeGreaterThan(0);
    expect(t(inf.resumen.titular)).toMatch(/^Octubre: \d+(,\d)? páginas vistas al día, un [\d,]+ % más que en septiembre$/);
    expect(inf.notas.join(" ")).toContain("Sin datos del 5 al 8 de octubre");
  });

  it("bajada: titular honesto y conclusión en positivo", () => {
    const inf = informe(conOctubrePor(0.5));
    expect(inf.resumen.paginasVistas.variacion!.valor).toBeLessThan(-5);
    expect(inf.resumen.titular).toMatch(/menos que septiembre$/);
    expect(inf.conclusiones[0]).toMatch(/menos de páginas vistas que septiembre: buen momento para darle un empujón/);
  });

  it("variación pequeña: «en la línea de»", () => {
    const inf = informe(conOctubrePor(1216 / 1620));
    expect(Math.abs(inf.resumen.paginasVistas.variacion!.valor)).toBeLessThan(5);
    expect(inf.resumen.titular).toMatch(/en la línea de septiembre$/);
    expect(inf.conclusiones[0]).toMatch(/^Las visitas se mantienen estables respecto a septiembre/);
  });
});

describe("construirInforme: desgloses y reglas con un mes normal", () => {
  const inf = informe(datosMesCompleto());

  it("junta las procedencias del mismo sitio y manda el resto a «Otras webs»", () => {
    const items = inf.procedencias!.items;
    expect(items.map((i) => [i.nombre, i.visitas])).toEqual([
      ["Google", 600],
      ["Directo", 400],
      ["Instagram", 350],
      ["Facebook", 100],
      ["Tripadvisor", 60],
      ["Otras webs", 30],
    ]);
    expect(items[5].explicacion).toBeUndefined();
    expect(t(inf.procedencias!.titular)).toBe("Google trae el 39 % de las visitas");
  });

  it("tablet, países e idiomas", () => {
    expect(inf.audiencia!.dispositivos!.map((d) => d.clave)).toEqual(["mobile", "desktop", "tablet"]);
    expect(t(inf.audiencia!.titular)).toBe("El 78 % entra desde el móvil; el 84 %, desde España");
    expect(inf.audiencia!.paises!.map((p) => p.nombre)).toEqual(["España", "Francia", "Reino Unido", "Alemania"]);
    expect(inf.paginas!.idiomas!.map((i) => [i.nombre, i.visitas])).toEqual([
      ["Español", 1320],
      ["Inglés", 150],
      ["Francés", 30],
    ]);
  });

  it("sábados como día fuerte y anomalía con historia suficiente", () => {
    expect(inf.diasSemana!.titular).toBe("Los sábados son el día de la semana con más visitas");
    expect(inf.diasSemana!.mediaFinde).toBeGreaterThan(inf.diasSemana!.mediaEntreSemana!);
    expect(inf.evolucion.notaAnomalias).toBe("Picos fuera de lo normal para ese día de la semana: 17 oct.");
  });

  it("conclusiones de buscadores y redes; como mucho 5", () => {
    expect(inf.conclusiones).toHaveLength(5);
    expect(t(inf.conclusiones.join(" "))).toContain("Google es la puerta principal (39 %)");
    expect(t(inf.conclusiones.join(" "))).toContain("Las redes sociales traen el 29 % de las visitas");
  });

  it("informe de las dos webs: título en plural y páginas de Touza marcadas", () => {
    const d = datosMesCompleto();
    const ambos = informe({ ...d, paginas: [...d.paginas, { ...d.paginas[0], proyecto: "touza-restaurant-website", visitas: 5 }] }, { proyecto: "ambos" });
    expect(ambos.titulo).toBe("Tráfico de las webs de Casa Tomás y Touza: octubre 2026");
    expect(ambos.paginas!.items.map((i) => i.nombre)).not.toContain("Touza · Inicio"); // fuera del top 7
    expect(ambos.paginas!.restantes).toBeGreaterThan(0);
  });
});

describe("construirInforme: meses sin datos", () => {
  it("mes anterior a empezar a medir", () => {
    const r = construirInforme(DATOS_DEMO_OCTUBRE_2026, { ...OCTUBRE, mes: "2026-08" }) as InformeVacio;
    expect(r.vacio).toBe(true);
    expect(r.motivo).toBe("En agosto 2026 todavía no se medían las visitas de la web de Casa Tomás.");
  });

  it("web que nunca ha tenido visitas", () => {
    const r = construirInforme({ ...DATOS_DEMO_OCTUBRE_2026, primerDiaConVisitas: null }, OCTUBRE) as InformeVacio;
    expect(r.vacio).toBe(true);
  });

  it("mes con días pero todos sin sincronizar", () => {
    const serie = DATOS_DEMO_OCTUBRE_2026.serie.map((f) => (f.fecha.startsWith("2026-10") ? { ...f, visitas: null, visitantes: null } : f));
    const r = construirInforme({ ...DATOS_DEMO_OCTUBRE_2026, serie }, OCTUBRE) as InformeVacio;
    expect(r).toMatchObject({ vacio: true, motivo: "No hay visitas registradas de la web de Casa Tomás en octubre 2026." });
  });

  it("el día 1, el mes en curso aún no tiene ningún día completo", () => {
    const r = construirInforme(DATOS_DEMO_OCTUBRE_2026, { ...OCTUBRE, mes: "2026-11", hoy: "2026-11-01" }) as InformeVacio;
    expect(r).toMatchObject({ vacio: true, motivo: "Noviembre acaba de empezar: todavía no hay ningún día completo." });
  });

  it("sin desgloses ni páginas: las diapositivas que dependen de ellos desaparecen", () => {
    const inf = informe({ ...DATOS_DEMO_OCTUBRE_2026, paginas: [], dispositivos: [], paises: [], procedencias: [] });
    expect(inf.paginas).toBeNull();
    expect(inf.procedencias).toBeNull();
    expect(inf.audiencia).toBeNull();
    expect(inf.resumen.paginasVistas.valor).toBe(442);
  });

  it("con menos de 14 días de datos no hay gráfica por día de la semana", () => {
    const serie = DATOS_DEMO_OCTUBRE_2026.serie.map((f) => (f.fecha >= "2026-10-10" && f.fecha <= "2026-10-31" ? filaSerie([f.fecha, null, null, null, null]) : f));
    const inf = informe({ ...DATOS_DEMO_OCTUBRE_2026, serie });
    expect(inf.mes.diasConDato).toBe(9);
    expect(inf.diasSemana).toBeNull();
  });
});

// ─── Informe mensual: la web principal y Touza al final ──────────────────────
describe("construirInformeMensual: énfasis en la web principal y Touza al final", () => {
  const MES = { mes: "2026-10", hoy: "2026-11-03" };
  const DEMO: DatosInformeMensual = { principal: DATOS_DEMO_OCTUBRE_2026, touza: DATOS_DEMO_TOUZA_OCTUBRE_2026 };

  function mensual(datos: DatosInformeMensual, op: Partial<typeof MES> = {}): InformeTrafico {
    const r = construirInformeMensual(datos, { ...MES, ...op });
    if (r.vacio === true) throw new Error(`Informe vacío: ${r.motivo}`);
    return r;
  }
  const conTouza = (inf: InformeTrafico): ApartadoTouzaConDatos => {
    if (inf.touza?.conDatos !== true) throw new Error("Touza sin datos");
    return inf.touza;
  };

  it("todo el informe principal es de Casa Tomás, con sus datos solos (Touza no se suma)", () => {
    const inf = mensual(DEMO);
    expect(inf.proyecto).toBe("casa-tomas-story");
    expect(inf.titulo).toBe("Tráfico de la web de Casa Tomás: octubre 2026");
    expect(inf.nombreArchivo).toBe("Trafico-de-la-web-de-Casa-Tomas-octubre-2026.pdf");
    // 442 de Casa Tomás, no 470 (442 + 28 de Touza).
    expect(inf.resumen.paginasVistas.valor).toBe(442);
    expect(inf.resumen.visitantes.valor).toBe(91);
    // Portada, resumen, gráficas y conclusiones: exactamente el informe de Casa Tomás.
    expect({ ...inf, touza: null }).toEqual(construirInforme(DATOS_DEMO_OCTUBRE_2026, { ...MES, proyecto: "casa-tomas-story" }));
    expect(inf.paginas!.items.map((i) => i.nombre).join(" ")).not.toMatch(/Touza|Galería|Reservado/);
  });

  it("apartado de Touza con los datos reales de la demo", () => {
    const touza = conTouza(mensual(DEMO));
    const ti = touza.informe;
    expect(ti.proyecto).toBe("touza-restaurant-website");
    expect(ti.resumen.paginasVistas.valor).toBe(28);
    expect(ti.resumen.visitantes.valor).toBe(14);
    expect(ti.mes.diasConDato).toBe(19);
    expect(ti.resumen.comparable).toBe(false);
    expect(touza.titular).toBe("Touza cierra octubre con 28 páginas vistas de 14 visitantes");
    expect(touza.titularDetalle).toBe("Lo más visto en Touza: Inicio y Carta");
    // Sus páginas con nombre propio, sin «Touza · » delante (ya lo dice la diapositiva).
    expect(ti.paginas!.items.map((i) => i.nombre)).toEqual(["Inicio", "Carta", "Galería", "Reservado"]);
    expect(ti.paginas!.visitasReservas).toBeNull();
    expect(ti.procedencias!.principal).toMatchObject({ nombre: "Directo", grupo: "directo" });
    expect(ti.evolucion.huecos).toEqual([
      { desde: 9, hasta: 9 },
      { desde: 15, hasta: 18 },
      { desde: 25, hasta: 31 },
    ]);
    // Peso de Touza con la media por día (28/19 frente a 442/26): los huecos no cuentan.
    expect(touza.cuotaSobreAmbas).toBeCloseTo((100 * (28 / 19)) / (28 / 19 + 17), 5);
    expect(t(fmtCuota(touza.cuotaSobreAmbas!))).toBe("8,0 %");
    expect(touza.visitasPaginaTouzaEnCasaTomas).toBeNull();
    expect(touza.visitasDesdeCasaTomas).toBeNull();
    expect(touza.notas).toEqual([
      "Touza empezó a registrar visitas el 23 de septiembre; antes no hay datos.",
      "Sin datos el 9 de octubre, del 15 al 18 de octubre y del 25 al 31 de octubre: esos días no se pudieron copiar.",
    ]);
  });

  it("Touza sin visitas en el mes: el apartado se queda y explica por qué", () => {
    const inf = mensual({ ...DEMO, touza: DATOS_TOUZA_SIN_VISITAS });
    expect(inf.resumen.paginasVistas.valor).toBe(442);
    const touza = inf.touza as ApartadoTouzaSinDatos;
    expect(touza).toEqual({
      conDatos: false,
      titular: "Touza: sin visitas que mostrar en octubre",
      motivo: "En octubre 2026 todavía no se medían las visitas de la web de Touza.",
    });
    const sinCopiar = DATOS_DEMO_TOUZA_OCTUBRE_2026.serie.map((f) => (f.fecha.startsWith("2026-10") ? { ...f, visitas: null, visitantes: null } : f));
    expect(mensual({ ...DEMO, touza: { ...DATOS_DEMO_TOUZA_OCTUBRE_2026, serie: sinCopiar } }).touza).toMatchObject({
      conDatos: false,
      motivo: "No hay visitas registradas de la web de Touza en octubre 2026.",
    });
  });

  it("sin datos de la web principal el informe sale vacío aunque Touza tenga", () => {
    const r = construirInformeMensual({ principal: DATOS_TOUZA_SIN_VISITAS, touza: DATOS_DEMO_TOUZA_OCTUBRE_2026 }, MES) as InformeVacio;
    expect(r).toMatchObject({ vacio: true, motivo: "En octubre 2026 todavía no se medían las visitas de la web de Casa Tomás." });
  });

  it("titulares de Touza con comparación, media por día y mes en curso", () => {
    const completo = datosMesCompleto();
    const touzaCompleto = { ...completo, paginas: completo.paginas.map((p) => ({ ...p, proyecto: "touza-restaurant-website" })) };
    const touza = conTouza(mensual({ principal: completo, touza: touzaCompleto }));
    expect(t(touza.titular)).toBe("Touza cierra octubre con 1.620 páginas vistas, un 33,2 % más que septiembre");
    // Mitad de tráfico que la principal cada día: un tercio de las dos webs.
    const mitad = { ...touzaCompleto, serie: touzaCompleto.serie.map((f) => ({ ...f, visitas: f.visitas === null ? null : f.visitas / 2 })) };
    expect(conTouza(mensual({ principal: completo, touza: mitad })).cuotaSobreAmbas).toBeCloseTo(100 / 3, 5);

    const conHueco = touzaCompleto.serie.map((f) => (["2026-10-05", "2026-10-06"].includes(f.fecha) ? { ...f, visitas: null, visitantes: null } : f));
    expect(t(conTouza(mensual({ principal: completo, touza: { ...touzaCompleto, serie: conHueco } })).titular)).toMatch(
      /^Touza: [\d,]+ páginas vistas al día en octubre, un [\d,]+ % más que en septiembre$/,
    );

    // Octubre aún en curso (hoy, 27): datos hasta el 26.
    const enCurso = conTouza(mensual(DEMO, { hoy: "2026-10-27" }));
    expect(enCurso.titular).toBe("Touza lleva 28 páginas vistas en octubre de 14 visitantes");
    expect(enCurso.notas.join(" ")).not.toContain("Mes en curso"); // ya lo dicen las notas de Casa Tomás
  });

  it("enlaces entre las dos webs: la página «Touza» de Casa Tomás y las visitas que llegan desde ella", () => {
    const principal = {
      ...DATOS_DEMO_OCTUBRE_2026,
      paginas: [...DATOS_DEMO_OCTUBRE_2026.paginas, { ...DATOS_DEMO_OCTUBRE_2026.paginas[0], ruta: "/touza", visitas: 12 }, { ...DATOS_DEMO_OCTUBRE_2026.paginas[0], ruta: "/en/touza", visitas: 3 }],
    };
    const touza = {
      ...DATOS_DEMO_TOUZA_OCTUBRE_2026,
      procedencias: [...DATOS_DEMO_TOUZA_OCTUBRE_2026.procedencias.slice(0, 2), { valor: "casa-tomas-story.vercel.app", visitas: 5, visitantes: 3, pct: 15 }],
    };
    const apartado = conTouza(mensual({ principal, touza }));
    expect(apartado.visitasPaginaTouzaEnCasaTomas).toBe(15);
    expect(apartado.visitasDesdeCasaTomas).toBe(5);
  });

  it("sin desgloses de Touza solo queda su diapositiva de resumen", () => {
    const touza = conTouza(mensual({ ...DEMO, touza: { ...DATOS_DEMO_TOUZA_OCTUBRE_2026, paginas: [], dispositivos: [], paises: [], procedencias: [] } }));
    expect(touza.titularDetalle).toBeNull();
    expect(touza.titular).toBe("Touza cierra octubre con 28 páginas vistas de 14 visitantes");
  });

  it("el informe de una sola web no lleva apartado de Touza", () => {
    expect(informe(DATOS_DEMO_OCTUBRE_2026).touza).toBeNull();
  });
});
