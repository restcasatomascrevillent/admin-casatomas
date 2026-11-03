/**
 * Móvil: el fondo se pone DESPUÉS de guardar la ficha con la foto original
 * (ver recorteMovil.ts). El fondo lo quita el SERVIDOR (quitarFondoServidor);
 * el móvil solo reduce la foto, aplica la máscara y compone con el fondo de
 * carta. La foto nunca se pierde: si algo falla, la ficha se queda con la
 * foto normal, se avisa con el motivo y se crea un trabajo para un ordenador.
 *
 * Siempre se ve algo (petición del dueño, 03-11-2026: en el iPhone «no pasaba
 * nada»): el toast de progreso sale ANTES de cualquier espera, y cualquier
 * fallo acaba en un aviso.
 */
import { toast } from "sonner";
import {
  datosDeMarca,
  EVENTO_FOTO_RECORTADA,
  ID_PESTANA,
  latirMarcasRecorte,
  leerMarcasRecorte,
  marcaHuerfana,
  marcarRecorteEnCurso,
  MS_LATIDO,
  MS_MARCA_MUERTA,
  motivoFallo,
  quitarMarcaRecorte,
  vaAOrdenador,
  type DatosRecorte,
} from "./recorteMovil";
import { ErrorFichaCambiada, recortarFotoGuardada } from "./recortarFotoGuardada";
import { quitarFondoServidor, type ProgresoServidor } from "./quitarFondoServidor";
import type { ProgresoRecorte } from "./quitarFondoNavegador";
import { mantenerPantallaEncendida } from "../video/pantallaEncendida";
import { diag } from "./diagnostico";

export { EVENTO_FOTO_RECORTADA } from "./recorteMovil";

const ID_TOAST = "recorte-movil";
export const MS_AVISO_SIN_RECORTE = 12_000;
/** Como mucho se espera esto al Wake Lock antes de seguir (en iOS la petición puede no volver nunca). */
const MS_ESPERA_PANTALLA = 1_000;

/**
 * Qué hacer con una foto guardada a la que no se ha podido poner el fondo.
 * Por defecto: avisar de que se queda la foto normal. GestorRecortes lo
 * sustituye por mandarRecorteAOrdenador (trabajo para un ordenador).
 */
export type AlNoRecortar = (d: DatosRecorte, motivo: string) => Promise<void>;

let alNoRecortar: AlNoRecortar = async (d, motivo) => avisarSinRecorte(d, motivo);

export function configurarAlNoRecortar(fn: AlNoRecortar | null): void {
  alNoRecortar = fn ?? (async (d, motivo) => avisarSinRecorte(d, motivo));
}

export function avisarSinRecorte(d: Pick<DatosRecorte, "nombre">, motivo: string, siguiente = "Abre la ficha desde un ordenador y pulsa «Quitar fondo»."): void {
  try {
    toast.warning(`Guardado con la foto normal${d.nombre ? `: ${d.nombre}` : ""}`, {
      id: ID_TOAST,
      description: `${motivo} ${siguiente}`,
      duration: MS_AVISO_SIN_RECORTE,
    });
  } catch (e) {
    console.warn("[recorte] no se pudo enseñar el aviso", e);
  }
}

/** La foto se queda sin fondo de carta: trabajo para un ordenador (o aviso). Nunca lanza. */
export function noRecortar(d: DatosRecorte, motivo: string): Promise<void> {
  return alNoRecortar(d, motivo).catch((e) => {
    console.warn("[recorte] fallo al gestionar la foto sin recortar", e);
    avisarSinRecorte(d, motivo);
  });
}

function emitirFotoRecortada(d: DatosRecorte): void {
  try {
    window.dispatchEvent(new CustomEvent(EVENTO_FOTO_RECORTADA, { detail: { tabla: d.tabla, id: d.registroId } }));
  } catch {
    /* sin window */
  }
}

export interface DependenciasMovil {
  recortar?: typeof recortarFotoGuardada;
  quitar?: (foto: Blob, onProgreso?: (p: ProgresoServidor) => void) => Promise<Blob>;
  /** Wake Lock (por defecto, el del vídeo). Devuelve la función para soltarlo. */
  pantalla?: () => Promise<() => void>;
}

/** Texto del toast según la fase (también la cola cuando hay varias fotos). */
export function textoProgresoMovil(p: ProgresoServidor | ProgresoRecorte | { fase: "cola"; delante: number } | null, nombre: string | null): { titulo: string; descripcion: string } {
  const titulo = `Poniendo el fondo de carta${nombre ? ` a ${nombre}` : ""}…`;
  switch (p?.fase) {
    case "cola":
      return { titulo, descripcion: `En cola: ${p.delante === 1 ? "hay 1 foto" : `hay ${p.delante} fotos`} antes. La foto normal ya está guardada.` };
    case "servidor":
      return { titulo, descripcion: "Quitando el fondo en el servidor… No salgas del panel." };
    case "componiendo":
      return { titulo, descripcion: "Componiendo con el fondo elegido…" };
    default:
      return { titulo, descripcion: "Subiendo la foto… La foto normal ya está guardada; no salgas del panel." };
  }
}

/** Wake Lock sin bloquear: si no contesta pronto se sigue sin él (y se suelta cuando llegue). */
async function pantallaSinBloquear(pedir: () => Promise<() => void>): Promise<() => void> {
  let soltar: (() => void) | null = null;
  let tarde = false;
  const peticion = pedir()
    .then((s) => {
      if (tarde) s();
      else soltar = s;
    })
    .catch(() => undefined);
  await Promise.race([peticion, new Promise((r) => setTimeout(r, MS_ESPERA_PANTALLA))]);
  return () => {
    tarde = true;
    try {
      soltar?.();
    } catch {
      /* nada */
    }
  };
}

