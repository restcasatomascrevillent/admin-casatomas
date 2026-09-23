# Datos de demostración — panel admin Casa Tomás / Touza

Esta carpeta contiene datos de **demostración** para que el panel admin deje de
verse vacío (reservas, gráficas) mientras no hay datos reales.

> **NUNCA ejecutes estos scripts contra una base con clientes reales.**
> `seed_demo_data.sql` inserta filas ficticias directamente por SQL. Si lo lanzas
> sobre una base en producción con reservas reales, se mezclarán datos falsos con
> datos reales de clientes. Antes de usarlo, confirma en qué proyecto de Supabase
> estás conectado.
>
> Desde septiembre de 2026 este seed **ya no crea personal ficticio** — solo
> reservas. Ver "Qué ya no crea, y por qué" más abajo.

## Archivos

| Archivo | Qué hace |
|---|---|
| `seed_demo_data.sql` | Inserta los datos de demostración (reservas). Generado con `gen_seed.js` (ver más abajo), con semilla fija — reproducible. |
| `cleanup_demo_data.sql` | Borra **exclusivamente** las filas creadas por `seed_demo_data.sql`, en cualquier base donde se ejecute. |
| `gen_seed.js` | Generador Node.js (sin dependencias) que produce `seed_demo_data.sql`. Solo hace falta para regenerar el seed con otros parámetros (otra fecha "hoy", otros volúmenes, etc.) — no hace falta para crear ni para borrar. |
| `package.json` | `{ "type": "commonjs" }` — ámbito local para que `node gen_seed.js` (escrito en CommonJS) funcione aunque el `package.json` raíz del proyecto sea `"type": "module"`. No afecta a ningún otro paquete del repo. |
| `README.md` | Este documento. |

### Regenerar el seed (opcional)

```bash
node adminpanelct/supabase/seeds/gen_seed.js adminpanelct/supabase/seeds/seed_demo_data.sql
```

Antes de regenerar, revisa las constantes al principio de `gen_seed.js`
(`TODAY`, `PAST_DAYS`, `FUTURE_DAYS`, `BLACKOUT_DATES`, los `id` de
`ESPACIOS`) — sobre todo `TODAY`, que hay que mantener al día si se ejecuta
mucho después de 2026-09-23, para que el rango de fechas siga siendo "el
último mes y las próximas dos semanas" de verdad y el día bloqueado por el
cron de recordatorios se recalcule como `TODAY + 2`.

## El marcador de demo

Todas las filas creadas llevan el prefijo literal **`[DEMO-SEED]`** al principio
del único campo de texto libre que usa este seed:

- `reservas.notas_cliente`

Es un marcador que no podría aparecer nunca en un dato real: ningún cliente
escribe `[DEMO-SEED]`, y la aplicación tampoco lo genera. El borrado se basa
siempre en `WHERE notas_cliente LIKE '[DEMO-SEED]%'` (en Postgres los
corchetes no son caracteres especiales de `LIKE`, así que no hace falta escapar
nada).

Hasta septiembre de 2026 también se usaba en `trabajadores.notas`,
`turnos.notas` y `registro_horas.notas` — ver "Qué ya no crea, y por qué".

Como señales adicionales (no son el marcador oficial, pero refuerzan que nada de
esto es real):
- Todos los emails son `@example.com` (dominio reservado para documentación/pruebas,
  nunca resuelve a una bandeja de entrada real).
- Todos los teléfonos están en el rango ficticio `600000000`–`600000999`.

## Qué crea

Rango de fechas: **2026-08-24 a 2026-10-07** (último mes + próximas dos semanas
desde "hoy" = 2026-09-23), **excluyendo el 2026-09-25** — ver aviso del cron más
abajo.

| Tabla | Filas | Detalle |
|---|---|---|
| `reservas` | 266 | 255 marca `casa_tomas`, 11 marca `touza`. Estados mezclados (confirmada, verificada, pendiente, cancelada, completada, no_show), canales mezclados (web/teléfono/manual), tamaños de grupo de 2 a 12, horas repartidas en comida y cena, más volumen viernes/sábado y comida de domingo. |

Los números exactos pueden variar ligeramente si se regenera `seed_demo_data.sql`
con `gen_seed.js` (usa aleatoriedad, aunque con semilla fija para que sea
reproducible tal cual está committeado).

### Por qué esta tabla y no otras

