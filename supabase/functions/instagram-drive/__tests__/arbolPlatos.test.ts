// @vitest-environment node
/**
 * instagram-drive · árbol Platos/<NN Categoría>/<plato>/ (15/11/2026), sin red:
 * listar_platos (categoría → plato → fotos, «ORIGINAL» primero, sin crear nada),
 * miniatura y preparar de fotos del árbol (estaBajo: ancestros, con tope), y
 * que lo que cuelga de fuera del árbol sigue sin servirse.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { manejarDrive } from "../drive.ts";
import { olvidarSecretos } from "../../_shared/instagram/secretos.ts";
import { olvidarTokenDrive } from "../../_shared/google-drive.ts";
import { estaBajo, leerConfigDrive, nombreCarpetaFicha, nombreOriginalArbol, normalizarNombre, olvidarCarpetasDrive, sinPrefijoNumero } from "../../_shared/instagram/drive.ts";
import { driveFalso, ENV_DRIVE, ENV_SB, falso, JWT, RAIZ_DRIVE, SB } from "../../_shared/instagram/__tests__/simulacion.ts";

const ENV = { ...ENV_SB, ...ENV_DRIVE };
const CARPETA = "application/vnd.google-apps.folder";
type Drive = ReturnType<typeof driveFalso>;

function carpeta(d: Drive, nombre: string, padre: string): string {
  const hay = [...d.ficheros.values()].find((x) => x.name === nombre && x.parents?.includes(padre));
  if (hay) return hay.id;
  const id = `1Carpeta${String(d.ficheros.size).padStart(20, "0")}`;
  d.ficheros.set(id, { id, name: nombre, mimeType: CARPETA, parents: [padre] });
  return id;
}
function foto(d: Drive, id: string, nombre: string, padre: string) {
  d.ficheros.set(id, { id, name: nombre, mimeType: "image/jpeg", size: "200000", createdTime: "2026-11-01T10:00:00Z", parents: [padre], imageMediaMetadata: { width: 3000, height: 2000 } });
}
const listar = (marca = "casa-tomas") =>
  new Request(`${SB}/functions/v1/instagram-drive`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${JWT}` },
    body: JSON.stringify({ accion: "listar_platos", marca }),
  });
const mini = (marca: string, id: string) => new Request(`${SB}/functions/v1/instagram-drive?accion=miniatura&marca=${marca}&id=${id}`, { headers: { Authorization: `Bearer ${JWT}` } });

beforeEach(() => {
  olvidarSecretos();
  olvidarTokenDrive();
  olvidarCarpetasDrive();
});

describe("nombres", () => {
  it("normaliza sin tildes ni mayúsculas y quita el «NN » de la categoría", () => {
    expect(normalizarNombre("  CHULETÓN  de Vaca ")).toBe("chuleton de vaca");
    expect(sinPrefijoNumero("03 Entrantes fríos")).toBe("Entrantes fríos");
    expect(sinPrefijoNumero("Snack")).toBe("Snack");
    expect(nombreOriginalArbol("Arroz / meloso", "x")).toBe("ORIGINAL - Arroz meloso.jpg");
    expect(nombreCarpetaFicha("  ", "id-1")).toBe("id-1");
  });
});

describe("instagram-drive · listar_platos", () => {
  it("devuelve categoría → plato → fotos del primer nivel, con la ORIGINAL primero y sin entrar en Vídeos", async () => {
    const d = driveFalso();
    const platos = carpeta(d, "Platos", RAIZ_DRIVE);
    const carnes = carpeta(d, "09 Carnes", platos);
    const postres = carpeta(d, "11 Postres", platos);
    const chuleton = carpeta(d, "Chuletón", carnes);
    foto(d, "1FotoToma0000000000000001", "Chuletón - IMG_1.jpg", chuleton);
    foto(d, "1FotoOriginal00000000000001", "ORIGINAL - Chuletón.jpg", chuleton);
    foto(d, "1FotoEnVideos000000000000001", "x.jpg", carpeta(d, "Vídeos", chuleton));
    carpeta(d, "Flan", postres);
    const e = falso({ drive: d.m });
    const r = await manejarDrive(listar(), { env: ENV, fetch: e.f });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.categorias.map((c: { nombre: string }) => c.nombre)).toEqual(["09 Carnes", "11 Postres"]);
    const [carnesR, postresR] = j.categorias;
    expect(carnesR.platos).toHaveLength(1);
    expect(carnesR.platos[0].nombre).toBe("Chuletón");
    expect(carnesR.platos[0].fotos.map((f: { nombre: string }) => f.nombre)).toEqual(["ORIGINAL - Chuletón.jpg", "Chuletón - IMG_1.jpg"]);
    expect(postresR.platos[0]).toMatchObject({ nombre: "Flan", fotos: [] });
    expect(j.truncado).toBe(false);
  });

  it("sin carpeta «Platos» no crea nada: lista vacía y un aviso; con touza, vacío", async () => {
    const d = driveFalso();
    const e = falso({ drive: d.m });
    const antes = d.ficheros.size;
    const j = await (await manejarDrive(listar(), { env: ENV, fetch: e.f })).json();
    expect(j).toMatchObject({ ok: true, categorias: [] });
    expect(j.avisos[0]).toMatch(/Platos/);
    expect(d.ficheros.size).toBe(antes);
    const t = await (await manejarDrive(listar("touza"), { env: ENV, fetch: e.f })).json();
    expect(t.categorias).toEqual([]);
  });
});

describe("instagram-drive · miniatura de fotos del árbol (estaBajo)", () => {
  it("sirve una foto de Platos/<cat>/<plato>/ y de Platos/<cat>/<plato>/Vídeos, pero no una de fuera del árbol ni en touza", async () => {
    const d = driveFalso();
    const plato = carpeta(d, "Chuletón", carpeta(d, "09 Carnes", carpeta(d, "Platos", RAIZ_DRIVE)));
    foto(d, "1FotoEnArbol000000000000001", "a.jpg", plato);
    foto(d, "1FotoEnVideos00000000000001", "b.jpg", carpeta(d, "Vídeos", plato));
    foto(d, "1FotoFueraArbol00000000001", "c.jpg", carpeta(d, "Local", RAIZ_DRIVE));
    const e = falso({ drive: d.m });
    const p = { env: ENV, fetch: e.f };
    expect((await manejarDrive(mini("casa-tomas", "1FotoEnArbol000000000000001"), p)).status).not.toBe(404);
    expect((await manejarDrive(mini("casa-tomas", "1FotoEnVideos00000000000001"), p)).status).not.toBe(404);
    expect((await manejarDrive(mini("casa-tomas", "1FotoFueraArbol00000000001"), p)).status).toBe(404);
    expect((await manejarDrive(mini("touza", "1FotoEnArbol000000000000001"), p)).status).toBe(404);
  });

  it("las fotos de instagram/fotos/<marca> se siguen sirviendo como antes", async () => {
    const d = driveFalso();
    d.ponerFoto("casa-tomas", { id: "1FotoAntigua000000000000001", thumbnailLink: "https://lh3.googleusercontent.com/x=s220" });
    const e = falso({ drive: d.m });
    expect((await manejarDrive(mini("casa-tomas", "1FotoAntigua000000000000001"), { env: ENV, fetch: e.f })).status).toBe(200);
  });
});

describe("estaBajo", () => {
  it("sube de padre en padre hasta la raíz, con tope y sin pasar de marketing", async () => {
    const d = driveFalso();
    const raiz = carpeta(d, "Platos", RAIZ_DRIVE);
    let actual = raiz;
    for (let i = 1; i <= 8; i++) actual = carpeta(d, `n${i}`, actual);
    const e = falso({ drive: d.m });
    const cfg = leerConfigDrive(ENV, { fetch: e.f });
    if (!cfg.ok) throw new Error("config");
    const c = cfg.config;
    const cerca = carpeta(d, "cerca", carpeta(d, "cat", raiz));
    expect(await estaBajo(c, { parents: [cerca] }, [raiz])).toBe(true);
    expect(await estaBajo(c, { parents: [actual] }, [raiz])).toBe(false); // 8 niveles: pasa del tope (6)
    expect(await estaBajo(c, { parents: [actual] }, [raiz], 10)).toBe(true);
    expect(await estaBajo(c, { parents: [raiz] }, [])).toBe(false);
    expect(await estaBajo(c, {}, [raiz])).toBe(false);
    expect(await estaBajo(c, { parents: [RAIZ_DRIVE] }, [raiz])).toBe(false);
  });
});