// Las fotos van al servidor de una en una (una función por foto a la vez: menos memoria y no compiten).
let cola: Promise<unknown> = Promise.resolve();
let enEspera = 0;
let latido: ReturnType<typeof setInterval> | null = null;

function empezarLatido(): void {
  if (!latido) latido = setInterval(() => latirMarcasRecorte(), MS_LATIDO);
}
function pararLatidoSiNoQueda(): void {
  if (enEspera === 0 && latido) {
    clearInterval(latido);
    latido = null;
  }
}

/**
 * Pone el fondo de carta a la foto recién guardada (servidor + composición en
 * el móvil) y la deja en la ficha. Nunca lanza. Devuelve true si la ficha
 * quedó con fondo. El toast sale al momento, antes de cualquier espera.
 */
export function recortarEnMovil(d: DatosRecorte, original: Blob | null, deps: DependenciasMovil = {}): Promise<boolean> {
  const delante = enEspera;
  enEspera++;
  diag("recorte en el servidor: en marcha", { tabla: d.tabla, id: d.registroId, ruta: d.rutaOriginal, tema: d.tema, original, delante });
  try {
    toast.loading(textoProgresoMovil(delante ? { fase: "cola", delante } : null, d.nombre).titulo, {
      id: delante ? `${ID_TOAST}-${d.registroId}` : ID_TOAST,
      description: textoProgresoMovil(delante ? { fase: "cola", delante } : null, d.nombre).descripcion,
      duration: Infinity,
    });
  } catch {
    /* sin toaster: se sigue */
  }
  marcarRecorteEnCurso(d);
  empezarLatido();
  const r = cola.then(
    () => procesar(d, original, deps, delante > 0),
    () => procesar(d, original, deps, delante > 0),
  );
  cola = r.catch(() => undefined);
  return r.finally(() => {
    enEspera--;
    pararLatidoSiNoQueda();
  });
}

async function procesar(d: DatosRecorte, original: Blob | null, deps: DependenciasMovil, vieneDeCola: boolean): Promise<boolean> {
  if (vieneDeCola) toast.dismiss(`${ID_TOAST}-${d.registroId}`);
  const recortar = deps.recortar ?? recortarFotoGuardada;
  let ultimo = "";
  const onProgreso = (p: ProgresoServidor | ProgresoRecorte | null) => {
    const { titulo, descripcion } = textoProgresoMovil(p, d.nombre);
    if (descripcion === ultimo) return;
    ultimo = descripcion;
    diag("progreso", p?.fase ?? "subiendo");
    try {
      toast.loading(titulo, { id: ID_TOAST, description: descripcion, duration: Infinity });
    } catch {
      /* nada */
    }
  };
  onProgreso(null);
  const soltarPantalla = await pantallaSinBloquear(deps.pantalla ?? mantenerPantallaEncendida);
  try {
    await recortar(d, { original, onProgreso, quitar: deps.quitar ?? ((foto, p) => quitarFondoServidor(foto, { onProgreso: p })) });
    quitarMarcaRecorte(d);
    diag("recorte en el servidor: hecho", { id: d.registroId });
    toast.success(`Foto con fondo de carta guardada${d.nombre ? `: ${d.nombre}` : ""}`, { id: ID_TOAST, description: undefined, duration: 5000 });
    emitirFotoRecortada(d);
    return true;
  } catch (e) {
    quitarMarcaRecorte(d);
    if (e instanceof ErrorFichaCambiada) {
      toast.dismiss(ID_TOAST);
      return false;
    }
    const err = e as (Error & { causa?: string; estado?: number }) | null;
    console.warn("[recorte-movil] no se pudo poner el fondo", { nombre: err?.name, mensaje: err?.message, causa: err?.causa, estado: err?.estado, error: e });
    const motivo = motivoFallo(e);
    diag("recorte en el servidor: fallo", { causa: err?.causa, estado: err?.estado, mensaje: err?.message, aOrdenador: vaAOrdenador(e) });
    if (vaAOrdenador(e)) await noRecortar(d, motivo);
    else avisarSinRecorte(d, motivo, "Prueba con otra foto o pon la foto desde un ordenador.");
    return false;
  } finally {
    soltarPantalla();
  }
}

/**
 * Al abrir el panel: si quedaron marcas de recortes de otra pestaña que ya no
 * late (el panel se cerró a medias), esas fotos (guardadas sin fondo) pasan a
 * un ordenador. Si una marca aún es reciente se vuelve a mirar pasado
 * MS_MARCA_MUERTA (puede ser otra pestaña viva). Devuelve la función para
 * cancelar esa espera.
 */
export function recuperarRecorteInterrumpido(opts: { ahora?: () => number; alDetectar?: (d: DatosRecorte) => void } = {}): () => void {
  const ahora = opts.ahora ?? Date.now;
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const comprobar = (reintento: boolean) => {
    let quedanVivas = false;
    for (const m of leerMarcasRecorte()) {
      if (m.pestana === ID_PESTANA) continue;
      if (!marcaHuerfana(m, ahora())) {
        quedanVivas = true;
        continue;
      }
      quitarMarcaRecorte(m);
      const datos = datosDeMarca(m);
      opts.alDetectar?.(datos);
      console.warn("[recorte-movil] el panel se cerró antes de poner el fondo a esta foto", m);
      void noRecortar(datos, "El panel se cerró antes de terminar de ponerle el fondo.");
    }
    if (quedanVivas && !reintento) temporizador = setTimeout(() => comprobar(true), MS_MARCA_MUERTA + 1000);
  };
  comprobar(false);
  return () => {
    if (temporizador) clearTimeout(temporizador);
  };
}
