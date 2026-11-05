# Instagram: programar publicaciones

La API de Instagram **no** programa publicaciones (el `scheduled_publish_time`
de Meta es solo para Facebook). Lo montamos nosotros: el panel guarda la fecha
y una tarea de `pg_cron` llama cada 5 minutos a una Edge Function que publica
lo vencido con el **mismo núcleo** que «Publicar» (`instagram-publicar`). Ver
también [instagram.md](instagram.md).

```
 Panel (Marketing)                       Supabase                                         Meta
 ─────────────────                       ────────                                         ────
 ProgramarPiezaDialog ── RPC ──► instagram_programar / _reprogramar / _cancelar_programacion
 CalendarioInstagram  ◄─ select ─ instagram_programaciones (+ instagram_piezas.publicada_at)

                                 pg_cron */5 ─ net.http_post (URL y secreto de Vault, solo si hay vencidas)
                                      │
                                      ▼
                                 Edge Function instagram-programador (x-webhook-secret)
                                   instagram_programador_reclamar  (FOR UPDATE SKIP LOCKED + bloqueo)
                                   publicarConSesion (núcleo de instagram-publicar, service_role) ──► cuota, contenedor,
                                                                                                    FINISHED, media_publish
                                   instagram_programador_cerrar  (publicada / reintentar / aplazar / error)
```

## Qué hay

| Pieza | Dónde |
|---|---|
| Migración | `supabase/migrations/20261106110000_instagram_programacion.sql` (rollback en `supabase/rollbacks/`) |
| Edge Function | `supabase/functions/instagram-programador/` (`index.ts` engancha; lógica en `programador.ts`) |
| Núcleo de publicación | `publicarConSesion` en `supabase/functions/instagram-publicar/publicar.ts` |
| Panel | `src/components/instagram/programar/` (`ProgramarPiezaDialog`, `CalendarioInstagram`, `useProgramacionInstagram`, `logica.ts`) |
| Pruebas | `supabase/functions/instagram-programador/__tests__/` y `src/components/instagram/programar/__tests__/` (vitest), `npm run test:instagram-programar:db` (PGlite) |

### Por qué una tabla aparte

`instagram_piezas.estado` lo reescriben `instagram-publicar` («error»,
«prueba_ok», «publicada») y el render («generada»): un estado «programada» ahí
se pisaría al regenerar o probar la pieza, o en el primer intento fallido. El
bloqueo, los intentos y el contenedor a medias son de la tarea, no de la
pieza. `instagram_programaciones` guarda además el historial (canceladas,
errores) sin cambiar la forma de la pieza. A la pieza solo se le añade
`publicada_at` (la pone un trigger al pasar a «publicada») para pintar las
publicadas en el calendario.

### Estados

```
programada ──(vence; el programador la reclama)──► publicando ──► publicada
     ▲                                                 │
     │  reintentar (5 min, 15 min) / aplazar (cuota)   │
     └─────────────────────────────────────────────────┤
                                                       └──► error (3.er fallo o fallo definitivo)
programada / error ──(Cancelar)──► cancelada
error ──(Mover / Volver a programar)──► programada (intentos a 0)
```

- **Una sola activa** (programada o publicando) por pieza. Programar otra vez
  la misma pieza la **mueve**.
- **Reintentos**: hasta 3 intentos; tras el 1.º espera 5 min y tras el 2.º, 15
  min. Cuentan los 5xx de Meta, los fallos de red, la falta de secretos y el
  202 «Meta aún procesa la imagen» (en ese caso la siguiente pasada reutiliza
  el MISMO contenedor, sin crear otro).
- **Fallos definitivos** (sin reintento): pieza sin imagen o borrada, JPEG que
  Meta no podría descargar, texto no válido, contenedor que Meta ya da por
  publicado.
- **Cuota de Meta agotada** (o límites de llamadas): se **aplaza** 5 min sin
  contar intento y la pasada termina (no se gasta nada).
