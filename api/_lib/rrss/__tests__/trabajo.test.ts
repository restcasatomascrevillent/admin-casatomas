// @vitest-environment node
/**
 * Orquestador del motor (analizar + generar) contra un Supabase SIMULADO en
 * memoria (PostgREST y Storage por fetch), con sharp y ffmpeg REALES: lo que
 * se sube como resultado es el archivo editado de verdad.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { analizarArchivo, procesarGeneracion, reclamarGeneracion } from "../trabajo";
import { manejarPost } from "../http";
import { rutaFfmpeg, ejecutar } from "../video";
import type { SesionRrss } from "../supabase";

const P = "11111111-1111-4111-8111-111111111111";
const F1 = "22222222-2222-4222-8222-222222222222";
const F2 = "33333333-3333-4333-8333-333333333333";
const V1 = "44444444-4444-4444-8444-444444444444";
const G = "55555555-5555-4555-8555-555555555555";
const MUESTRAS = path.resolve(__dirname, "../../../../public/instagram/reels/muestras");

type Fila = Record<string, unknown>;

/** Supabase mínimo: filtros eq/gte/in/or de PostgREST que usa el motor, y Storage en un Map. */
function supabaseFalso(tablas: Record<string, Fila[]>, objetos: Map<string, Buffer>) {
  const cumple = (f: Fila, filtro: URLSearchParams) => {
    for (const [k, v] of filtro.entries()) {
      if (["select", "order"].includes(k)) continue;
      if (k === "or") {
        // or=(estado.eq.pendiente,and(estado.eq.procesando,lease_hasta.lt.X))
        const pend = f.estado === "pendiente";
        const m = /lease_hasta\.lt\.([^)]+)\)/.exec(v);
        const vencida = f.estado === "procesando" && m && f.lease_hasta && String(f.lease_hasta) < decodeURIComponent(m[1]);
        if (!pend && !vencida) return false;
        continue;
      }
      const [op, ...resto] = v.split(".");
      const val = resto.join(".");
      if (op === "eq" && String(f[k]) !== val) return false;
      if (op === "gte" && !(Number(f[k]) >= Number(val))) return false;
      if (op === "in" && !val.replace(/[()]/g, "").split(",").includes(String(f[k]))) return false;
    }
    return true;
  };
  const llamadas: string[] = [];
  const f: typeof fetch = async (entrada, init = {}) => {
    const url = new URL(String(entrada));
    const metodo = (init.method ?? "GET").toUpperCase();
    llamadas.push(`${metodo} ${url.pathname}`);
    const st = /^\/storage\/v1\/object\/(?:authenticated\/)?rrss\/(.+)$/.exec(url.pathname);
    if (st) {
      const ruta = decodeURIComponent(st[1]);
      if (metodo === "GET") {
        const b = objetos.get(ruta);
        return b ? new Response(new Uint8Array(b)) : new Response("{}", { status: 404 });
      }
      objetos.set(ruta, Buffer.from(init.body as Uint8Array));
      return new Response("{}");
    }
    const t = /^\/rest\/v1\/(\w+)$/.exec(url.pathname);
    if (t) {
      const filas = (tablas[t[1]] ??= []);
      if (metodo === "GET") return Response.json(filas.filter((x) => cumple(x, url.searchParams)));
      if (metodo === "PATCH") {
        const cambios = JSON.parse(String(init.body));
        const tocadas = filas.filter((x) => cumple(x, url.searchParams));
        tocadas.forEach((x) => Object.assign(x, cambios));
        return Response.json(tocadas);
      }
      if (metodo === "POST") {
        const fila = { id: crypto.randomUUID(), ...JSON.parse(String(init.body)) };
        filas.push(fila);
        return Response.json([fila]);
      }
    }
    return new Response("no", { status: 500 });
  };
  return { f, llamadas };
}

let ffmpeg = "";
beforeAll(async () => {
  ffmpeg = await rutaFfmpeg();
});

function sesion(f: typeof fetch): SesionRrss {
  return { usuario: "u", token: "a.b.c", sb: { url: "http://sb.local", clave: "anon" }, fetch: f };
}