- El widget **Reservas por Día** (`GraficoReservasPorDia.tsx`) solo cuenta
  reservas con `estado = 'confirmada'` — por eso la mayoría de las reservas
  generadas (tanto pasadas como futuras) quedan en ese estado, no solo las
  futuras.
- El widget **Curva de Reservas por Hora** (`CurvaReservasPorHora.tsx`) solo usa
  las reservas **de hoy** con `estado = 'confirmada'` (`useTodayConfirmedReservations`).
  Por eso el seed refuerza especialmente el día de hoy (14 reservas, 12 de ellas
  confirmadas) con horas concentradas en el pico de comida (14:00–14:30) y de
  cena (21:00–21:30).

No se ha tocado `resenas`, `solicitudes_pendientes`, `notificaciones_dashboard`
ni `blacklist` — no forman parte de este encargo.

## Qué ya no crea, y por qué

Hasta septiembre de 2026 este seed también creaba **7 `trabajadores`, 136
`turnos`** (planificación de esos 7 trabajadores, de hoy−7 días a hoy+6 días)
**y 7 `registro_horas`** (un fichaje de hoy por trabajador, sin `hora_salida`).
Alimentaban el widget **Personal Activo** (Cocina / Sala / Otros) del
dashboard, que salía de `src/hooks/useDashboardStats.ts` → `useActiveStaff()`:
primero miraba `registro_horas` de hoy con `hora_salida IS NULL`; si no había
nada, caía a `turnos` de hoy cuya franja cubre la hora actual.

El dueño decidió **retirar la sección Personal** del panel. El commit
`a24b5b5` ("feat(panel): retirar la seccion Personal") quitó la página de
Trabajadores, sus componentes, el hook `useTrabajadores` y el widget
`PersonasActivas` del dashboard — con lo que ese seed de personal pasó a
alimentar un widget que ya no existe. Este cambio quita de `gen_seed.js`,
`seed_demo_data.sql` y `cleanup_demo_data.sql` todo lo que creaba o borraba
`trabajadores`, `turnos` (los de personal) y `registro_horas`. Las reservas,
que es lo único que el panel sigue mostrando, no se han tocado.

> **Aviso para quien lea esto después — no confundir los dos "turnos":** en
> este proyecto la palabra aparece con dos significados completamente
> distintos. Los `turnos` de esta sección eran el horario del personal (tabla
> `turnos`, junto a `trabajadores` y `registro_horas`) — eso es lo que se ha
> quitado de aquí. **`configuracion_turnos`** (comida/cena, la escalera de
> horarios de disponibilidad de las reservas — `ConfiguracionTurnos.tsx`,
> `useConfiguracionTurnos.ts`) es un sistema completamente distinto y es el
> corazón de la disponibilidad de reservas: este seed **nunca** lo ha creado,
> tocado ni referenciado, ni antes ni después de este cambio — se comprobó
> explícitamente que ninguno de los tres ficheros (`gen_seed.js`,
> `seed_demo_data.sql`, `cleanup_demo_data.sql`) menciona
> `configuracion_turnos`.
>
> Las tablas `trabajadores`, `turnos` (personal) y `registro_horas` en sí no
> se eliminan desde esta carpeta: este seed simplemente dejó de sembrarlas y
> de limpiarlas. Su eliminación de la base de datos, si procede, es una
> migración de esquema aparte (fuera del territorio de `supabase/seeds/`).

## Cómo se borra

```bash
# Desde la raíz del repo (codigo-restaurante), con el token de gestión de Supabase:
TK="$(tr -d '\r\n ' < .tokens-local/TOKEN-SUPABASE.txt)"
curl -s -X POST "https://api.supabase.com/v1/projects/jeamoczmbfsnwkfjxcyo/database/query" \
  -H "Authorization: Bearer $TK" -H "Content-Type: application/json" \
  --data-binary "$(node -e "const fs=require('fs');console.log(JSON.stringify({query:fs.readFileSync('adminpanelct/supabase/seeds/cleanup_demo_data.sql','utf8')}))")"
```

O pega el contenido de `cleanup_demo_data.sql` en el editor SQL del dashboard de
Supabase y ejecútalo.

Borra `reservas` filtradas por el marcador `[DEMO-SEED]`, más el parche de
`ocupacion_diaria` explicado abajo.

