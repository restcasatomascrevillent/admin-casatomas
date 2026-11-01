import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * `?plato=<id>` en la URL (notificación «Vídeo listo», indicador de la cola)
 * → abre la ficha de ese plato y quita el parámetro. Solo se monta dentro de
 * un router (ListaPlatos se usa también suelta en tests).
 */
export function AbrirPlatoDesdeUrl<T extends { id: string }>({ platos, onAbrir }: { platos: readonly T[]; onAbrir: (p: T) => void }) {
  const [params, setParams] = useSearchParams();
  const id = params.get("plato");
  useEffect(() => {
    if (!id) return;
    const p = platos.find((x) => x.id === id);
    if (!p) return;
    onAbrir(p);
    const sin = new URLSearchParams(params);
    sin.delete("plato");
    setParams(sin, { replace: true });
  }, [id, platos, onAbrir, params, setParams]);
  return null;
}
