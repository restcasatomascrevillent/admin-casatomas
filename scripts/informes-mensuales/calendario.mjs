// ============================================================================
//  Informes mensuales · ¿toca hoy? (sin dependencias: corre antes de npm ci)
// ----------------------------------------------------------------------------
//  El dueño (25/11/2026) los quiere «cada mes el último jueves del mes». Cron no
//  sabe decir «último jueves» y GitHub programa en UTC, así que el workflow se
//  dispara todos los jueves a las 06:07 y a las 07:07 UTC y aquí se decide:
//    · el día (en Madrid) es jueves y el jueves siguiente ya es de otro mes;
//    · de los dos disparos, solo sigue el que cae a las 08:xx en Madrid: el de
//      las 06:07 UTC en verano (UTC+2) y el de las 07:07 UTC en invierno (UTC+1).
//      Se mira la hora del cron que ha saltado, no la del reloj: si GitHub lo
//      retrasa, sigue saliendo uno (y solo uno).
//  A mano (workflow_dispatch, sin cron) siempre toca, con el mes en curso o el
//  que se pida.
// ============================================================================

const ZONA = "Europe/Madrid";
/** Hora de Madrid a la que se quieren los informes. */
export const HORA_MADRID = 8;

/** Fecha y hora en Madrid de un instante. */
export function enMadrid(instante) {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: ZONA,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    })
      .formatToParts(instante)
      .map((p) => [p.type, p.value]),
  );
  const anio = Number(partes.year);
  const mes = Number(partes.month);
  const dia = Number(partes.day);
  const hora = Number(partes.hour);
  const diaSemana = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(partes.weekday);
  // Diferencia con UTC en horas (1 en invierno, 2 en verano).
  const local = Date.UTC(anio, mes - 1, dia, hora, Number(partes.minute));
  const utc = Date.UTC(instante.getUTCFullYear(), instante.getUTCMonth(), instante.getUTCDate(), instante.getUTCHours(), instante.getUTCMinutes());
  const desfase = Math.round((local - utc) / 3_600_000);
  return { anio, mes, dia, hora, diaSemana, desfase, clave: `${anio}-${String(mes).padStart(2, "0")}` };
}

const diasDelMes = (anio, mes) => new Date(Date.UTC(anio, mes, 0)).getUTCDate();

/** ¿Es el último jueves de su mes? (jueves y, a una semana vista, ya es otro mes). */
export const esUltimoJueves = ({ anio, mes, dia, diaSemana }) => diaSemana === 4 && dia + 7 > diasDelMes(anio, mes);

/** Hora UTC de un cron de GitHub («7 6 * * 4» → 6). null si no se entiende. */
export function horaDelCron(cron) {
  const campos = String(cron ?? "").trim().split(/\s+/);
  if (campos.length !== 5 || !/^\d{1,2}$/.test(campos[1])) return null;
  return Number(campos[1]);
}

/**
 * ¿Hay que sacar los informes ahora? `cron`: el que ha disparado el workflow
 * (github.event.schedule); vacío si se ha lanzado a mano.
 */
export function decidir({ ahora = new Date(), cron = "" } = {}) {
  const m = enMadrid(ahora);
  if (!String(cron).trim()) return { ejecutar: true, mes: m.clave, motivo: "lanzado a mano" };
  const horaUtc = horaDelCron(cron);
  if (horaUtc === null) return { ejecutar: false, mes: m.clave, motivo: `cron no reconocido: «${cron}»` };
  if (!esUltimoJueves(m)) return { ejecutar: false, mes: m.clave, motivo: `hoy (${m.dia}/${m.mes}) no es el último jueves del mes` };
  if (horaUtc + m.desfase !== HORA_MADRID) {
    return { ejecutar: false, mes: m.clave, motivo: `el disparo de las ${horaUtc}:xx UTC cae a las ${horaUtc + m.desfase}:xx en Madrid; lo hace el de las ${HORA_MADRID}:xx` };
  }
  return { ejecutar: true, mes: m.clave, motivo: `último jueves de ${m.clave}` };
}
