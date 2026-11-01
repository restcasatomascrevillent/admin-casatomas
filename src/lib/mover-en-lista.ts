/**
 * Mueve el elemento `desde` a la posición `hasta` de una lista. Pura: no toca
 * `lista` y devuelve la misma lista si no hay nada que mover (índices fuera de
 * rango, no enteros o iguales; listas de cero o un elemento).
 */
export function moverEnLista<T>(lista: readonly T[], desde: number, hasta: number): readonly T[] {
  const valido = (i: number) => Number.isInteger(i) && i >= 0 && i < lista.length;
  if (!valido(desde) || !valido(hasta) || desde === hasta) return lista;
  const copia = [...lista];
  const [elemento] = copia.splice(desde, 1);
  copia.splice(hasta, 0, elemento);
  return copia;
}
