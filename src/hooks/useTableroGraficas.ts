// Estado del tablero de gráficas del copiloto de Facturas: qué tarjetas ha
// quitado el usuario y cuál está seleccionada.
//
// Las gráficas de la IA salen de los mensajes guardados de la conversación
// (columna `adjuntos`), así que al volver a una conversación del historial
// reaparecen solas. «Quitar» no borra nada de la BD: se apunta el id en
// localStorage por conversación para que tampoco vuelva al recargar.
import { useCallback, useEffect, useState } from "react";

const PREFIJO = "facturas-tablero-ocultas:";
/** Tope de ids por conversación (no crece sin límite en el navegador). */
const MAX_OCULTAS = 200;

const clave = (conversacionId: string | null) => `${PREFIJO}${conversacionId ?? "nueva"}`;

function leer(conversacionId: string | null): Set<string> {
  try {
    const crudo = window.localStorage.getItem(clave(conversacionId));
    const lista: unknown = crudo ? JSON.parse(crudo) : [];
    return new Set(Array.isArray(lista) ? lista.filter((v): v is string => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

function guardar(conversacionId: string | null, ids: Set<string>) {
  try {
    window.localStorage.setItem(clave(conversacionId), JSON.stringify([...ids].slice(-MAX_OCULTAS)));
  } catch {
    // Modo privado o cuota llena: se quita igual, solo que no sobrevive a recargar.
  }
}

export function useTableroGraficas(conversacionId: string | null) {
  const [ocultas, setOcultas] = useState<ReadonlySet<string>>(() => leer(conversacionId));
  const [seleccionadaId, setSeleccionadaId] = useState<string | null>(null);

  // Otra conversación: sus propias tarjetas quitadas. La selección NO se toca
  // aquí: la primera pregunta crea la conversación (null → id) y no debe
  // perder la gráfica sobre la que se pregunta; al cambiar de conversación a
  // mano la limpia quien cambia (`seleccionar(null)`).
  useEffect(() => {
    setOcultas(leer(conversacionId));
  }, [conversacionId]);

  const ocultar = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      setOcultas((prev) => {
        const sig = new Set(prev);
        ids.forEach((id) => sig.add(id));
        guardar(conversacionId, sig);
        return sig;
      });
      setSeleccionadaId((sel) => (sel && ids.includes(sel) ? null : sel));
    },
    [conversacionId],
  );

  const alternarSeleccion = useCallback((id: string) => setSeleccionadaId((sel) => (sel === id ? null : id)), []);
  const seleccionar = useCallback((id: string | null) => setSeleccionadaId(id), []);

  return { ocultas, ocultar, seleccionadaId, alternarSeleccion, seleccionar };
}