### Aviso sobre `ocupacion_diaria` (bug preexistente, no de este seed)

`ocupacion_diaria` no se llena insertando filas directamente: se recalcula sola
mediante el trigger `trigger_actualizar_ocupacion` (función
`actualizar_ocupacion_diaria_espacios()`) cada vez que `reservas` cambia. Al
probar el borrado nos encontramos con que, tal y como está escrita hoy esa
función, **nunca llega a borrar sus propias filas cuando se borran reservas**:
los triggers `AFTER ROW` de Postgres se disparan al final de la sentencia,
cuando todas las filas ya han desaparecido de `reservas`; en ese momento el
`SELECT ... GROUP BY` del trigger ya no encuentra ninguna fila para ese
`(fecha,hora)`, así que no inserta ni actualiza nada (un `GROUP BY` sobre cero
filas no produce una fila con `total_reservas = 0`, simplemente no produce
fila), y la fila vieja de `ocupacion_diaria` se queda con su `total_reservas`
anterior para siempre — la condición `WHERE total_reservas = 0` de la que
depende su propia limpieza nunca se cumple. Esto no es un problema introducido
por este seed: le pasaría igual a un borrado manual de cualquier reserva real.

`cleanup_demo_data.sql` **ya incluye el parche** para esto: al final borra de
`ocupacion_diaria` cualquier fila huérfana (sin ninguna reserva real detrás,
sea del origen que sea) dentro del rango de fechas que pudo tocar el seed
(2026-08-24 a 2026-10-07), y solo ese rango. Verificado con la prueba
crear → borrar → contar (ver abajo): tras el borrado, `ocupacion_diaria` queda
en 0 filas en ese rango.

Si algún día se corrige el trigger en el código de la app, este parche deja de
hacer nada (no encontrará huérfanos) y se puede quitar sin riesgo.

## Prueba real de que el borrado funciona

Re-ejecutado el 2026-09-23 contra el proyecto de Supabase de este repo
(`jeamoczmbfsnwkfjxcyo`), tras quitar trabajadores/turnos/registro_horas de
los tres ficheros (esta es la prueba de esa versión reducida; la prueba
anterior, con las 4 tablas, queda obsoleta y se sustituye por esta):

0. **Comprobación previa** (antes de tocar nada): `trabajadores`, `turnos` y
   `registro_horas` ya **no existían** (`to_regclass` devolvía `NULL` en las
   tres) — el dueño había aplicado por su cuenta la migración
   `20260923_retirar_personal.sql` que las elimina, con copia de seguridad
   propia de sus filas. No se intentó recrearlas: no forma parte de este
   encargo y las 5 tablas de la prueba anterior ya no aplican. `reservas`
   marcaba 266 filas `[DEMO-SEED]` (las que el panel estaba usando en ese
   momento) y `configuracion_turnos` tenía sus 2 filas de siempre, sin tocar.
1. **Borrar**: `cleanup_demo_data.sql` (versión nueva, solo `reservas`) →
   `reservas` marcadas a 0, `ocupacion_diaria` a 0 filas huérfanas en el
   rango. El total absoluto de `reservas` volvió a 110 — exactamente el valor
   que había antes de crear nada — ninguna fila ajena se tocó.
2. **Cero confirmado** con `count(*)`: `reservas` marcadas = 0, huérfanas de
   `ocupacion_diaria` en rango = 0.
3. **Crear**: `seed_demo_data.sql` (regenerado con `gen_seed.js`, sin tocarlo
   a mano) → 266 reservas marcadas `[DEMO-SEED]` (255 `casa_tomas` / 11
   `touza`), total `reservas` = 376 — mismos números exactos que antes de
   quitar el personal, porque la generación de reservas no se tocó (semilla
   fija).
4. **Borrar de nuevo** → 0 marcadas, 110 total, 0 huérfanas otra vez.
5. **Crear de nuevo** (estado final, para dejar el panel funcionando con las
   mismas 266 reservas demo que tenía el dueño antes de la prueba): 266
   marcadas, 376 total.
6. **`configuracion_turnos` no se tocó en ningún momento** de la prueba: ni
   `gen_seed.js`, ni `seed_demo_data.sql`, ni `cleanup_demo_data.sql`
   contienen la cadena `configuracion_turnos` (comprobado con grep antes y
   después de editar), y sus 2 filas siguen iguales al final.

