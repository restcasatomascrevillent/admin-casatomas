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

## ⚠️ El seed caduca — hay que re-sembrarlo periódicamente

`seed_demo_data.sql`, tal y como esté committeado en cada momento, tiene "hoy"
congelado en la fecha en la que se generó (`TODAY`, dentro de `gen_seed.js`,
calculada en el instante de ejecutar el generador — ver "Regenerar el seed"
más abajo). Eso significa que las reservas pensadas para "hoy" — las que
alimentan la pestaña **Reservas de Hoy** y el widget **Curva de Reservas por
Hora** — quedan ancladas a esa fecha concreta, no a la fecha real del día en
que alguien abra el panel.

En la práctica: en cuanto pasa un día desde que se generó el fichero
committeado, la pestaña "Reservas de Hoy" vuelve a salir vacía, aunque todas
las filas `[DEMO-SEED]` sigan perfectamente sanas en la base — simplemente
ninguna cae ya en la fecha de hoy. Esto es justo lo que le pasó al dueño el
2026-09-25, con un seed que se había generado el 2026-09-23 (dos días antes) —
ver el registro fechado al final de este documento.

**Para que el panel vuelva a tener reservas de "hoy", hay que re-sembrar:**

1. Regenerar `seed_demo_data.sql`: `node gen_seed.js seed_demo_data.sql`
   (`TODAY` se recalcula solo en cada ejecución — no hay que editar nada a
   mano).
2. Ejecutar `cleanup_demo_data.sql` contra la base (borra únicamente las filas
   `[DEMO-SEED]` viejas; nunca toca reservas reales).
3. Ejecutar el `seed_demo_data.sql` recién regenerado en el paso 1.

No existe (todavía) ningún cron ni Edge Function que haga esto solo: es un
paso manual. Si el panel vuelve a mostrar "Reservas de Hoy" a cero y las filas
`[DEMO-SEED]` de siempre siguen ahí en la base, este es el motivo — repite los
tres pasos de arriba.

## Archivos

| Archivo | Qué hace |
|---|---|
| `seed_demo_data.sql` | Inserta los datos de demostración (reservas). Generado con `gen_seed.js` (ver más abajo), con semilla fija — reproducible. |
| `cleanup_demo_data.sql` | Borra **exclusivamente** las filas creadas por `seed_demo_data.sql`, en cualquier base donde se ejecute. |
| `gen_seed.js` | Generador Node.js (sin dependencias) que produce `seed_demo_data.sql`. Solo hace falta para regenerar el seed con otros parámetros (otra fecha "hoy", otros volúmenes, etc.) — no hace falta para crear ni para borrar. |
| `package.json` | `{ "type": "commonjs" }` — ámbito local para que `node gen_seed.js` (escrito en CommonJS) funcione aunque el `package.json` raíz del proyecto sea `"type": "module"`. No afecta a ningún otro paquete del repo. |
| `README.md` | Este documento. |

### Regenerar el seed

```bash
node gen_seed.js seed_demo_data.sql
```

(Ejecutar desde esta carpeta, `supabase/seeds/`. Desde la raíz del repo
sería: `node adminpanelct/supabase/seeds/gen_seed.js adminpanelct/supabase/seeds/seed_demo_data.sql`.)

`TODAY` y `BLACKOUT_DATES` ya **no** son constantes que haya que mantener a
mano — antes lo eran, y ese era justo el bug que dejaba "Reservas de Hoy"
vacío (ver aviso más arriba). Ahora: `TODAY` se calcula solo en cada
ejecución (el día natural en Madrid, zona horaria del restaurante — el
porqué, con el detalle del caso límite de ejecutar cerca de medianoche, está
explicado en el comentario junto a `TODAY` en `gen_seed.js`), y
`BLACKOUT_DATES` se deriva de `TODAY + 2` (el día que bloquea el cron de
recordatorios de las 08:00). No hace falta tocar ninguna de las dos al
regenerar.

