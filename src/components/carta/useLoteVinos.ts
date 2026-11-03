import { useCallback, useEffect, useRef, useState } from "react";
import { leerVinoDeFoto, type VinoDesdeFoto } from "./leerVinoFoto";
import { hacerFotoCarta } from "./fotoCartaVino";
import { destinoRecorteActual } from "./recorte/useRecorteVino";

/** Lecturas a la vez (cada una es una llamada a la IA). */
export const CONCURRENCIA_LOTE = 2;

export type EstadoFila = "cola" | "leyendo" | "listo" | "error" | "guardado";
/**
 * "diferido": móvil/tablet. Aquí no se recorta (memoria); el formulario de
 * cada botella guarda la foto y DESPUÉS el servidor le quita el fondo o, si
 * falla, un ordenador (trasGuardarFotoCarta), como en la ficha suelta.
 */
export type EstadoRecorteFila = "recortando" | "listo" | "fallo" | "diferido";

export interface FilaLote {
  id: string;
  archivo: File;
  /** Object URL de la miniatura (original mientras se lee, recortada después). */
  miniatura: string;
  estado: EstadoFila;
  resultado?: VinoDesdeFoto;
  /** Recorte sin fondo (en segundo plano tras leer la etiqueta). */
  recorte?: EstadoRecorteFila;
  /** Object URL del sticker (botella sin fondo) cuando está listo. */
  sticker?: string;
  /** Motivo del fallo de la lectura (p. ej. cuenta de OpenAI sin saldo). */
  motivoError?: string;
}

let contador = 0;
const nuevoId = () => `f${Date.now().toString(36)}${(contador++).toString(36)}`;

/** Cola de fotos con lectura en paralelo (máx. CONCURRENCIA_LOTE). Vive fuera del diálogo para no perderse al abrir el formulario. */
export function useLoteVinos(categorias: string[]) {
  const [filas, setFilas] = useState<FilaLote[]>([]);
  const lanzadas = useRef(new Set<string>());
  const urls = useRef(new Set<string>());
  const montado = useRef(true);
  const categoriasRef = useRef(categorias);
  categoriasRef.current = categorias;

  const crearUrl = (b: Blob) => {
    const u = URL.createObjectURL(b);
    urls.current.add(u);
    return u;
  };
  const liberarUrl = (u: string) => {
    if (urls.current.delete(u)) URL.revokeObjectURL(u);
  };

  useEffect(() => {
    montado.current = true;
    const set = urls.current;
    return () => {
      montado.current = false;
      set.forEach((u) => URL.revokeObjectURL(u));
      set.clear();
    };
  }, []);

  const añadir = useCallback((archivos: File[]) => {
    const nuevas = archivos
      .filter((f) => f.type.startsWith("image/") || f.type === "")
      .map<FilaLote>((archivo) => ({ id: nuevoId(), archivo, miniatura: crearUrl(archivo), estado: "cola" }));
    if (nuevas.length) setFilas((prev) => [...prev, ...nuevas]);
  }, []);

  const quitar = useCallback((id: string) => {
    setFilas((prev) => {
      const f = prev.find((x) => x.id === id);
      if (f) liberarUrl(f.miniatura);
      if (f?.sticker) liberarUrl(f.sticker);
      return prev.filter((x) => x.id !== id);
    });
  }, []);

  const vaciar = useCallback(() => {
    setFilas((prev) => {
      prev.forEach((f) => {
        liberarUrl(f.miniatura);
        if (f.sticker) liberarUrl(f.sticker);
      });
      return [];
    });
  }, []);

  const reintentar = useCallback((id: string) => {
    lanzadas.current.delete(id);
    setFilas((prev) => prev.map((f) => (f.id === id ? { ...f, estado: "cola" } : f)));
  }, []);

  const marcarGuardado = useCallback((id: string) => {
    setFilas((prev) => prev.map((f) => (f.id === id ? { ...f, estado: "guardado" } : f)));
  }, []);

  // Planificador: arranca filas en cola mientras haya hueco.
  useEffect(() => {
    const activas = filas.filter((f) => f.estado === "leyendo").length;
    const hueco = CONCURRENCIA_LOTE - activas;
    if (hueco <= 0) return;
    const siguientes = filas.filter((f) => f.estado === "cola" && !lanzadas.current.has(f.id)).slice(0, hueco);
    if (!siguientes.length) return;
    siguientes.forEach((f) => lanzadas.current.add(f.id));
    const ids = new Set(siguientes.map((f) => f.id));
    setFilas((prev) => prev.map((f) => (ids.has(f.id) ? { ...f, estado: "leyendo" } : f)));
    siguientes.forEach((fila) => {
      leerVinoDeFoto(fila.archivo, categoriasRef.current)
        .then((resultado) => {
          if (!montado.current) return;
          // URLs fuera del updater (StrictMode lo llama dos veces).
          const mini = crearUrl(resultado.foto);
          // Móvil: nada de modelo aquí; el fondo se pone al guardar cada botella.
          if (destinoRecorteActual() !== "formulario") {
            setFilas((prev) =>
              prev.map((f) => (f.id === fila.id ? { ...f, estado: "listo", resultado, miniatura: mini, recorte: "diferido" } : f)),
            );
            liberarUrl(fila.miniatura);
            return;
          }
          // Recorte en segundo plano (el worker los hace de uno en uno); el
          // formulario espera esta misma promesa si se abre antes de acabar.
          const recorte = hacerFotoCarta(resultado.foto);
          setFilas((prev) =>
            prev.map((f) =>
              f.id === fila.id ? { ...f, estado: "listo", resultado: { ...resultado, recorte }, miniatura: mini, recorte: "recortando" } : f,
            ),
          );
          liberarUrl(fila.miniatura);
          recorte.then(
            (r) => {
              if (!montado.current) return;
              const sticker = crearUrl(r.sticker);
              setFilas((prev) => prev.map((f) => (f.id === fila.id ? { ...f, recorte: "listo", sticker } : f)));
            },
            (e) => {
              console.warn("[recorte] lote", e);
              if (!montado.current) return;
              setFilas((prev) => prev.map((f) => (f.id === fila.id ? { ...f, recorte: "fallo" } : f)));
            },
          );
        })
        .catch((e) => {
          console.error("[extraer-vino-foto] lote", e);
          if (!montado.current) return;
          const motivoError = e instanceof Error && e.message ? e.message : undefined;
          setFilas((prev) => prev.map((f) => (f.id === fila.id ? { ...f, estado: "error", motivoError } : f)));
        })
        .finally(() => {
          lanzadas.current.delete(fila.id);
        });
    });
  }, [filas]);

  return { filas, añadir, quitar, vaciar, reintentar, marcarGuardado };
}

export type LoteVinos = ReturnType<typeof useLoteVinos>;