describe("trabajo del motor", () => {
  it("analiza una foto (previa de 1024 px y medidas) y genera un carrusel editado de verdad", async () => {
    const objetos = new Map<string, Buffer>([
      [`originales/${P}/${F1}.jpg`, readFileSync(path.join(MUESTRAS, "arroz.jpg"))],
      [`originales/${P}/${F2}.jpg`, readFileSync(path.join(MUESTRAS, "gambas.jpg"))],
    ]);
    const tablas: Record<string, Fila[]> = {
      rrss_proyectos: [{ id: P, marca: "casa-tomas", canal: "instagram", tipo: "carrusel", estilo: "natural", permitir_creativo: false }],
      rrss_archivos: [
        { id: F1, proyecto_id: P, tipo: "foto", ruta: `originales/${P}/${F1}.jpg`, mime: "image/jpeg", bytes: 1, ancho: null, alto: null, duracion_s: null, estado: "subido", analisis: {}, orden: 0 },
        { id: F2, proyecto_id: P, tipo: "foto", ruta: `originales/${P}/${F2}.jpg`, mime: "image/jpeg", bytes: 1, ancho: null, alto: null, duracion_s: null, estado: "subido", analisis: {}, orden: 1 },
      ],
      rrss_resultados: [{ id: "viejo", proyecto_id: P, indice: 0, vigente: true }],
      rrss_generaciones: [
        {
          id: G, proyecto_id: P, medio: "foto", piezas: null, estado: "pendiente", intentos: 0, lease_hasta: null,
          plan: {
            estilo: "natural",
            piezas: [
              { tipo: "foto", archivo: F1, correccion: { exposicion: 0.2 }, encuadre: { x: 0.5, y: 0.5, zoom: 1.2 }, rotulos: { titulo: "Arroz del señorito", posicion: "abajo" }, logo: true, creativo: "fondo-marca" },
              { tipo: "foto", archivo: F2, correccion: {}, encuadre: { x: 0.5, y: 0.5, zoom: 1 }, rotulos: null },
            ],
            textos: { caption: "Hoy, arroz", hashtags: ["#arroz", "crevillent"] },
          },
        },
      ],
    };
    const { f } = supabaseFalso(tablas, objetos);
    const s = sesion(f);
    const a = await analizarArchivo(s, F1, { sharp });
    expect([a.estado, a.ancho, a.alto]).toEqual(["listo", 720, 960]);
    const previa = objetos.get(`previas/${P}/${F1}.jpg`)!;
    expect((await sharp(previa).metadata()).format).toBe("jpeg");

    const g = await reclamarGeneracion(s, G, { sharp }, "foto");
    expect(g?.estado).toBe("procesando");
    // Un segundo intento a la vez no la reclama (no hay generaciones duplicadas).
    expect(await reclamarGeneracion(s, G, { sharp }, "foto")).toBeNull();
    const r = await procesarGeneracion(s, g!, { sharp });
    expect(r).toEqual({ estado: "listo" });
    const gen = tablas.rrss_generaciones[0];
    expect(gen.estado).toBe("listo");
    // El fondo creativo NO se aplica: el trabajo no lo permite.
    expect((gen.avisos as string[]).join(" ")).toMatch(/no están permitidas las transformaciones creativas/);
    const res0 = objetos.get(`resultados/${P}/${G}/0.jpg`)!;
    const m = await sharp(res0).metadata();
    expect([m.width, m.height]).toEqual([1080, 1350]);
    expect(objetos.has(`resultados/${P}/${G}/1.jpg`)).toBe(true);
    // El original sigue igual y el resultado anterior de la pieza 0 ya no es vigente.
    expect(objetos.get(`originales/${P}/${F1}.jpg`)!.equals(readFileSync(path.join(MUESTRAS, "arroz.jpg")))).toBe(true);
    expect(tablas.rrss_resultados.find((x) => x.id === "viejo")!.vigente).toBe(false);
    expect(tablas.rrss_resultados.filter((x) => x.vigente !== false)).toHaveLength(2);
  }, 60_000);

  it("analiza un vídeo (duración, hoja de contactos y audio) y monta el reel", async () => {
    const dir = (await import("node:os")).tmpdir();
    const clip = path.join(dir, `rrss-trabajo-${Date.now()}.mp4`);
    await ejecutar(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=1280x720:r=30:d=4", "-f", "lavfi", "-i", "sine=f=330:d=4", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", clip]);
    const objetos = new Map<string, Buffer>([[`originales/${P}/${V1}.mp4`, readFileSync(clip)], [`originales/${P}/${F1}.jpg`, readFileSync(path.join(MUESTRAS, "chuleton.jpg"))]]);
    const tablas: Record<string, Fila[]> = {
      rrss_proyectos: [{ id: P, marca: "touza", canal: "instagram", tipo: "reel", estilo: "moderno", permitir_creativo: false }],
      rrss_archivos: [
        { id: V1, proyecto_id: P, tipo: "video", ruta: `originales/${P}/${V1}.mp4`, mime: "video/mp4", bytes: 1, ancho: null, alto: null, duracion_s: null, estado: "subido", analisis: {}, orden: 0 },
        { id: F1, proyecto_id: P, tipo: "foto", ruta: `originales/${P}/${F1}.jpg`, mime: "image/jpeg", bytes: 1, ancho: 720, alto: 755, duracion_s: null, estado: "listo", analisis: {}, orden: 1 },
      ],
      rrss_resultados: [],
      rrss_generaciones: [],
    };
    const { f } = supabaseFalso(tablas, objetos);
    const s = sesion(f);
    const a = await analizarArchivo(s, V1, { sharp, ffmpeg });
    expect([a.estado, a.ancho, a.alto, Number(a.duracion_s)]).toEqual(["listo", 1280, 720, 4]);
    expect(a.analisis.tiene_audio).toBe(true);
    expect(objetos.has(`previas/${P}/${V1}-hoja.jpg`)).toBe(true);
    expect(objetos.has(`audio/${P}/${V1}.m4a`)).toBe(true);
    // La IA transcribió la voz (simulado) → subtítulos.
    (tablas.rrss_archivos[0].analisis as Fila).transcripcion = [{ inicio: 0.5, fin: 2, texto: "Bienvenidos a Touza" }];
    tablas.rrss_generaciones.push({
      id: G, proyecto_id: P, medio: "video", piezas: null, estado: "pendiente", intentos: 0, lease_hasta: null,
      plan: { piezas: [{ tipo: "video", tomas: [{ archivo: V1, inicio: 0, fin: 3 }, { archivo: F1, inicio: 0, fin: 2, movimiento: "acercar" }], titulos: [{ texto: "Noche en Touza", inicio: 0.2, fin: 2 }], subtitulos: true, transicion: "deslizar", duracionTransicion: 0.4, cierre: { mostrar: true, cta: "Ven esta noche" }, logo: true }] },
    });
    const progresos: unknown[] = [];
    const g = await reclamarGeneracion(s, G, { sharp, ffmpeg }, "video");
    const r = await procesarGeneracion(s, g!, { sharp, ffmpeg });
    expect(r).toEqual({ estado: "listo" });
    progresos.push(tablas.rrss_generaciones[0].progreso);
    const res = tablas.rrss_resultados[0];
    expect([res.medio, res.ancho, res.alto]).toEqual(["video", 1080, 1920]);
    expect(Number(res.duracion_s)).toBeGreaterThan(6.5);
    expect((res.receta as Fila).subtitulos).toBe(1);
    expect(objetos.has(`resultados/${P}/${G}/0.mp4`)).toBe(true);
    expect(objetos.has(`resultados/${P}/${G}/0-portada.jpg`)).toBe(true);
  }, 180_000);

  it("una foto ilegible deja la generación en error con el motivo", async () => {
    const objetos = new Map<string, Buffer>([[`originales/${P}/${F1}.jpg`, Buffer.from("no es una foto")]]);
    const tablas: Record<string, Fila[]> = {
      rrss_proyectos: [{ id: P, marca: "casa-tomas", canal: "facebook", tipo: "publicacion", estilo: "marca", permitir_creativo: false }],
      rrss_archivos: [{ id: F1, proyecto_id: P, tipo: "foto", ruta: `originales/${P}/${F1}.jpg`, mime: "image/jpeg", bytes: 1, ancho: 10, alto: 10, duracion_s: null, estado: "listo", analisis: {}, orden: 0 }],
      rrss_resultados: [],
      rrss_generaciones: [{ id: G, proyecto_id: P, medio: "foto", piezas: null, estado: "pendiente", intentos: 0, lease_hasta: null, plan: { piezas: [{ tipo: "foto", archivo: F1 }] } }],
    };
    const { f } = supabaseFalso(tablas, objetos);
    const s = sesion(f);
    const g = await reclamarGeneracion(s, G, { sharp }, "foto");
    const r = await procesarGeneracion(s, g!, { sharp });
    expect(r.estado).toBe("error");
    expect(tablas.rrss_generaciones[0].estado).toBe("error");
    expect(String(tablas.rrss_generaciones[0].error)).toMatch(/No se pudo leer la foto/);
  });

  it("el manejador HTTP exige sesión con «Editar», valida la entrada y responde 202 en segundo plano", async () => {
    const pedir = (cuerpo: unknown) => new Request("http://x/api/rrss-foto", { method: "POST", headers: { authorization: "Bearer a.b.c", "content-type": "application/json" }, body: JSON.stringify(cuerpo) });
    const sinPermiso = await manejarPost(pedir({ accion: "generar", generacionId: G }), { medio: "foto", dependencias: async () => ({ sharp }), autorizar: async () => ({ ok: false, estado: 403, motivo: "Hace falta «Editar» en Marketing para usar el editor" }) });
    expect(sinPermiso.status).toBe(403);
    const tablas: Record<string, Fila[]> = { rrss_generaciones: [{ id: G, proyecto_id: P, medio: "video", piezas: null, estado: "pendiente", intentos: 0, plan: {} }] };
    const { f } = supabaseFalso(tablas, new Map());
    const autorizar = async () => ({ ok: true as const, sesion: sesion(f) });
    expect((await manejarPost(pedir({ accion: "generar", generacionId: "x" }), { medio: "foto", dependencias: async () => ({ sharp }), autorizar })).status).toBe(400);
    // Generación de vídeo pedida al motor de fotos: 400 y NO se reclama.
    const otra = await manejarPost(pedir({ accion: "generar", generacionId: G }), { medio: "foto", dependencias: async () => ({ sharp }), autorizar });
    expect(otra.status).toBe(400);
    expect(tablas.rrss_generaciones[0].estado).toBe("pendiente");
    let enCola: Promise<unknown> | null = null;
    const ok = await manejarPost(pedir({ accion: "generar", generacionId: G }), { medio: "video", dependencias: async () => ({ sharp, ffmpeg }), autorizar, segundoPlano: (t) => ((enCola = t), true) });
    expect(ok.status).toBe(202);
    await enCola;
  }, 60_000);
});
