import { normalizarAlergeno, parseAlergenos } from "@/lib/alergenos";

/**
 * «Apto para» de un plato en el panel (04/11/2026, dueño: «que ponga si es apto para celíacos,
 * para vegetarianos o sin lactosa»). Son las MISMAS reglas que los filtros de la carta de la web
 * (web-casatomas: `cumpleFiltroDietetico` en src/lib/alergenos.ts y `cumpleDieta` en
 * src/lib/filtros-carta.ts), para que lo que dice el formulario sea lo que hará el filtro:
 *
 *  · Celíacos: «Se puede hacer sin gluten» marcado, o alérgenos rellenos sin gluten y sin una nota
 *    que hable de gluten o remita al personal.
 *  · Sin lactosa: alérgenos rellenos sin lácteos y sin nota de leche/lactosa ni «consultar».
 *  · Vegetariano: casilla marcada, sin carne, pescado ni marisco en los alérgenos y sin palabras
 *    de origen animal en el nombre, la descripción, los ingredientes o la nota.
 *
 * Desde el 10/11/2026 (dueño: «que sea modificable … apto para celíaco, … apto para sin lactosa»)
 * «Celíacos» y «Sin lactosa» se pueden decidir a mano (Platos.apto_celiacos / apto_sin_lactosa,
 * migración 20261122093000): true o false mandan sobre lo anterior; NULL = automático.
 */
export type DietaPlato = "celiaquia" | "vegetariano" | "lactosa";

export interface EstadoDieta {
  apto: boolean;
  motivo: string;
}

export interface DatosAptitud {
  /** Alérgenos del formulario (oficiales y personalizados) o «sin alérgenos declarados». */
  alergenos: unknown;
  /** Alérgenos inferidos guardados en BD (el formulario no los edita). */
  inferidos?: unknown;
  /** Nota de alérgenos guardada en BD. */
  notas?: string | null;
  nombre?: string | null;
  descripcion?: string | null;
  ingredientes?: string | null;
  sinGluten?: boolean;
  vegetariano?: boolean;
  /** Decidido a mano (true/false); null o ausente = automático, según alérgenos. */
  aptoCeliacos?: boolean | null;
  aptoSinLactosa?: boolean | null;
}

/** Motivo de una aptitud decidida a mano. */
const aMano = (apto: boolean): EstadoDieta => ({ apto, motivo: apto ? "Marcado a mano" : "Desmarcado a mano" });

const plegar = (texto: string) =>
  texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

const clave = (valor: string) => plegar(normalizarAlergeno(valor) ?? valor);

const REMITE_AL_PERSONAL = /\b(consultar|consulte|consulta|preguntar|pregunte|consult|ask|demander|demandez)\b/;
const NOTA_GLUTEN = /\b(gluten|trigo|wheat|cereales|ble)\b/;
const NOTA_LACTOSA = /\b(lactosa|lactose|lacteo|lacteos|leche|milk|dairy|lait)\b/;
const ANIMAL =
  /\b(carne|pollo|jamon|atun|pescado|marisco|pulpo|anchoa|anchoas|gelatina|caldo de carne|foie|bacon|ternera|cerdo|vaca|perdiz|consultar|consulte|preguntar|consult|ask|demander)\b/;
const NO_VEGETARIANO = ["carne", "pescado", "crustaceos", "moluscos", "marisco"];
const NOMBRE_ALERGENO: Record<string, string> = {
  carne: "carne",
  pescado: "pescado",
  crustaceos: "crustáceos",
  moluscos: "moluscos",
  marisco: "marisco",
};

export function aptitudesPlato(datos: DatosAptitud): Record<DietaPlato, EstadoDieta> {
  const lista = [...parseAlergenos(datos.alergenos), ...parseAlergenos(datos.inferidos)].filter(Boolean);
  const claves = new Set(lista.map(clave));
  const hayInfo = lista.length > 0;
  const nota = datos.notas ? plegar(datos.notas) : "";
  const remite = nota !== "" && REMITE_AL_PERSONAL.test(nota);

  const porAlergenos = (alergeno: string, notaHabla: RegExp, nombre: string, ok: string): EstadoDieta => {
    if (!hayInfo) return { apto: false, motivo: "Faltan los alérgenos" };
    if (claves.has(alergeno)) return { apto: false, motivo: `Lleva ${nombre}` };
    if (remite) return { apto: false, motivo: "La nota de alérgenos remite al personal" };
    if (nota && notaHabla.test(nota)) return { apto: false, motivo: `La nota de alérgenos habla de ${nombre}` };
    return { apto: true, motivo: ok };
  };

  const celiaquia = typeof datos.aptoCeliacos === "boolean"
    ? aMano(datos.aptoCeliacos)
    : datos.sinGluten && claves.has("gluten")
      ? { apto: true, motivo: "Se puede hacer sin gluten" }
      : porAlergenos("gluten", NOTA_GLUTEN, "gluten", "Sin gluten declarado");
  const lactosa = typeof datos.aptoSinLactosa === "boolean"
    ? aMano(datos.aptoSinLactosa)
    : porAlergenos("lacteos", NOTA_LACTOSA, "lácteos", "Sin lácteos declarados");

  let vegetariano: EstadoDieta;
  const animal = NO_VEGETARIANO.find((a) => claves.has(a));
  const texto = plegar([datos.nombre, datos.descripcion, datos.ingredientes, datos.notas].filter(Boolean).join(" "));
  const palabra = texto.match(ANIMAL)?.[1];
  if (!datos.vegetariano) vegetariano = { apto: false, motivo: "Sin marcar" };
  else if (animal) vegetariano = { apto: false, motivo: `Marcado, pero lleva ${NOMBRE_ALERGENO[animal]}` };
  else if (palabra) vegetariano = { apto: false, motivo: `Marcado, pero el texto dice «${palabra}»` };
  else vegetariano = { apto: true, motivo: "Marcado como vegetariano" };

  return { celiaquia, vegetariano, lactosa };
}