- **Idempotencia**: si la pieza ya tiene `media_id` (se publicó a mano o una
  pasada anterior no llegó a cerrar), se marca «publicada» sin llamar a Meta.
  Si la pasada se corta a mitad (el bloqueo de 10 min caduca), **no** se
  vuelve a publicar sola: queda en error pidiendo comprobarlo en Instagram
  (o «publicada» si la pieza ya tiene `media_id`).
- **Contenedor**: se crea en el momento de publicar (caduca a las 24 h). Al
  publicar se borra el JPEG del bucket, como en «Publicar».

### Validaciones (en el panel y otra vez en las RPC)

- Como mínimo **10 minutos** desde ahora y como máximo **75 días**.
- La hora se elige en **Europe/Madrid** sea cual sea la zona del dispositivo.
  La hora que no existe (salto de marzo, 02:00-03:00) se rechaza; en la hora
  repetida de octubre se toma la primera.
- La pieza tiene que estar generada (con JPEG) y sin publicar.
- Si en **±30 minutos** ya hay otra programada de la **misma marca**, la RPC
  devuelve `{ ok: false, requiereConfirmacion: true, conflictos }` sin cambiar
  nada; el diálogo lo enseña y «Programar igualmente» la reenvía con
  `p_confirmar_conflicto = true`.

### Permisos

- Leer `instagram_programaciones`: `can_read_section('marketing')` y sesión de
  panel viva (`acceso_panel_no_bloqueado`); anon nada.
- Escribir: **solo** por las RPC `instagram_programar`, `instagram_reprogramar`
  e `instagram_cancelar_programacion` (`SECURITY DEFINER`,
  `can_write_section('marketing')` + sesión viva). `authenticated` no tiene
  INSERT/UPDATE/DELETE sobre la tabla.
- `instagram_programador_reclamar` / `_cerrar`: solo `service_role`.
- La Edge Function usa `service_role` (no hay usuario a las 4 de la mañana) y
  manda `x-audit-source: instagram-programador` en todas las llamadas a
  Supabase (la auditoría lo exige para `service_role`). Las tablas se auditan.

## Integrarlo en la página

```tsx
import { CalendarioInstagram, ProgramarPiezaDialog } from "@/components/instagram/programar";

// Botón «Programar» (junto a «Publicar», con la pieza ya generada):
const [programarAbierto, setProgramarAbierto] = useState(false);
<Button variant="outline" disabled={!pieza?.id || !pieza.imagen_ruta || pieza.estado === "publicada"}
        onClick={() => setProgramarAbierto(true)}>
  <CalendarClock className="mr-2 h-4 w-4" /> Programar
</Button>
<ProgramarPiezaDialog piezaId={pieza?.id ?? null} open={programarAbierto} onOpenChange={setProgramarAbierto} />

// Calendario (pestaña o panel de la página /instagram; ocupa el alto que queda):
<CalendarioInstagram marca="todas" onAbrirPieza={(id) => abrirEnEditor(id)} />
```

- `ProgramarPiezaDialog` props: `piezaId`, `open`, `onOpenChange`,
  `programacionId?` (mover una concreta), `inicial?` (instante), `onHecho?`.
- `CalendarioInstagram` props: `marca?` (`"casa-tomas" | "touza" | "todas"`),
  `vistaInicial?` (`"semana" | "mes"`), `onAbrirPieza?`, `altoMinimo?`,
  `className?`. Usa `useAlturaDisponible`: el scroll va dentro de cada día,
  nunca en la página. En móvil los días se apilan y se desplaza la rejilla.
- Los dos necesitan el `QueryClientProvider` del panel y se refrescan solos
  (sondeo de 60 s; al programar/cancelar se invalidan `instagram_programaciones`
  e `instagram_piezas`).

## Desplegar (demo primero)

Desde la raíz del repo (`admin-casatomas/`), con el proyecto demo enlazado:

1. Migración (después de `20261105090000_instagram.sql`):
   ```
   npx supabase db query --linked -f supabase/migrations/20261106110000_instagram_programacion.sql
   ```
   Termina en `instagram_programacion: aplicada | cron_activo | vault_project_url | vault_secreto_programador`.
