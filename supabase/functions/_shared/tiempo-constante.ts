// Comparación de cadenas en tiempo constante (secretos compartidos, firmas).
// Recorre siempre la longitud máxima y acumula la diferencia, para no revelar
// por tiempo ni el prefijo común ni la longitud del secreto real.
export function compararTiempoConstante(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  const n = Math.max(ea.length, eb.length);
  for (let i = 0; i < n; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}