Lo que sí sigue siendo configuración manual, por si algún día cambia:
`PAST_DAYS` / `FUTURE_DAYS` (cuánto rango de fechas generar) y los `id` de
`ESPACIOS` (deben coincidir con las filas reales de `espacios_reserva` del
proyecto).

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

Rango de fechas: **el último mes + las próximas dos semanas desde "hoy"**, en
el momento de generar (`TODAY − 30` días a `TODAY + 14` días — ver
`PAST_DAYS` / `FUTURE_DAYS` en `gen_seed.js`), **excluyendo siempre
`TODAY + 2`** — ver aviso del cron más abajo. Como `TODAY` se recalcula en
cada ejecución (ver "Regenerar el seed" más arriba), este rango se desplaza
solo cada vez que se regenera el seed; los valores concretos de abajo
corresponden a la última regeneración (2026-09-25: **2026-08-26 a
2026-10-09**, excluyendo **2026-09-27**).

| Tabla | Filas | Detalle |
|---|---|---|
| `reservas` | 265 | 260 marca `casa_tomas`, 5 marca `touza`. Estados mezclados (confirmada, verificada, pendiente, cancelada, completada, no_show), canales mezclados (web/teléfono/manual), tamaños de grupo de 2 a 12, horas repartidas en comida y cena, más volumen viernes/sábado y comida de domingo. |

Los números exactos (total de filas, reparto por marca/estado/canal, y el
propio rango de fechas de arriba) cambian cada vez que se regenera
`seed_demo_data.sql` con `gen_seed.js`: usa aleatoriedad con semilla fija, así
que para un `TODAY` concreto el resultado es reproducible, pero `TODAY`
cambia en cada regeneración y con él el resultado completo. La tabla de
arriba describe el fichero tal y como está committeado ahora mismo, no una
cifra fija para siempre.

### Por qué esta tabla y no otras

- El widget **Reservas por Día** (`GraficoReservasPorDia.tsx`) solo cuenta
  reservas con `estado = 'confirmada'` — por eso la mayoría de las reservas
  generadas (tanto pasadas como futuras) quedan en ese estado, no solo las
  futuras.
- El widget **Curva de Reservas por Hora** (`CurvaReservasPorHora.tsx`) solo usa
  las reservas **de hoy** con `estado = 'confirmada'` (`useTodayConfirmedReservations`).
  Por eso el seed refuerza especialmente el día de hoy (entre 12 y 16
  reservas — comidaN y cenaN se sortean entre 6 y 8 cada uno —, la mayoría
  confirmadas; en la última regeneración, 12 reservas y 8 confirmadas) con
  horas concentradas en el pico de comida (14:00–14:30) y de cena
  (21:00–21:30).

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
(rango escrito a mano en el propio script — 2026-08-26 a 2026-10-09 mientras
`seed_demo_data.sql` no se regenere de nuevo; hay que mantenerlo al día en
cada regeneración, ver el aviso junto a esas fechas en `cleanup_demo_data.sql`
y el registro fechado al final de este documento), y solo ese rango.
Verificado con la prueba
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
  busca reservas **confirmadas** para dentro de 2 días (`TODAY + 2`), y el
  seed **no crea ninguna reserva** ese día (ni confirmada ni de ningún otro
  estado) para no generar intentos de envío a direcciones `@example.com` ni
  avisos en la campana de notificaciones. `TODAY` y esa fecha bloqueada
  (`BLACKOUT_DATES`) se recalculan solos en cada regeneración — no hace falta
  tocar nada a mano (ver "Regenerar el seed" más arriba).
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

## Registro — 2026-09-25: TODAY hardcodeado, panel en cero, corregido

**El problema.** El dueño abrió el panel y "Reservas de Hoy" salía a cero. Las
266 filas `[DEMO-SEED]` seguían todas en la base, pero ninguna caía en
2026-09-25: `gen_seed.js` tenía `TODAY` fijado a fuego en `'2026-09-23'` (el
día en que se generó el seed por primera vez) y `BLACKOUT_DATES` fijado a
`['2026-09-25']` (calculado a mano como `TODAY + 2` en aquel momento). Iba a
volver a pasar cada día que pasara desde entonces.

