import { useEffect, useState } from "react";
import { MS_SONDEO } from "./colaPendientes";
import { trabajosVivos } from "./trabajosVideo";

/**
 * Ids de los platos con un vídeo mandado a un dispositivo potente y aún sin
 * terminar (para la etiqueta «Vídeo pendiente» de la lista). Sondeo cada
 * 60 s con la pestaña visible; sin la migración devuelve un conjunto vacío y
 * deja de preguntar.
 */
export function useVideosPendientesCarta(): ReadonlySet<string> {
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    let vivo = true;
    let parar = false;
    const leer = async () => {
      if (parar || (typeof document !== "undefined" && document.visibilityState !== "visible")) return;
      try {
        const r = await trabajosVivos();
        if (!vivo) return;
        if (!r.disponible) {
          parar = true;
          return;
        }
        const nuevos = new Set(r.trabajos.map((t) => t.plato_id));
        setIds((prev) => (prev.size === nuevos.size && [...nuevos].every((x) => prev.has(x)) ? prev : nuevos));
      } catch {
        /* red: siguiente sondeo */
      }
    };
    void leer();
    const id = setInterval(() => void leer(), MS_SONDEO);
    return () => {
      vivo = false;
      clearInterval(id);
    };
  }, []);
  return ids;
}
