// @vitest-environment node
/**
 * scripts/carta/mover-originales-a-drive.mjs: qué cuenta como original (y qué
 * NUNCA se toca), el informe de --simular y que --simular no toca la red.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cuadra, informe, inventarioDeJson, originalDeSticker, planificar, rutasBorrables, SQL_INVENTARIO } from "../mover-originales-a-drive.mjs";

const SB = "https://demo.supabase.co/storage/v1/object/public";
const P1 = "11111111-aaaa-4bbb-8ccc-000000000001";
const P2 = "11111111-aaaa-4bbb-8ccc-000000000002";
const P3 = "11111111-aaaa-4bbb-8ccc-000000000003";
const MB = 1024 * 1024;

const objetos = [
  { bucket: "platos", ruta: `${P1}-carta-jpg.webp`, bytes: 150_000 }, // sticker: se queda
  { bucket: "platos", ruta: `${P1}.jpg`, bytes: 2 * MB }, // original deducido del sticker
  { bucket: "platos", ruta: `${P1}.JPG`, bytes: 3 * MB }, // otro original de la misma ficha (por id)
  { bucket: "platos", ruta: `${P2}.png`, bytes: MB }, // foto de la web sin sticker: se queda
  { bucket: "platos", ruta: `${P1}-video.mp4`, bytes: 900_000 }, // vídeo de la web: se queda
  { bucket: "platos", ruta: `videos-originales/${P1}.mov`, bytes: 4 * MB }, // vídeo original
  { bucket: "platos", ruta: `pendientes/abc.mp4`, bytes: 5 * MB }, // trabajo en curso: se queda
  { bucket: "platos", ruta: `perdida.jpg`, bytes: 500_000 }, // huérfano: se lista, no se toca
  { bucket: "platos", ruta: `.emptyFolderPlaceholder`, bytes: 0 },
  { bucket: "vinos", ruta: `botella-carta-jpeg.webp`, bytes: 100_000 },
  { bucket: "vinos", ruta: `botella.jpeg`, bytes: MB }, // original compartido por dos vinos (Magnum)
  { bucket: "bebidas", ruta: `b1.jpg`, bytes: MB }, // fuera de alcance
];
const fichas = [
  { tabla: "Platos", id: P1, nombre: "Arroz", imagen_url: `${SB}/platos/${P1}-carta-jpg.webp?t=1`, video_url: `${SB}/platos/${P1}-video.mp4?t=2` },
  { tabla: "Platos", id: P2, nombre: "Tarta", imagen_url: `${SB}/platos/${P2}.png?t=1` },
  { tabla: "Platos", id: P3, nombre: "Sin foto", imagen_url: null },
  { tabla: "Vinos", id: "v-normal", nombre: "Pidio", imagen_url: `${SB}/vinos/botella-carta-jpeg.webp` },
  { tabla: "Vinos", id: "v-magnum", nombre: "Pidio Magnum", imagen_url: `${SB}/vinos/botella-carta-jpeg.webp` },
];

describe("mover-originales-a-drive · plan", () => {
  it("originalDeSticker como rutaOriginalDesdeCarta del panel", () => {
    expect(originalDeSticker("a-carta-jpg.webp")).toBe("a.jpg");
    expect(originalDeSticker("a-carta.webp")).toBeNull();
    expect(originalDeSticker("a.jpg")).toBeNull();
  });

  it("mueve solo originales; deja stickers, fotos de la web, vídeos de la web, pendientes/ y huérfanos", () => {
    const p = planificar({ objetos, fichas, originales: [] });
    const rutas = p.grupos.flatMap((g) => g.candidatos.map((c) => `${g.bucket}/${c.ruta}`));
    expect(new Set(rutas)).toEqual(new Set([`platos/${P1}.jpg`, `platos/${P1}.JPG`, `platos/videos-originales/${P1}.mov`, "vinos/botella.jpeg"]));
    expect(p.enUso.map((x) => x.ruta)).toEqual([`${P2}.png`]);
    expect(p.huerfanos.map((x) => x.ruta)).toEqual(["perdida.jpg"]);
    // Grupos: foto del plato P1 (2 candidatos; sube el más pesado), su vídeo y los dos vinos.
    const foto = p.grupos.find((g) => g.tipo === "foto" && g.id === P1)!;
    expect(foto.candidatos.map((c) => c.ruta)).toEqual([`${P1}.JPG`, `${P1}.jpg`]);
    expect(foto.principal).toBe(`${P1}.JPG`);
    expect(p.grupos.filter((g) => g.tabla === "Vinos").map((g) => g.id).sort()).toEqual(["v-magnum", "v-normal"]);
    expect(p.grupos.find((g) => g.tipo === "video")).toMatchObject({ id: P1, tabla: "Platos" });
    // Resumen: el fichero compartido cuenta una vez.
    expect(p.resumen).toMatchObject({ fichas: 4, subidas: 4, ficheros: 4, bytes: 2 * MB + 3 * MB + 4 * MB + MB });
    expect(p.resumen.porBucket["platos·videos"]).toEqual({ ficheros: 1, bytes: 4 * MB });
    expect(informe(p)).toMatch(/4 ficheros, 10\.00 MB/);
  });

  it("una ficha que ya tiene original en Drive no se vuelve a subir (solo se comprueba y se borra)", () => {
    const p = planificar({ objetos, fichas, originales: [{ tabla: "Platos", id: P1, drive_id: "1abc" }] });
    expect(p.grupos.find((g) => g.tipo === "foto" && g.id === P1)?.yaEnDrive).toBe(true);
    expect(p.resumen.subidas).toBe(3);
  });

  it("solo se borra lo que TODAS sus fichas tienen bien en Drive (la Magnum comparte foto)", () => {
    const p = planificar({ objetos, fichas });
    const soloNormal = rutasBorrables(p, new Set(["foto|Vinos|v-normal", `foto|Platos|${P1}`]));
    expect(soloNormal.map((x) => x.ruta).sort()).toEqual([`${P1}.JPG`, `${P1}.jpg`]);
    const ambos = rutasBorrables(p, new Set(["foto|Vinos|v-normal", "foto|Vinos|v-magnum"]));
    expect(ambos.map((x) => x.ruta)).toEqual(["botella.jpeg"]);
  });

  it("comprobación en Drive: mismo tamaño y, si Drive las sabe, mismas medidas", () => {
    expect(cuadra({ bytes: 10, ancho: 4000, alto: 3000 }, { bytes: 10, ancho: 4000, alto: 3000 })).toBe(true);
    expect(cuadra({ bytes: 10, ancho: null, alto: null }, { bytes: 10, ancho: 4000, alto: 3000 })).toBe(true);
    expect(cuadra({ bytes: 11, ancho: 4000, alto: 3000 }, { bytes: 10, ancho: 4000, alto: 3000 })).toBe(false);
    expect(cuadra({ bytes: 10, ancho: 3000, alto: 4000 }, { bytes: 10, ancho: 4000, alto: 3000 })).toBe(false);
    expect(cuadra(null, { bytes: 10 })).toBe(false);
  });

  it("lee la salida de `supabase db query -o json` (filas { fila: {...} })", () => {
    const inv = inventarioDeJson(
      JSON.stringify({
        boundary: "x",
        rows: [
          { fila: { t: "objeto", bucket: "platos", ruta: `${P1}.jpg`, bytes: 5 } },
          { fila: { t: "ficha", tabla: "Platos", id: P1, nombre: "Arroz", imagen_url: null } },
          { fila: { t: "original", tabla: "Vinos", id: "v1", drive_id: "1d" } },
        ],
      }),
    );
    expect(inv.objetos).toHaveLength(1);
    expect(inv.fichas[0]).toMatchObject({ tabla: "Platos", id: P1 });
    expect(inv.originales[0]).toMatchObject({ tabla: "Vinos", id: "v1" });
    expect(SQL_INVENTARIO).not.toMatch(/\b(delete|update|insert|drop)\b/i);
  });
});

describe("mover-originales-a-drive · --simular (por defecto)", () => {
  it("con --inventario: informa sin sesión ni red y no toca nada", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mover-originales-"));
    const fichero = path.join(dir, "inventario.json");
    writeFileSync(
      fichero,
      JSON.stringify({ rows: [...objetos.map((o) => ({ fila: { t: "objeto", ...o } })), ...fichas.map((f) => ({ fila: { t: "ficha", ...f } }))] }),
    );
    const script = path.resolve(__dirname, "../mover-originales-a-drive.mjs");
    // Sin SUPABASE_URL ni credenciales: si intentara la red, fallaría.
    const salida = execFileSync(process.execPath, [script, "--inventario", fichero, "--detalle"], {
      env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "" },
      encoding: "utf8",
    });
    expect(salida).toMatch(/SIMULACIÓN/);
    expect(salida).toMatch(/4 ficheros, 10\.00 MB/);
    expect(salida).toMatch(/huérfano platos\/perdida\.jpg/);
    expect(salida).not.toMatch(/APLICAR|borrados/);
  });

  it("--aplicar no se puede mezclar con un inventario de fichero", () => {
    const script = path.resolve(__dirname, "../mover-originales-a-drive.mjs");
    expect(() => execFileSync(process.execPath, [script, "--aplicar", "--inventario", "x.json"], { encoding: "utf8", stdio: "pipe" })).toThrow(/--aplicar lee el estado en vivo/);
  });
});
