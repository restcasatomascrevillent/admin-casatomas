/**
 * RRSS · validadores de los textos que propone la IA (rótulos, títulos del
 * vídeo, texto de la publicación e ideas). Pasan DESPUÉS del modelo y ANTES
 * de devolver nada. Reutilizan las reglas de la IA de Instagram
 * (_shared/instagram/validar-ia.ts) y añaden las de esta sección:
 *
 *  · precios y promociones (descuentos, 2x1, «gratis», «oferta») solo si el
 *    usuario los escribió en sus instrucciones: si no, se quita la frase;
 *  · nada de datos personales (correos, teléfonos, DNI, IBAN, cuentas ajenas);
 *  · nada de alérgenos, «sin gluten», «vegano»… (no hay dato oficial aquí);
 *  · TOUZA no admite reservas: se quita la frase que las pide;
 *  · sin emoji.
 *
 * Trabaja por frases: quita la frase problemática y avisa, sin descartar el
 * resto de la propuesta.
 */
import {
  erroresAlergenos,
  erroresDatosPersonales,
  mencionaReservar,
  preciosDelTexto,
  quitarEmoji,
  touzaEnMayusculas,
  type MarcaIA,
} from "../instagram/validar-ia.ts";

export interface ContextoTexto {
  marca: MarcaIA;
  /** Lo que escribió el usuario (instrucciones, detalle de la idea…): lo que ahí aparece está permitido. */
  permitido: string;
}

export interface TextoRevisado {
  texto: string;
  avisos: string[];
}

const RE_PROMO = /\b(\d{1,3}\s?%|2\s?x\s?1|3\s?x\s?2|gratis|gratuit[oa]s?|descuentos?|ofertas?|promoci[oó]n(?:es)?|rebajas?|regalo)\b/gi;

const normal = (s: string) => s.toLocaleLowerCase("es").normalize("NFD").replace(/[̀-ͯ]/g, "");

function frases(texto: string): string[] {
  // Conserva los saltos de línea como separadores propios.
  return texto.split(/(?<=[.!?…])\s+|(?=\n)/u);
}

/** Precios del texto que no salen en lo que escribió el usuario. */
export function preciosNoPermitidos(texto: string, permitido: string): number[] {
  const deUsuario = new Set(preciosDelTexto(permitido).map((n) => n.toFixed(2)));
  return preciosDelTexto(texto).filter((n) => !deUsuario.has(n.toFixed(2)));
}

/** Promociones del texto que el usuario no ha pedido. */
export function promocionesNoPermitidas(texto: string, permitido: string): string[] {
  const p = normal(permitido);
  const halladas = texto.match(RE_PROMO) ?? [];
  return halladas.filter((h) => !p.includes(normal(h).replace(/\s/g, "")) && !p.includes(normal(h)));
}

export function revisarTexto(entrada: string, ctx: ContextoTexto): TextoRevisado {
  const avisos = new Set<string>();
  let texto = quitarEmoji(entrada ?? "");
  if (texto !== (entrada ?? "")) avisos.add("Se han quitado los emoji");
  const salida: string[] = [];
  for (const f of frases(texto)) {
    if (!f.trim()) {
      salida.push(f);
      continue;
    }
    if (preciosNoPermitidos(f, ctx.permitido).length) {
      avisos.add("Se ha quitado un precio que no viene de tus instrucciones (la IA no inventa precios)");
      continue;
    }
    if (promocionesNoPermitidas(f, ctx.permitido).length) {
      avisos.add("Se ha quitado una promoción que no habías pedido (la IA no inventa ofertas)");
      continue;
    }
    if (erroresDatosPersonales(f).length) {
      avisos.add("Se han quitado datos de contacto o de otra cuenta");
      continue;
    }
    if (erroresAlergenos(f, null).length) {
      avisos.add("Se ha quitado una afirmación sobre alérgenos o dietas sin dato oficial");
      continue;
    }
    if (ctx.marca === "touza" && mencionaReservar(f)) {
      avisos.add("TOUZA no admite reservas: se ha quitado la frase que las pedía");
      continue;
    }
    salida.push(f);
  }
  texto = salida.join(" ").replace(/ *\n */g, "\n").replace(/[ \t]{2,}/g, " ").trim();
  if (ctx.marca === "touza") texto = touzaEnMayusculas(texto);
  return { texto, avisos: [...avisos] };
}

/** Revisa varios campos a la vez y junta los avisos. */
export function revisarCampos<T extends Record<string, unknown>>(obj: T, campos: (keyof T)[], ctx: ContextoTexto, avisos: string[]): T {
  const out = { ...obj };
  for (const c of campos) {
    const v = out[c];
    if (typeof v !== "string" || !v) continue;
    const r = revisarTexto(v, ctx);
    (out as Record<string, unknown>)[c as string] = r.texto;
    avisos.push(...r.avisos);
  }
  return out;
}
