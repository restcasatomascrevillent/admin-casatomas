/**
 * Subida de archivos del Editor IA: validación previa, cola de 2 en 2,
 * progreso, análisis del motor y reintentos. Vive en el editor (no en el
 * paso) para que siga funcionando si la persona cambia de paso.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  analizarArchivo,
  mensajeError,
  medioDeArchivo,
  problemaArchivo,
  subirArchivo,
  type Archivo,
} from "@/components/rrss/api";
import type { Medio } from "@/lib/rrss/formatos";
import { CLAVES } from "./useTrabajo";
import { urlLocal } from "./util";

export const SUBIDAS_A_LA_VEZ = 2;

export interface Subida {
  clave: string;
  proyectoId: string;
  nombre: string;
  bytes: number;
  medio: Medio;
  orden: number;
  fase: "subiendo" | "preparando" | "error";
  /** 0…1 */
  progreso: number;
  error?: string;
  urlLocal?: string;
  /** La fila ya creada en la base (la subida acabó; falta o falló el análisis). */
  archivo?: Archivo;
  file: File;
}

interface Opciones {
  trabajoId: string | null;
  /** Crea el trabajo con los archivos que van a subirse y devuelve su id. */
  asegurarTrabajo: (archivos: File[]) => Promise<string>;
  /** Cuántos archivos hay ya guardados (para el orden). */
  totalGuardados: number;
}

export function useSubidas({ trabajoId, asegurarTrabajo, totalGuardados }: Opciones) {
  const qc = useQueryClient();
  const [subidas, setSubidas] = useState<Subida[]>([]);
  const [rechazos, setRechazos] = useState<string[]>([]);
  const [enReintento, setEnReintento] = useState<Set<string>>(new Set());
  const mapa = useRef(new Map<string, Subida>());
  const cola = useRef<string[]>([]);
  const enMarcha = useRef(0);
  const bombearRef = useRef<() => void>(() => undefined);

  const actualizar = useCallback((clave: string, cambios: Partial<Subida>) => {
    const previo = mapa.current.get(clave);
    if (previo) mapa.current.set(clave, { ...previo, ...cambios });
    setSubidas((s) => s.map((x) => (x.clave === clave ? { ...x, ...cambios } : x)));
  }, []);

  const procesar = useCallback(
    async (clave: string) => {
      const it = mapa.current.get(clave);
      if (!it) return;
      try {
        let a = it.archivo;
        if (!a) {
          actualizar(clave, { fase: "subiendo", error: undefined, progreso: 0 });
          a = await subirArchivo(it.proyectoId, it.file, it.orden, { alProgreso: (f) => actualizar(clave, { progreso: f }) });
          actualizar(clave, { archivo: a, progreso: 1 });
        }
        actualizar(clave, { fase: "preparando", error: undefined });
        await analizarArchivo(a);
        mapa.current.delete(clave);
        setSubidas((s) => s.filter((x) => x.clave !== clave));
      } catch (e) {
        actualizar(clave, { fase: "error", error: mensajeError(e) });
      } finally {
        void qc.invalidateQueries({ queryKey: CLAVES.archivos(it.proyectoId) });
      }
    },
    [actualizar, qc],
  );

  const bombear = useCallback(() => {
    while (enMarcha.current < SUBIDAS_A_LA_VEZ && cola.current.length > 0) {
      const clave = cola.current.shift() as string;
      enMarcha.current++;
      void procesar(clave).finally(() => {
        enMarcha.current--;
        bombearRef.current();
      });
    }
  }, [procesar]);
  useEffect(() => {
    bombearRef.current = bombear;
  }, [bombear]);

  const anadir = useCallback(
    async (lista: File[]) => {
      const problemas: string[] = [];
      const validos: File[] = [];
      for (const f of lista) {
        const p = problemaArchivo(f);
        if (p) problemas.push(p);
        else validos.push(f);
      }
      setRechazos(problemas);
      if (validos.length === 0) return;
      let id: string;
      try {
        id = trabajoId ?? (await asegurarTrabajo(validos));
      } catch (e) {
        setRechazos((r) => [...r, `No se ha podido crear el trabajo: ${mensajeError(e)}`]);
        return;
      }
      const base = totalGuardados + [...mapa.current.values()].filter((x) => x.proyectoId === id).length;
      const nuevas: Subida[] = validos.map((file, i) => ({
        clave: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${i}`,
        proyectoId: id,
        nombre: file.name,
        bytes: file.size,
        medio: medioDeArchivo(file) as Medio,
        orden: base + i,
        fase: "subiendo",
        progreso: 0,
        urlLocal: urlLocal(file),
        file,
      }));
      for (const n of nuevas) {
        mapa.current.set(n.clave, n);
        cola.current.push(n.clave);
      }
      setSubidas((s) => [...s, ...nuevas]);
      bombear();
    },
    [trabajoId, asegurarTrabajo, totalGuardados, bombear],
  );

  const reintentar = useCallback(
    (clave: string) => {
      actualizar(clave, { fase: mapa.current.get(clave)?.archivo ? "preparando" : "subiendo", error: undefined });
      cola.current.push(clave);
      bombear();
    },
    [actualizar, bombear],
  );

  const descartar = useCallback((clave: string) => {
    const it = mapa.current.get(clave);
    if (it?.urlLocal) {
      try {
        URL.revokeObjectURL(it.urlLocal);
      } catch {
        /* sin URL local que liberar */
      }
    }
    mapa.current.delete(clave);
    setSubidas((s) => s.filter((x) => x.clave !== clave));
  }, []);

  /** Reintenta el análisis de un archivo ya guardado (estado «error»). */
  const reintentarGuardado = useCallback(
    async (a: Archivo) => {
      setEnReintento((s) => new Set(s).add(a.id));
      try {
        await analizarArchivo(a);
      } catch {
        /* el estado y el motivo vuelven en la fila */
      } finally {
        setEnReintento((s) => {
          const n = new Set(s);
          n.delete(a.id);
          return n;
        });
        void qc.invalidateQueries({ queryKey: CLAVES.archivos(a.proyecto_id) });
      }
    },
    [qc],
  );

  return {
    subidas: subidas.filter((s) => s.proyectoId === trabajoId),
    rechazos,
    limpiarRechazos: () => setRechazos([]),
    enReintento,
    anadir,
    reintentar,
    descartar,
    reintentarGuardado,
    pendientes: subidas.some((s) => s.proyectoId === trabajoId),
  };
}
