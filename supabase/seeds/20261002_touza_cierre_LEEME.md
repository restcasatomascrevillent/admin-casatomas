# Cierre de reservas de Touza: fase de datos

**Estado a 2026-10-03: APLICADO.** 01 (02/10), 02, 03 y 04 (03/10) aplicados por el dueño; `touza_cierre_comprobaciones.sql` dio RESUMEN = 0 con «01 aplicado / 02 aplicado / 04 aplicado (salas borradas)». Touza ya no tiene salas, reservas ni sugerencias en el sistema de reservas.

Decisión del dueño (01/10/2026): Touza no admite reservas. Estos scripts cierran la parte de base de datos. Los aplica **el dueño a mano**, desde `adminpanelct/`, **una orden por línea** (PowerShell no admite `&&`). Nunca `supabase db push` ni `migration repair`. Ninguno cambia funciones, triggers ni crons.

## Orden

0. Foto de antes (solo lectura). La fila 99 (`RESUMEN`) tiene que dar 0. La fila 18 (avisos de Touza sin leer) es informativa: antes del 03 puede no ser 0 sin que nada vaya mal; después del 03 tiene que dar 0:
   `npx supabase db query --linked -f supabase/tests/touza_cierre_comprobaciones.sql`
1. Desplegar `reservas-web` con el 409 de Touza (commit «feat(reservas-web): Touza no admite reservas, el servidor las rechaza con 409»). **Antes que el 01.**
   `npx supabase functions deploy reservas-web`
2. Desactivar las 3 salas de Touza. El aforo de Touza baja de 80 a 0, y los DOS bots telefónicos de `restaurante-phone` en origin/main (`api/vapi-webhook.js` y `api/el-webhook.js`) pasan a ver 170 plazas en vez de 250, lo mismo que ya valida el trigger de aforo:
   `npx supabase db query --linked -f supabase/seeds/20261002_touza_cierre_01_desactivar_salas.sql`
3. **Opcional, decide el dueño:** borrar las 5 reservas demo de Touza y sus 2 sugerencias de lista negra:
   `npx supabase db query --linked -f supabase/seeds/20261002_touza_cierre_02_borrar_reservas_demo.sql`
4. Marcar como leídos los avisos de Touza de la campana. El 02/10 no había ninguno. **Guardar la columna `deshacer` de la salida.**
   `npx supabase db query --linked -f supabase/seeds/20261002_touza_cierre_03_avisos_campana.sql`
5. **Fase 04, decisión del dueño del 03/10/2026 («Touza nunca gestiona reservas»): borrar las 3 salas de Touza** (hasta entonces solo desactivadas). Es la migración `supabase/migrations/20261003120000_touza_retirar_espacios_reserva.sql`. **Exige el 01 y el 02 aplicados**: aborta sin escribir si queda alguna sala activa o alguna reserva que apunte a ellas (el SET NULL las dejaría sin sala). Si el dueño prefiere conservar las 5 reservas demo, no se aplica y las salas se quedan desactivadas (seguro):
   `npx supabase db query --linked -f supabase/migrations/20261003120000_touza_retirar_espacios_reserva.sql`
   `npx supabase db query --linked -f supabase/tests/touza_retirar_espacios_reserva_test.sql`
6. Comprobar. `RESUMEN` tiene que dar 0 y `Fase detectada` tiene que mostrar lo aplicado:
   `npx supabase db query --linked -f supabase/tests/touza_cierre_comprobaciones.sql`

## Si algo falla

- **Error con un mensaje en español antes de escribir** (pre-comprobación): no se ha cambiado nada. Leer el mensaje: dice qué no cuadra.
- **`55P03` (lock_timeout)**: no se ha cambiado nada. Reintentar al rato.
- **Error que empieza por `VERIFICACIÓN:`**: la transacción se ha deshecho entera. Puede ser concurrencia (el cron de la campana corre cada 15 min, o alguien en el panel marca un aviso o edita una sala a la vez): reintentar una vez. Si se repite, avisar antes de seguir.
- **El 02 dice que la huella ha cambiado**: alguien ha tocado esas reservas y el ROLLBACK ya no las devolvería tal cual. No borrar, o regenerar el ROLLBACK siguiendo su cabecera.
- **El test da `FALLO: …` en vez de la tabla**: hay algo a medias, por ejemplo 1 o 2 salas activas, o entre 1 y 4 de las 5 reservas. Parar y revisar.
- Todos los scripts son idempotentes: volver a lanzar uno ya aplicado no cambia nada.

## Deshacer (en este orden)

0. 04 (si se aplicó): `npx supabase db query --linked -f supabase/rollbacks/20261003120000_touza_retirar_espacios_reserva_ROLLBACK.sql` (vuelven las 3 salas, desactivadas, mismos ids). Va **antes** que los ROLLBACK del 01 y del 02.
1. 03: ejecutar la sentencia de la columna `deshacer` que imprimió (si dijo «Nada que deshacer», no hay nada que hacer).
2. 01: `npx supabase db query --linked -f supabase/seeds/20261002_touza_cierre_01_desactivar_salas_ROLLBACK.sql`
3. 02: `npx supabase db query --linked -f supabase/seeds/20261002_touza_cierre_02_borrar_reservas_demo_ROLLBACK.sql`. Va **después** del ROLLBACK del 01: sin aforo en Touza, la BD rechaza las 2 reservas vivas.
4. Test (paso 6 de arriba).
