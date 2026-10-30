/**
 * Aviso de «revalida lo que dependa de la identidad» (CT-REM-FE-02).
 *
 * AuthProvider ya comprueba el acceso cada 15 s, al volver el foco y en
 * TOKEN_REFRESHED. En vez de añadir otro temporizador, esas mismas
 * comprobaciones emiten aquí y los proveedores de rol/permisos/super admin
 * releen sus tablas en silencio (sin `loading`, para no desmontar la página).
 */
type Oyente = () => void;
const oyentes = new Set<Oyente>();

export function alRevalidarSesion(oyente: Oyente): () => void {
  oyentes.add(oyente);
  return () => {
    oyentes.delete(oyente);
  };
}

export function emitirRevalidacionSesion(): void {
  for (const o of [...oyentes]) {
    try {
      o();
    } catch (e) {
      console.error("[panel] revalidación de sesión:", e);
    }
  }
}