**La corrección (en `gen_seed.js`).** `TODAY` ahora se calcula solo en cada
ejecución, y `BLACKOUT_DATES` se deriva de `TODAY + 2` en vez de ser una
fecha fija. Zona horaria: el resto del fichero sigue haciendo todos los
cálculos de fechas relativas en UTC (`new Date(iso + 'T00:00:00Z')`,
`setUTCDate`/`getUTCDay`) — eso no cambió. Lo que cambia es cómo se decide el
string ISO de "hoy": se usa el día natural en **Madrid** (`Intl.DateTimeFormat`
con `timeZone: 'Europe/Madrid'`, que ya resuelve CET/CEST solo), no UTC ni la
zona horaria local de la máquina que ejecute el script — para que un
`node gen_seed.js` lanzado, por ejemplo, a las 00:30 hora de España no calcule
"hoy" como el día anterior (que es lo que pasaría tomando la fecha UTC del
momento sin más, ya que a esa hora en España en UTC casi siempre sigue siendo
el día de antes). El detalle completo está comentado en el propio fichero,
junto a la constante `TODAY`.

**Ciclo ejecutado contra producción** (proyecto `jeamoczmbfsnwkfjxcyo`), con
`cleanup_demo_data.sql` y el `seed_demo_data.sql` recién regenerado, sin
tocar migraciones ni desplegar nada:

| Momento | `reservas` total | `[DEMO-SEED]` | Reales (resto) | Reservas hoy (2026-09-25) |
|---|---|---|---|---|
| Antes de tocar nada | 376 | 266 | 110 | 0 |
| Tras `cleanup_demo_data.sql` | 110 | 0 | 110 | 0 |
| Tras el nuevo `seed_demo_data.sql` | 375 | 265 | 110 | 12 |

Reservas de hoy tras sembrar, por estado: **confirmada 8, verificada 3,
pendiente 1** (12 en total).

Las 110 reales se confirmaron idénticas antes y después por dos vías: el
recuento por el marcador oficial (`notas_cliente NOT LIKE '[DEMO-SEED]%'`,
110 → 110 → 110) y, como señal adicional no oficial, el patrón
`email LIKE '%@test.com' OR telefono LIKE '612345%'` descrito en "Dato
importante para quien lea esto después" (109 de las 110 — la diferencia de 1
es solo una fila real con email/teléfono en otro formato, no algo que este
cambio haya tocado).

`trg_validar_capacidad` no se desactivó en ningún momento; tras sembrar, el
uso máximo observado por `(fecha, turno, marca)` quedó muy por debajo del
aforo (150 Casa Tomás / 20 Touza).

**`cleanup_demo_data.sql` también se actualizó**, solo en los dos literales de
fecha del parche de `ocupacion_diaria` (`2026-08-24`/`2026-10-07` →
`2026-08-26`/`2026-10-09`, el rango real del `seed_demo_data.sql` que queda
committeado tras este cambio) — sigue siendo un rango escrito a mano, no
autocalculado; queda anotado en el propio fichero que hay que actualizarlo en
cada regeneración futura, igual que este documento.

**Hallazgo aparte, no tocado (fuera de este encargo):** al verificar
`ocupacion_diaria` tras sembrar aparecieron 5 filas huérfanas el
2026-10-08 (horas `14:00`, `14:30`, `14:45`, `15:30`, `15:45`). No las creó
este seed — el generador nunca produce horas en `:45`, y el `2026-10-08` no
estaba dentro del rango que tocó ni el borrado ni el sembrado de este ciclo —
así que son un resto de otra causa anterior y no relacionada (probablemente
el mismo bug de `trigger_actualizar_ocupacion` descrito más abajo en
"Aviso sobre `ocupacion_diaria`", disparado alguna vez por una reserva real
creada y luego borrada por fuera de este seed). Se dejaron intactas, siguiendo
la misma regla que el resto de este documento: no tocar nada que este seed no
haya creado.
