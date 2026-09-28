// ============================================================================
// MOTOR DE RENDERIZADO DE LA VISTA PREVIA — ya NO es una copia
// ============================================================================
// Este fichero ERA un espejo a mano de `supabase/functions/emails-reserva/
// plantillas.ts`: 370 líneas duplicadas que había que acordarse de actualizar
// cada vez que cambiaba el correo real. En septiembre de 2026 pasó lo que
// tenía que pasar — la función dejó de enseñar la sala al cliente (punto 7 de
// su contrato) y esta copia siguió pintándola, así que durante un despliegue
// entero la vista previa del panel enseñó un correo que nadie iba a recibir.
// Una vista previa que miente es PEOR que no tener vista previa: da confianza
// falsa al dueño, que edita creyendo que ve lo que llega al cliente.
//
// Ahora no hay dos copias: hay UNA, la de la Edge Function, y este fichero
// solo la reexporta. La vista previa y el correo real no pueden volver a
// divergir porque son literalmente el mismo código.
//
// ¿POR QUÉ SE PUEDE IMPORTAR CÓDIGO DE UNA EDGE FUNCTION DE DENO DESDE EL
// NAVEGADOR? Porque estos dos ficheros son PUROS a propósito:
//   · `emails-reserva/plantillas.ts` — sin I/O (punto 6 de su contrato). Su
//     ÚNICO import es `../reservas-web/plantillas.ts`.
//   · `reservas-web/plantillas.ts` — CERO imports, y su cabecera dice que se
//     separó justamente "para poder testear con vitest sin arrastrar imports
//     https:// que Node no puede resolver". La portabilidad ya era un
//     objetivo de diseño, no un accidente.
// Ninguno toca `Deno.*`, `process.env`, red ni secretos. (El fichero impuro
// es `emails-reserva/index.ts`, que sí importa de `https://deno.land` y
// `https://esm.sh` — ese NO se toca desde aquí.) El import va SIN extensión,
// que es como lo escriben los otros 9 sitios del panel que ya importan de
// `supabase/functions/`; Deno exige el `.ts` en su lado y lo pone en sus
// propios imports, y las dos formas conviven sin problema.
//
// ESTO NO ES UN ACOPLAMIENTO NUEVO: el panel YA importaba de
// `supabase/functions/` en 9 sitios antes de esto — `_shared/disponibilidad`
// desde los hooks de disponibilidad y el kanban, y `reservas-web/plantillas`
// (el mismo fichero que arrastra esta reexportación) desde
// `src/lib/reservas/negocios.ts`. `_shared/disponibilidad` ya viaja en el
// bundle que se despliega. Lo que hacemos aquí es seguir la convención que ya
// existía, no inventar una.
//
// AUN ASÍ, dicho claro: si alguien mete un import de Deno en uno de esos dos
// ficheros puros, el build del panel se rompe. Es un fallo RUIDOSO y de
// arreglo inmediato (mover lo impuro a `index.ts`, que es donde vive el I/O
// por contrato), y es justo el intercambio que queremos: antes el fallo era
// silencioso y se lo comía el dueño.
//
// PARA REVERTIR: `git show <este commit>^:src/components/emails/
// motorPlantilla.ts` devuelve la copia a mano. Pero entonces vuelve el
// problema, así que antes lee `__tests__/motorPlantilla.espejo.test.ts`.
//
// NUNCA se usa esto para enviar nada — solo para pintar el <iframe> de vista
// previa mientras el usuario edita. El envío real siempre pasa por el
// backend, que usa este mismísimo `renderPlantilla`.
// ============================================================================

export {
  renderPlantilla,
  hayContraoferta,
  construirTokens,
  sustituirTexto,
  escapeHtml,
  formatearFecha,
  formatearHora,
  // Reglas de envío que el panel necesita para no describir mal un correo:
  // `solicitud_recibida` ya no sale en el canal web (punto 8 del contrato).
  debeEnviarSolicitudRecibida,
  CANALES_SIN_SOLICITUD_RECIBIDA,
} from "../../../supabase/functions/emails-reserva/plantillas";

export type {
  TipoPlantilla,
  FilaPlantilla,
  DatosReservaParaCorreo,
  ResultadoRenderizado,
  DatosNegocio,
} from "../../../supabase/functions/emails-reserva/plantillas";
