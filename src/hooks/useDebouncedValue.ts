import { useEffect, useState } from "react";

/** El valor, pero solo cuando lleva `ms` sin cambiar (buscadores: una consulta por pausa, no por tecla). */
export function useDebouncedValue<T>(valor: T, ms = 300): T {
  const [retrasado, setRetrasado] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setRetrasado(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return retrasado;
}
