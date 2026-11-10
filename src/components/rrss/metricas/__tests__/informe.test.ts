/**
 * Modelo del informe mensual de redes sociales (RRSS › Métricas › Generar
 * informe): cifras, comparación con el mes anterior, publicaciones, visitas a
 * la web desde redes, conclusiones y casos sin datos.
 */
import { describe, expect, it } from "vitest";
import { addDays, format, parseISO } from "date-fns";
import {
  construirInformeRrss,
  diaMadrid,
  resumirRedes,
  textoPublicacion,
  tipoPublicacion,
  type DatosInformeRrss,
  type FilaCuentaIg,
  type InformeRrss,
  type PublicacionIg,
} from "../informe/modelo";

const CUENTA = "17841400000000001";

function dias(desde: string, n: number, f: (i: number, fecha: string) => Partial<FilaCuentaIg> | null, cuenta = CUENTA): FilaCuentaIg[] {
  const filas: FilaCuentaIg[] = [];
  for (let i = 0; i < n; i++) {
    const fecha = format(addDays(parseISO(desde), i), "yyyy-MM-dd");
    const extra = f(i, fecha);
    if (extra === null) continue;
    filas.push({
      fecha,
      ig_user_id: cuenta,
      seguidores: null,
      alcance: 100,
      visualizaciones: 300,
      interacciones: 10,
      cuentas_interaccion: 8,
      visitas_perfil: 5,
      toques_enlaces: 1,
      ...extra,
    });
  }
  return filas;
}

function pub(media: string, publicado: string, extra: Partial<PublicacionIg> = {}): PublicacionIg {
  return {
    media_id: media,
    ig_user_id: CUENTA,
    publicado_at: publicado,
    producto: "FEED",
    tipo_medio: "IMAGE",
    caption: `Publicación ${media}`,
    permalink: `https://www.instagram.com/p/${media}/`,
    alcance: 100,
    me_gusta: 5,
    comentarios: 1,
    guardados: 1,
    compartidos: 0,
    visualizaciones: 200,
    interacciones: 7,
    ...extra,
  };
}

/** Septiembre (30 días, alcance 100/día) y octubre (31 días, alcance 120/día, pico el 9). */
function datosBase(): DatosInformeRrss {
  return {
    cuentas: [
      ...dias("2026-09-01", 30, (i) => ({ seguidores: i === 29 ? 1000 : null })),
      ...dias("2026-10-01", 31, (i) => ({ alcance: i === 8 ? 500 : 120, interacciones: 12, seguidores: i === 30 ? 1040 : null })),
    ],
    publicaciones: [
      pub("1", "2026-09-10T10:00:00Z"),
      pub("2", "2026-10-02T10:00:00Z", { alcance: 300, producto: "REELS", tipo_medio: "VIDEO", interacciones: 30 }),
      pub("3", "2026-10-09T10:00:00Z", { alcance: 900, producto: "REELS", tipo_medio: "VIDEO", interacciones: 90, caption: "Arroz del senyoret para el domingo #arroz #crevillent" }),
      pub("4", "2026-10-15T10:00:00Z", { alcance: 200 }),
      pub("5", "2026-10-20T10:00:00Z", { alcance: 100, interacciones: null, me_gusta: 3, comentarios: 1, guardados: 0, compartidos: 0 }),
      pub("6", "2026-10-25T10:00:00Z", { alcance: 150, tipo_medio: "CAROUSEL_ALBUM" }),
    ],
    web: {
      actual: [
        { valor: "l.instagram.com", visitas: 60, pct: 6 },
        { valor: "instagram.com", visitas: 20, pct: 2 },
        { valor: "m.facebook.com", visitas: 20, pct: 2 },
        { valor: "google.com", visitas: 500, pct: 50 },
      ],
      anterior: [{ valor: "instagram.com", visitas: 50, pct: 5 }],
    },
  };
}

const informeOk = (d: DatosInformeRrss, mes = "2026-10", hoy = "2026-11-09"): InformeRrss => {
  const i = construirInformeRrss(d, { mes, hoy });
  if (i.vacio === true) throw new Error(`Informe vacío: ${i.motivo}`);
  return i;
};

