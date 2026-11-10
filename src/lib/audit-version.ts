import { supabase } from '@/integrations/supabase/client';

// main puede publicarse antes que Supabase. La versión se habilita con la
// última migración, después de desplegar panel-auth. Un error de red no se
// interpreta como servidor antiguo: en ese caso no se abre una sesión nueva.
//
// Caché (07/11/2026, login más rápido con cobertura de móvil): la respuesta
// tardaba ~0,44 s y se pedía EN SERIE antes de panel-auth al pulsar «Entrar».
// Ahora la pantalla de login la pide al montarse y aquí se guarda:
//  · Solo se recuerda «activa» (versión 2): la versión no vuelve atrás. «Antigua»
//    (PGRST202) se vuelve a preguntar cada vez, para no quedarse en el camino viejo
//    cuando se aplica la migración. Los errores tampoco se recuerdan.
//  · En memoria, en sessionStorage y en localStorage (desde el 09/11/2026: sobrevive a cerrar la app).
//  · Una sola petición en vuelo: quien llega mientras tanto espera a la misma.
const CLAVE_SESION = 'ct.auditoria-panel.v2';

let activaEnMemoria = false;
let enVuelo: Promise<boolean> | null = null;

// 09/11/2026 (abrir «Hoy» con mala cobertura): también en localStorage, para que volver a abrir la app
// (pestaña nueva, PWA) no repita la pregunta. Es seguro por lo mismo que arriba: la versión no vuelve atrás.
function leerSesion(): boolean {
  for (const almacen of [() => sessionStorage, () => localStorage]) {
    try {
      if (almacen().getItem(CLAVE_SESION) === '1') return true;
    } catch {
      /* sin almacén */
    }
  }
  return false;
}

function guardarSesion() {
  for (const almacen of [() => sessionStorage, () => localStorage]) {
    try {
      almacen().setItem(CLAVE_SESION, '1');
    } catch {
      /* modo privado o almacenamiento bloqueado: basta la memoria */
    }
  }
}

async function consultarVersion(): Promise<boolean> {
  const { data, error } = await supabase.rpc('version_auditoria_panel');
  if (error?.code === 'PGRST202') return false;
  if (error) throw new Error('No se pudo comprobar el registro de accesos. Inténtalo de nuevo.');
  return data === 2;
}

export function completeAuditEnabled(): Promise<boolean> {
  if (activaEnMemoria || leerSesion()) {
    activaEnMemoria = true;
    return Promise.resolve(true);
  }
  if (enVuelo) return enVuelo;
  const promesa = consultarVersion().then(
    (activa) => {
      if (activa) {
        activaEnMemoria = true;
        guardarSesion();
      }
      return activa;
    },
  );
  enVuelo = promesa;
  // Se suelta al terminar (bien o mal): un fallo se puede reintentar.
  const soltar = () => {
    if (enVuelo === promesa) enVuelo = null;
  };
  promesa.then(soltar, soltar);
  return promesa;
}

/** Lanza la comprobación sin esperarla (pantalla de login). Un fallo aquí no avisa: se repite al entrar. */
export function precargarVersionAuditoria(): void {
  completeAuditEnabled().catch(() => undefined);
}

/** Solo pruebas: olvida lo recordado. */
export function reiniciarCacheVersionAuditoria(): void {
  activaEnMemoria = false;
  enVuelo = null;
  for (const almacen of [() => sessionStorage, () => localStorage]) {
    try {
      almacen().removeItem(CLAVE_SESION);
    } catch {
      /* nada */
    }
  }
}