2. Secreto del cron: genera un valor aleatorio largo y ponlo **igual** en los
   dos sitios (sin pegarlo en chats ni en el repo):
   ```
   npx supabase secrets set INSTAGRAM_PROGRAMADOR_SECRET=<valor> --project-ref sfonaclosuafvlhutkon
   ```
   y en el SQL editor de ese proyecto:
   ```sql
   select vault.create_secret('<valor>', 'instagram_programador_secret');
   -- si aún no existe (lo usan otras tareas):
   select vault.create_secret('https://sfonaclosuafvlhutkon.supabase.co', 'project_url');
   ```
   Mientras falte cualquiera de los dos en Vault el cron está **mudo** (no
   llama a nada).
3. Funciones (la de publicar, por el cambio de `publicarConSesion`):
   ```
   npx supabase functions deploy instagram-programador instagram-publicar --project-ref sfonaclosuafvlhutkon
   ```
   `instagram-programador` lleva `verify_jwt = false` en `supabase/config.toml`
   (la llama pg_cron sin JWT); su autenticación es la cabecera. Usa los mismos
   secretos de Meta que `instagram-publicar`.
4. Probar: programar una pieza generada a +11 min, esperar ≤ 5 min tras la
   hora y comprobar en el calendario que pasa a «Publicada». Para forzar una
   pasada sin esperar al cron:
   ```sql
   select net.http_post(url := 'https://sfonaclosuafvlhutkon.supabase.co/functions/v1/instagram-programador',
     headers := jsonb_build_object('Content-Type','application/json','x-webhook-secret',
       (select decrypted_secret from vault.decrypted_secrets where name = 'instagram_programador_secret')),
     body := '{}'::jsonb, timeout_milliseconds := 150000);
   ```

Producción (`haqmmdfdzzatdnrrcgez`) solo después de aceptar el PR y con el «sí»
del dueño, con su propio secreto.

## Diagnóstico

```sql
-- Pendientes y errores
select id, pieza_id, marca, programada_para, estado, intentos, siguiente_intento_at, ultimo_error
  from public.instagram_programaciones where estado <> 'cancelada' order by programada_para desc limit 50;
-- El cron y sus últimas ejecuciones
select * from cron.job where jobname = 'instagram-programador';
select status, return_message, start_time from cron.job_run_details
 where jobid = (select jobid from cron.job where jobname = 'instagram-programador') order by start_time desc limit 10;
-- Respuestas de la función (pg_net)
select status_code, content, created from net._http_response order by created desc limit 10;
```

| Qué pasa | Por qué | Qué hacer |
|---|---|---|
| Nada se publica y el cron no llama | Faltan `project_url` o `instagram_programador_secret` en Vault | Crearlos (paso 2) |
| La función responde 401 | El secreto de Vault y `INSTAGRAM_PROGRAMADOR_SECRET` no coinciden | Ponerlos iguales |
| Responde 500 «Falta configurar INSTAGRAM_PROGRAMADOR_SECRET» | Falta el secreto de la función | `npx supabase secrets set …` |
| Error «se cortó a mitad» | La pasada murió publicando | Mirar la cuenta de Instagram; si no salió, «Volver a programar» |
| Se queda en «programada» con aviso de cuota | Cuota de 24 h agotada | Nada: se publica cuando haya cuota |
| Error tras 3 intentos | Meta caído, token caducado, secretos… | «Ver error» en el calendario, arreglar y «Volver a programar» |

## Límites conocidos

- Precisión: hasta ~5 minutos tarde (frecuencia del cron) y en orden de
  vencimiento; como mucho 5 piezas por pasada (≈60 s de presupuesto).
- Las publicadas salen en el calendario sin miniatura: el JPEG se borra del
  bucket al publicar (el archivo definitivo va a Drive).
- Los tipos de `src/integrations/supabase/types.ts` no incluyen estas tablas
  ni RPC (se consultan con el cliente sin tipos, como `instagram_piezas`).