describe("construirInformeRrss · mes completo", () => {
  const i = informeOk(datosBase());

  it("título, archivo y periodo", () => {
    expect(i.titulo).toBe("Redes sociales de Casa Tomás: octubre 2026");
    expect(i.nombreArchivo).toBe("Redes-sociales-Casa-Tomas-octubre-2026.pdf");
    expect(i.periodo).toBe("Del 1 al 31 de octubre de 2026");
    expect(i.enCurso).toBe(false);
  });

  it("compara totales con septiembre (los dos meses completos)", () => {
    // Octubre: 30 × 120 + 500 = 4.100; septiembre: 30 × 100 = 3.000.
    expect(i.resumen.alcance.valor).toBe(4100);
    expect(i.resumen.alcance.variacion?.base).toBe("total");
    expect(i.resumen.alcance.variacion?.valor).toBeCloseTo(36.67, 1);
    expect(i.resumen.alcance.anterior).toBe(3000);
    expect(i.resumen.titular).toBe("El alcance de Instagram en octubre: 4.100, un 36,7 % más que en septiembre");
  });

  it("seguidores: el último dato de cada mes y la diferencia", () => {
    expect(i.resumen.seguidores).toEqual({ valor: 1040, anterior: 1000, cambio: 40 });
  });

  it("evolución diaria: un punto por día, el mejor día y sin huecos", () => {
    expect(i.evolucion.puntos).toHaveLength(31);
    expect(i.evolucion.puntos[0]).toMatchObject({ dia: 1, actual: 120, anterior: 100 });
    expect(i.evolucion.puntos[30]).toMatchObject({ dia: 31, anterior: null });
    expect(i.evolucion.mejorDia).toMatchObject({ dia: 9, visitas: 500 });
    expect(i.evolucion.titular).toBe("El día de más alcance fue el viernes 9 de octubre, con 500 cuentas");
    expect(i.evolucion.huecos).toEqual([]);
  });

  it("publicaciones del mes: total, por tipo y las que más llegaron", () => {
    const p = i.publicaciones!;
    expect(p.total).toBe(5);
    expect(p.totalAnterior).toBe(1);
    expect(p.titular).toBe("Salieron 5 publicaciones en octubre, 4 más que en septiembre");
    expect(p.porTipo.map((t) => [t.nombre, t.visitas])).toEqual([
      ["Foto", 2],
      ["Reel", 2],
      ["Carrusel", 1],
    ]);
    expect(p.porTipo[0].destacado).toBe(true);
    expect(p.porTipo.find((t) => t.nombre === "Reel")?.alcanceMedio).toBe(600);
    expect(p.mejores.map((m) => m.mediaId)).toEqual(["3", "2", "4", "6", "5"]);
    expect(p.mejores[0]).toMatchObject({ tipo: "Reel", fechaCorta: "9 oct", texto: "Arroz del senyoret para el domingo", alcance: 900, interacciones: 90, tasa: 10 });
    // Sin `interacciones` de Meta: suma de me gusta, comentarios, guardados y compartidos.
    expect(p.mejores[4].interacciones).toBe(4);
    expect(p.titularMejores).toBe("La que más llegó: un reel del 9 oct, con 900 cuentas alcanzadas");
  });

  it("visitas a la web desde redes: agrupa dominios por red e ignora lo que no es red", () => {
    const w = i.web!;
    expect(w.total).toBe(100);
    expect(w.cuota).toBe(10);
    expect(w.redes.map((r) => [r.nombre, r.visitas, r.destacado])).toEqual([
      ["Instagram", 80, true],
      ["Facebook", 20, false],
    ]);
    expect(w.variacion).toEqual({ valor: 100, base: "total" });
    expect(w.titular).toBe("Las redes llevaron 100 visitas a la web; 80 % desde Instagram");
  });

  it("conclusiones y notas a partir de los datos (Facebook, sin cifras)", () => {
    expect(i.conclusiones[0]).toBe("El alcance subió un 36,7 % frente a septiembre.");
    expect(i.conclusiones).toContain("La cuenta ganó 40 seguidores: cerró con 1.040.");
    expect(i.conclusiones).toContain("Los reels llegaron de media a 600 cuentas, frente a 150 de las fotos.");
    expect(i.conclusiones).toContain("La publicación con más alcance fue la del 9 oct (reel), con 900 cuentas.");
    expect(i.conclusiones.length).toBeLessThanOrEqual(5);
    expect(i.notas).toContain("Facebook todavía no está conectado al panel: este informe no incluye sus datos.");
    expect(i.notas.join(" ")).toMatch(/suma del alcance de cada día/);
  });
});

