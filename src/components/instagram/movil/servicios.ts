/**
 * Todo lo que el asistente móvil necesita de fuera, en un solo objeto
 * inyectable: así las pruebas y la demo usan la versión SIMULADA (sin red ni
 * cuota de IA) y la app, la real.
 */
import type { MarcaId } from "@/lib/instagram";
import type { EstiloFeed, FotoParaMontar } from "@/lib/instagram/montar";
import { leerEstiloFeed } from "@/components/instagram/ajustes/estiloFeed";
import { convertirFoto } from "@/components/marketing/instagram/convertirFoto";
import { almacenPorDefecto, crearAlmacenMemoria, type Almacen } from "./almacen";
import { apiPublicacionReal, archivarEnDrive, listarPlatosCarta, prepararPlatoCarta, subirFotoTmp, type PlatoCarta } from "./apiReal";
import { crearMontarSimulado, montarPieza, type FuncionMontar } from "./montar";
import { crearApiPublicacionSimulada, type ApiPublicacionMovil } from "./publicar";
import { enLinea, type OpcionesReintento } from "./reintentos";

export type { PlatoCarta };

export interface FotoConvertidaMovil {
  blob: Blob;
  ancho: number | null;
  alto: number | null;
}

export interface ServiciosMovil {
  /** Fichero de la cámara o del carrete → JPEG (orientación EXIF aplicada, ≤ 2560 px). */
  convertir(f: File): Promise<FotoConvertidaMovil>;
  /** Un intento de subida a tmp/<uuid>.jpg (los reintentos los pone el asistente). */
  subirFoto(blob: Blob, uuid: string, medidas: { ancho: number | null; alto: number | null }): Promise<FotoParaMontar>;
  listarCarta(marca: MarcaId): Promise<PlatoCarta[]>;
  prepararCarta(marca: MarcaId, platoId: string): Promise<FotoParaMontar>;
  montar: FuncionMontar;
  /** Estilo del feed de RRSS › Instagram › Ajustes (sin él, «Solo foto»). */
  estiloFeed?(): Promise<EstiloFeed>;
  api: ApiPublicacionMovil;
  /** Archivo en Drive tras publicar (segundo plano). */
  archivar(fotos: Array<{ blob: Blob }>, marca: MarcaId, descripcion: string): Promise<number>;
  almacen: Almacen;
  enLinea(): boolean;
  /** Ajustes de los reintentos (las pruebas ponen las esperas a 0). */
  reintento?: Omit<OpcionesReintento, "signal" | "alReintentar">;
}

export function serviciosReales(): ServiciosMovil {
  return {
    convertir: async (f) => {
      const r = await convertirFoto(f);
      return { blob: r.blob, ancho: r.ancho, alto: r.alto };
    },
    subirFoto: subirFotoTmp,
    listarCarta: listarPlatosCarta,
    prepararCarta: prepararPlatoCarta,
    montar: montarPieza,
    estiloFeed: leerEstiloFeed,
    api: apiPublicacionReal,
    archivar: archivarEnDrive,
    almacen: almacenPorDefecto(),
    enLinea,
  };
}

/** Foto de muestra para la carta simulada (SVG de color con el nombre). */
function muestra(nombre: string, color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><rect width="100%" height="100%" fill="${color}"/><text x="50%" y="50%" font-family="Georgia,serif" font-size="90" fill="#fff" text-anchor="middle">${nombre}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const CARTA_SIMULADA: PlatoCarta[] = [
  { id: "101", nombre: "Chuleta de vaca", url: muestra("Chuleta", "#7a2e1d") },
  { id: "102", nombre: "Pulpo a la gallega", url: muestra("Pulpo", "#8a5a2b") },
  { id: "103", nombre: "Centolla", url: muestra("Centolla", "#b4472a") },
  { id: "104", nombre: "Tarta de queso", url: muestra("Tarta", "#c49a4a") },
];

/**
 * Servicios simulados: subidas a object URLs, carta de muestra, IA y
 * publicación falsas. `espera` (ms) imita la red; 0 en las pruebas.
 */
export function serviciosSimulados(o: { espera?: number } = {}): ServiciosMovil {
  const espera = o.espera ?? 0;
  const pausa = () => (espera ? new Promise((r) => setTimeout(r, espera)) : Promise.resolve());
  const urlDe = (blob: Blob) => (typeof URL.createObjectURL === "function" ? URL.createObjectURL(blob) : `blob:simulada/${Math.random().toString(36).slice(2)}`);
  return {
    convertir: async (f) => {
      if (typeof createImageBitmap === "function") {
        try {
          const r = await convertirFoto(f);
          return { blob: r.blob, ancho: r.ancho, alto: r.alto };
        } catch {
          /* cae al fichero tal cual */
        }
      }
      return { blob: f, ancho: 1080, alto: 1350 };
    },
    subirFoto: async (blob, uuid, medidas) => {
      await pausa();
      return { id: `subida:${uuid}`, url: urlDe(blob), ancho: medidas.ancho, alto: medidas.alto };
    },
    listarCarta: async () => {
      await pausa();
      return CARTA_SIMULADA;
    },
    prepararCarta: async (_marca, platoId) => {
      await pausa();
      const p = CARTA_SIMULADA.find((x) => x.id === platoId);
      return { id: `carta:${platoId}`, url: p?.url ?? "", ancho: 1080, alto: 1350 };
    },
    montar: crearMontarSimulado({ espera: espera * 4 }),
    api: crearApiPublicacionSimulada({ espera }),
    archivar: async (fotos) => {
      await pausa();
      return fotos.length;
    },
    almacen: crearAlmacenMemoria(),
    enLinea,
  };
}
