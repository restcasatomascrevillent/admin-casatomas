// Informes mensuales · piezas puras del script (con pruebas en scripts/__tests__/informes-mensuales.test.mjs).

/**
 * Nombre de fichero aceptable para Drive (el que admite la Edge Function informes-mensuales: letras,
 * números, espacios, «. _ ( ) -» y «.pdf»), sin repetir ninguno de `usados` (que se actualiza).
 */
export function nombrePdfSeguro(nombre, usados = new Set()) {
  const base =
    String(nombre ?? "")
      .replace(/\.pdf$/i, "")
      .normalize("NFC")
      .replace(/[^\p{L}\p{N} ._()-]+/gu, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^[.\s-]+|[\s-]+$/g, "")
      .slice(0, 120) || "informe";
  let candidato = `${base}.pdf`;
  for (let i = 2; usados.has(candidato.toLowerCase()); i++) candidato = `${base} (${i}).pdf`;
  usados.add(candidato.toLowerCase());
  return candidato;
}

/** De la sesión de supabase-js guardada en localStorage (`sb-<ref>-auth-token`): token y URL del proyecto. */
export function leerSesion(entradas) {
  for (const [clave, valor] of entradas) {
    const m = /^sb-([a-z0-9]+)-auth-token$/.exec(clave);
    if (!m) continue;
    try {
      const s = JSON.parse(valor);
      const token = s?.access_token ?? s?.currentSession?.access_token;
      if (token) return { token, supabaseUrl: `https://${m[1]}.supabase.co` };
    } catch {
      /* otra cosa */
    }
  }
  return null;
}

/** Texto del resumen (para el log y el resumen del job de GitHub): sin enlaces ni datos de nadie. */
export function textoResumen({ mes, subidos, sinDatos, fallidos, generados }) {
  const l = [`Informes de ${mes}: ${generados} PDF generados, ${subidos} subidos a Drive.`];
  const unir = (lista) => lista.map((t) => String(t).replace(/\.+$/, "")).join(", ");
  if (sinDatos.length) l.push(`Sin datos: ${unir(sinDatos)}.`);
  if (fallidos.length) l.push(`Fallidos: ${unir(fallidos)}.`);
  return l.join("\n");
}