describe("construirInformeRrss · otros casos", () => {
  it("mes en curso: compara la media por día y lo dice", () => {
    const d = datosBase();
    d.cuentas = [...dias("2026-10-01", 31, () => ({ alcance: 100 })), ...dias("2026-11-01", 8, () => ({ alcance: 150 }))];
    const i = informeOk(d, "2026-11", "2026-11-09");
    expect(i.enCurso).toBe(true);
    expect(i.periodo).toBe("Del 1 al 8 de noviembre de 2026 (mes en curso)");
    expect(i.resumen.alcance.variacion).toEqual({ valor: 50, base: "media" });
    expect(i.resumen.titular).toBe("Noviembre: 150 de alcance al día en Instagram, un 50,0\u00A0% más que en octubre");
  });

  it("días sin datos: huecos en la gráfica y comparación por día", () => {
    const d = datosBase();
    d.cuentas = [
      ...dias("2026-09-01", 30, () => ({})),
      ...dias("2026-10-01", 31, (i) => (i >= 10 && i <= 12 ? null : { alcance: 100 })),
    ];
    const i = informeOk(d);
    expect(i.evolucion.huecos).toEqual([{ desde: 11, hasta: 13 }]);
    expect(i.resumen.alcance.variacion?.base).toBe("media");
    expect(i.resumen.titular).toBe("Octubre: 100 de alcance al día en Instagram, en la línea de septiembre");
  });

  it("sin datos de septiembre: no compara", () => {
    const d = datosBase();
    d.cuentas = dias("2026-10-01", 31, () => ({}));
    const i = informeOk(d);
    expect(i.resumen.alcance.variacion).toBeNull();
    expect(i.resumen.comparacion).toBe("sin datos de septiembre para comparar");
    expect(i.resumen.titular).toBe("El alcance de Instagram en octubre: 3.100");
  });

  it("sin permiso de Tráfico web: sin diapositiva ni conclusión de la web", () => {
    const i = informeOk({ ...datosBase(), web: null });
    expect(i.web).toBeNull();
    expect(i.conclusiones.join(" ")).not.toMatch(/visitas a la web/);
  });

  it("sin publicaciones en el mes: lo dice en las conclusiones", () => {
    const i = informeOk({ ...datosBase(), publicaciones: [] });
    expect(i.publicaciones).toBeNull();
    expect(i.conclusiones).toContain("No hay publicaciones de octubre con métricas guardadas.");
  });

  it("varias cuentas: usa la que tiene más días medidos y lo avisa", () => {
    const d = datosBase();
    d.cuentas.push(...dias("2026-10-01", 3, () => ({ alcance: 9999 }), "17841400000000002"));
    const i = informeOk(d);
    expect(i.resumen.alcance.valor).toBe(4100);
    expect(i.notas.join(" ")).toMatch(/Hay 2 cuentas de Instagram/);
  });

  it("sin métricas del mes: informe vacío con el motivo", () => {
    const i = construirInformeRrss({ cuentas: dias("2026-09-01", 30, () => ({})), publicaciones: [], web: null }, { mes: "2026-10", hoy: "2026-11-09" });
    expect(i.vacio).toBe(true);
    if (i.vacio) expect(i.motivo).toMatch(/No hay métricas de Instagram guardadas de octubre 2026/);
  });

  it("el día 1 del mes en curso no hay ningún día cerrado", () => {
    const i = construirInformeRrss(datosBase(), { mes: "2026-11", hoy: "2026-11-01" });
    expect(i.vacio).toBe(true);
    if (i.vacio) expect(i.motivo).toBe("Noviembre acaba de empezar: todavía no hay ningún día completo.");
  });
});

describe("utilidades", () => {
  it("diaMadrid usa el día de Madrid (una publicación a las 00:30 del 1 de noviembre cuenta en noviembre)", () => {
    expect(diaMadrid("2026-10-31T23:30:00Z")).toBe("2026-11-01");
    expect(diaMadrid("2026-07-31T21:30:00Z")).toBe("2026-07-31");
    expect(diaMadrid("2026-07-31T22:30:00Z")).toBe("2026-08-01");
    expect(diaMadrid(null)).toBeNull();
    expect(diaMadrid("no es una fecha")).toBeNull();
  });

  it("tipoPublicacion distingue reel, historia, carrusel, vídeo y foto", () => {
    expect(tipoPublicacion({ producto: "REELS", tipo_medio: "VIDEO" })).toBe("Reel");
    expect(tipoPublicacion({ producto: "STORY", tipo_medio: "IMAGE" })).toBe("Historia");
    expect(tipoPublicacion({ producto: "FEED", tipo_medio: "CAROUSEL_ALBUM" })).toBe("Carrusel");
    expect(tipoPublicacion({ producto: "FEED", tipo_medio: "VIDEO" })).toBe("Vídeo");
    expect(tipoPublicacion({ producto: null, tipo_medio: null })).toBe("Foto");
  });

  it("textoPublicacion quita los hashtags del final y corta los textos largos", () => {
    expect(textoPublicacion("Menú del día\n\n#crevillent #menu")).toBe("Menú del día");
    expect(textoPublicacion(null)).toBe("Sin texto");
    expect(textoPublicacion("#solohashtags")).toBe("Sin texto");
    const largo = textoPublicacion("Esta semana tenemos en la carta un arroz meloso de bogavante que nos han pedido muchísimo y vuelve por fin");
    expect(largo.endsWith("…")).toBe(true);
    expect(largo.length).toBeLessThanOrEqual(91);
  });

  it("resumirRedes suma por red y la cuota sobre todas las visitas", () => {
    expect(
      resumirRedes([
        { valor: "https://l.instagram.com/", visitas: 3, pct: 1.5 },
        { valor: "instagram.com", visitas: 2, pct: 1 },
        { valor: "lm.facebook.com", visitas: 4, pct: 2 },
        { valor: "(directo)", visitas: 100, pct: 50 },
      ]),
    ).toEqual({ total: 9, cuota: 4.5, redes: [{ nombre: "Instagram", visitas: 5 }, { nombre: "Facebook", visitas: 4 }] });
    expect(resumirRedes([{ valor: "google.com", visitas: 10, pct: 100 }])).toEqual({ total: 0, cuota: null, redes: [] });
  });
});