El estado final dejado en la base es el del paso 5: 266 reservas de demo
presentes (igual que al empezar la prueba), sin trabajadores/turnos/
registro_horas (ya no los crea nadie), para que el panel se siga viendo
funcionando tal y como lo estaba usando el dueño.

## Reglas del sistema respetadas

- **`trg_validar_capacidad`** (aforo): no se desactivó. El generador contabiliza
  por `(fecha, turno, marca)` — turno = comida si `hora < 17:00`, cena en caso
  contrario, igual que hace el propio trigger — y solo suma las reservas en
  estado `pendiente`/`verificada`/`confirmada` (las mismas que valida el
  trigger; `cancelada`/`completada`/`no_show` quedan fuera del cómputo, igual
  que en el trigger). El máximo usado nunca supera 150 (Casa Tomás: Comedor +
  Salón + Terraza, 50 cada uno) ni 20 (Touza: El Reservado) por turno y día.
- **`marca`**: reservas de ambas marcas (`casa_tomas` mayoritaria, `touza` en
  El Reservado).
- **Cron de recordatorios** (`emails-reserva/recordatorios`, diario a las 08:00):
  busca reservas **confirmadas** para dentro de 2 días. Con "hoy" = 2026-09-23,
  esa fecha es **2026-09-25**, y el seed **no crea ninguna reserva** ese día
  (ni confirmada ni de ningún otro estado) para no generar intentos de envío a
  direcciones `@example.com` ni avisos en la campana de notificaciones. Si se
  regenera el seed en otra fecha, hay que actualizar `TODAY` en `gen_seed.js` y
  la fecha bloqueada seguirá siendo `TODAY + 2` automáticamente.
- Los otros dos crons (`detectar-ausencias` a las 04:00, `reintentar-fallidos`
  cada 15 min) sí pueden llegar a procesar reservas de demo, pero como todos los
  emails son `@example.com` y los teléfonos son ficticios, no hay forma de que
  eso llegue a una persona real.
- No se tocó ninguna fila que no se hubiera creado en este mismo seed.
- No se desplegaron funciones, no se aplicaron migraciones, no se hizo commit.

## Dato importante para quien lea esto después

El panel **no partía de una base de datos completamente vacía**. Al inspeccionar
el esquema encontramos:

- 110 filas ya existentes en `reservas`, todas con fechas de **febrero–marzo de
  2026** (de una tanda de pruebas anterior, ver `PLAN-TESTEO-MASIVO.md` en la
  raíz del repo), con emails `@test.com` y teléfonos `612345XXX`. Ninguna cae en
  el rango de fechas de este seed (último mes / próximas dos semanas desde
  2026-09-23), así que el panel las sigue mostrando vacías para "hoy" aunque la
  tabla no esté a 0 filas. No se han tocado ni borrado — no las creamos
  nosotros y no estaba en el encargo limpiarlas.
- (Histórico, ya no aplica desde que se retiró la sección Personal) Hasta
  septiembre de 2026 había además 10 `trabajadores` **reales** ya dados de
  alta, y el seed creaba 7 trabajadores ficticios nuevos en vez de reutilizarlos
  o asignarles turnos falsos (habría sido fabricar un historial de asistencia
  falso a nombre de alguien real). Ver "Qué ya no crea, y por qué".
- `resenas` ya tenía 11 filas (las mismas 11 reseñas falsas que, según el
  encargo, se ocultaron hoy) — no se ha añadido ni tocado ninguna.

## Qué widgets del panel deberían dejar de estar vacíos

- **Reservas por Día**: barras en prácticamente todos los días del rango
  (más altas viernes/sábado/domingo-comida), contando solo las `confirmada`.
- **Curva de Reservas por Hora** (solo hoy): dos picos, uno de comida
  (13:00–15:30) y otro de cena (20:30–22:30).
- Cualquier listado/calendario de reservas (pestañas Hoy, Lista, Calendario)
  debería mostrar actividad variada en canal, estado y tamaño de grupo.
- `ocupacion_diaria` / `vista_ocupacion` quedan con datos coherentes para el
  mismo rango de fechas (se generan solos a partir de `reservas`).
- ~~**Personal Activo** (Cocina / Sala / Otros)~~ — el widget se retiró del
  panel junto con toda la sección Personal (commit `a24b5b5`); este seed ya
  no lo alimenta ni falta que lo haga.
