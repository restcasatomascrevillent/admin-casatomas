import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { leerDatosVinoDeFoto, type DatosVinoFoto } from "./leerVinoFoto";
import { esCategoriaOrigenPendiente } from "@/lib/tipos-vino";

/**
 * Lectura de la etiqueta con IA DENTRO del formulario de vino (03-11-2026,
 * petición del dueño: «al tener la foto, que la IA saque qué vino es y rellene
 * la ficha, como antes»). Se lanza en paralelo al recorte y solo rellena los
 * campos VACÍOS: nunca pisa lo que el usuario haya escrito (ni mientras lee).
 */

/** Campos de texto del vino que la IA puede rellenar (el precio no: se sugiere aparte). */
export const CAMPOS_TEXTO_VINO = [
  "nombre",
  "categoria",
  "descripcion",
  "ingredientes",
  "denominacion_origen",
  "ubicacion_pais",
  "ubicacion_region",
] as const;
export type CampoTextoVino = (typeof CAMPOS_TEXTO_VINO)[number];

/**
 * Datos de la IA → valores del formulario ("" si la IA no lo sabe). Lo usa
 * también la precarga del lote. Una categoría «… — ORIGEN PENDIENTE» (la IA la
 * elige si no saca la denominación) se deja vacía: el formulario pide elegir
 * la buena y no guarda sin ella (04/11/2026).
 */
export function valoresDesdeDatosVino(d: DatosVinoFoto): Record<CampoTextoVino, string> {
  const v = {} as Record<CampoTextoVino, string>;
  for (const campo of CAMPOS_TEXTO_VINO) {
    const x = d[campo];
    v[campo] = typeof x === "string" ? x.trim() : "";
  }
  if (esCategoriaOrigenPendiente(v.categoria)) v.categoria = "";
  return v;
}

/** Solo los campos vacíos del formulario que la IA sí sabe. */
export function camposVaciosARellenar(
  actuales: Partial<Record<CampoTextoVino, unknown>>,
  d: DatosVinoFoto,
): Partial<Record<CampoTextoVino, string>> {
  const nuevos = valoresDesdeDatosVino(d);
  const out: Partial<Record<CampoTextoVino, string>> = {};
  for (const campo of CAMPOS_TEXTO_VINO) {
    const actual = actuales[campo];
    const vacio = actual === undefined || actual === null || String(actual).trim() === "";
    if (vacio && nuevos[campo]) out[campo] = nuevos[campo];
  }
  return out;
}

/** Lo mínimo del formulario (react-hook-form) que hace falta para rellenar. */
export interface FormularioVinoRellenable {
  getValues: () => Partial<Record<CampoTextoVino, unknown>>;
  setValue: (campo: CampoTextoVino, valor: string, opciones?: { shouldDirty?: boolean; shouldValidate?: boolean }) => void;
}

export interface LecturaHecha {
  datos: DatosVinoFoto;
  /** La foto que se leyó (para comprobar que sigue siendo la del formulario). */
  fuente: File | string;
}

async function archivoDeUrl(url: string): Promise<File> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("No se pudo descargar la foto guardada");
  const blob = await res.blob();
  return new File([blob], "botella", { type: blob.type || "image/jpeg" });
}

/**
 * `leer(foto)`: manda la foto (File o URL de la foto guardada) a la IA y rellena
 * los vacíos. `datos` queda para el precio sugerido y las tiendas. Errores:
 * aviso discreto con el motivo real; el formulario sigue usable.
 */
export function useLecturaEtiquetaVino(
  form: FormularioVinoRellenable,
  categorias: string[],
  alLeer?: (r: LecturaHecha) => void,
) {
  const [leyendo, setLeyendo] = useState(false);
  const [datos, setDatos] = useState<DatosVinoFoto | null>(null);
  const turno = useRef(0);
  const ultimo = useRef({ form, categorias, alLeer });
  useEffect(() => {
    ultimo.current = { form, categorias, alLeer };
  });

  /** Rellena los campos vacíos con lo leído; devuelve cuántos se rellenaron. */
  const rellenarCon = useCallback((d: DatosVinoFoto): number => {
    setDatos(d);
    // Se mira el formulario AHORA: lo escrito mientras leía no se toca.
    const rellenar = camposVaciosARellenar(ultimo.current.form.getValues(), d);
    const campos = Object.keys(rellenar) as CampoTextoVino[];
    for (const campo of campos) {
      ultimo.current.form.setValue(campo, rellenar[campo] as string, { shouldDirty: true, shouldValidate: true });
    }
    return campos.length;
  }, []);

  const leer = useCallback(async (fuente: File | string) => {
    const mio = ++turno.current;
    setLeyendo(true);
    try {
      const archivo = typeof fuente === "string" ? await archivoDeUrl(fuente) : fuente;
      const r = await leerDatosVinoDeFoto(archivo, ultimo.current.categorias.filter(Boolean));
      if (mio !== turno.current) return; // foto cambiada, quitada o formulario cerrado
      const rellenados = rellenarCon(r.datos);
      if (!r.datos.nombre) {
        toast.warning("No se ha podido leer el nombre en la etiqueta. Revisa los datos o prueba con una foto más cerca y con luz.");
      } else if (rellenados === 0) {
        toast.info("Etiqueta leída: la ficha ya estaba rellena, no se ha cambiado nada.");
      } else {
        toast.success(`Etiqueta leída: ${rellenados === 1 ? "1 campo rellenado" : `${rellenados} campos rellenados`}. Revísalos antes de guardar.`);
      }
      ultimo.current.alLeer?.({ datos: r.datos, fuente });
    } catch (e) {
      if (mio !== turno.current) return;
      console.error("[extraer-vino-foto] formulario", e);
      const motivo = e instanceof Error && e.message ? e.message : "Error desconocido";
      toast.warning("No se pudo leer la etiqueta", { description: `${motivo}. Puedes rellenar la ficha a mano.` });
    } finally {
      if (mio === turno.current) setLeyendo(false);
    }
  }, [rellenarCon]);

  /**
   * Lo leído en una lectura anterior (borrador recuperado tras recargar la
   * página): rellena como si se acabara de leer, SIN volver a llamar a la IA.
   */
  const restaurar = useCallback(
    (d: DatosVinoFoto) => {
      turno.current++;
      setLeyendo(false);
      rellenarCon(d);
    },
    [rellenarCon],
  );

  /** Descarta la lectura en curso (foto cambiada o formulario cerrado). */
  const cancelar = useCallback(() => {
    turno.current++;
    setLeyendo(false);
  }, []);

  /** Descarta la lectura en curso y el precio sugerido. */
  const limpiar = useCallback(() => {
    turno.current++;
    setLeyendo(false);
    setDatos(null);
  }, []);

  return { leyendo, datos, leer, restaurar, cancelar, limpiar };
}

export type LecturaEtiquetaVino = ReturnType<typeof useLecturaEtiquetaVino>;
