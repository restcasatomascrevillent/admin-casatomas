import { useEffect, useState } from "react";
import { prepararFuenteInforme } from "@/components/trafico-web/informe/fuente";

/** Prepara la fuente de las diapositivas mientras el informe está a la vista (`true` cuando ya está). */
export function useFuenteInforme(activo: boolean): boolean {
  const [lista, setLista] = useState(false);
  useEffect(() => {
    if (!activo) return;
    let vivo = true;
    prepararFuenteInforme().finally(() => vivo && setLista(true));
    return () => {
      vivo = false;
    };
  }, [activo]);
  return lista;
}
