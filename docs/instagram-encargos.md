# Instagram › Encargos: piezas automáticas y encargos a Oficiosos

Pestaña **Encargos** de la sección Instagram (`/instagram?tab=encargos`,
después de «Calendario»). Fase 4 de la propuesta
(`instagram-studio/propuesta/PROPUESTA.md`, apartado 4). El restaurante pide
una pieza o un vídeo y lo sigue en un tablero; la agencia (Oficiosos) lo
acepta, entrega versiones y el restaurante aprueba o pide cambios. Lo
aprobado es una **pieza normal** (`instagram_piezas`, origen «encargo») que
se prueba, se publica o se programa como cualquier otra.

## Dos tipos, una sola bandeja

| Tipo | Quién lo hace | Cómo |
|---|---|---|
| **Automático** | El panel | Imagen: la plantilla elegida, la primera foto y el título como titular (6 palabras como mucho), por `/api/instagram-render`. Vídeo: el reel base elegido con las fotos del encargo en sus escenas, a la cola de render de reels (`instagram_render_encolar`, trabajador de `docs/instagram-video.md`). |
| **Encargo a Oficiosos** | Una persona de la agencia | Acepta con fecha de entrega, sube versiones (JPEG o MP4) y conversa en el hilo. |

El formulario **«Pedir un vídeo o una pieza»** lleva: qué es (vídeo, post o
story), marca, para cuándo (fecha deseada), quién lo hace, título, estilo o
plantilla (o reel base), la idea, el texto de la publicación y las fotos (el
selector de siempre: Drive, carta o «Subir foto», que va a Drive). Muestra
las condiciones vigentes.

Carrusel no está: `instagram_piezas` aún no publica carruseles.

## Estados y quién los cambia

Solo por RPC (`SECURITY DEFINER`); nadie tiene INSERT, UPDATE ni DELETE
directo en las tablas. Cada RPC comprueba el lado, el estado de origen y los
campos obligatorios, y deja una fila en `instagram_encargo_eventos`.

| De → a | Quién | RPC | Notas |
|---|---|---|---|
| (nuevo) → borrador | Restaurante | `instagram_encargo_guardar(null, datos)` | También modifica un borrador o un rechazado. |
| borrador / rechazado → enviado | Restaurante | `instagram_encargo_enviar` | Fecha deseada obligatoria y no pasada; idea obligatoria si es a Oficiosos; respeta el cupo. Calcula la entrega prevista (plazo en días laborables) y copia las rondas incluidas. Un automático pasa directamente a **en curso**. |
| enviado → aceptado | Agencia | `instagram_encargo_aceptar(id, fecha?, comentario?)` | Fecha de entrega comprometida (por defecto, dos días antes de la deseada, sin pasar del plazo ni de hoy). |
| enviado / aceptado → rechazado | Agencia | `instagram_encargo_rechazar(id, motivo)` | Motivo obligatorio. El restaurante puede editarlo y reenviarlo. |
| aceptado / cambios pedidos → en curso | Agencia | `instagram_encargo_empezar` | Opcional: se puede entregar sin «empezar». |
| aceptado / en curso / cambios pedidos → para revisar | Agencia | `instagram_encargo_entregar(id, ruta, portada?, texto?, nota?, bytes?, ancho?, alto?, duración?)` | Versión v1, v2… El fichero tiene que estar subido (ver «Entregas»). |
| en curso → para revisar | Restaurante (automático) | `instagram_encargo_vincular_pieza(id, pieza)` | Con la imagen generada; un vídeo se queda «en curso» hasta que el trabajador sube el MP4 (trigger). |
| para revisar → cambios pedidos | Restaurante | `instagram_encargo_pedir_cambios(id, comentario)` | Comentario obligatorio. Cuenta rondas: pasadas las incluidas se puede seguir pidiendo, pero queda marcado como **extra** («Ronda 3 · fuera de las 2 incluidas»). Solo a Oficiosos; un automático se retoca en «Crear» y se regenera. |
| para revisar → aprobado | Restaurante | `instagram_encargo_aprobar` | Aprueba la última versión: crea la `instagram_piezas` (JPEG en `imagen_ruta` o MP4 en `video_ruta`, estado «generada», origen «encargo») o enlaza la del automático. |
| aprobado → publicado | Sistema | trigger `instagram_piezas_avanzar_encargo` | Cuando su pieza pasa a «publicada» (a mano o programada). |
| cualquiera no final → cancelado | Restaurante | `instagram_encargo_cancelar(id, motivo)` | Motivo obligatorio. Un borrador se borra sin más. |
| — | Los dos | `instagram_encargo_comentar(id, texto, lado?)` | Hilo de comentarios; no cambia el estado. |

«Restaurante» = permiso de **Marketing**; «agencia» = permiso
**Instagram · Agencia (Oficiosos)** (`instagram_agencia`). El super admin es
las dos cosas (como en todo el panel). Las dos exigen la sesión de panel viva.

## Quién ve qué (RLS)

- El restaurante ve **todos** los encargos.
- La agencia ve **todos menos los borradores** (un borrador no se le ha
  enviado). Con los encargos ve sus fotos, versiones, mensajes e historial.
- Las condiciones (`instagram_encargos_ajustes`) las ven los dos; solo un
  super admin las cambia.
- Un usuario de la agencia **sin** Marketing entra en Instagram y solo ve la
  pestaña Encargos (menú lateral, ruta y página lo tienen en cuenta). No ve
  `instagram_piezas` ni la biblioteca de Drive: las fotos del restaurante le
  salen como miniatura (las de la carta) o como enlace a Drive (tiene que
  tener acceso a la carpeta «marketing» de Drive con su cuenta de Google).

## Condiciones (ajustes)

Fila única de `instagram_encargos_ajustes`. Por defecto, mientras el dueño no
decida (decisión abierta 5 de la propuesta):

| Ajuste | Por defecto |
|---|---|
| `plazo_dias_laborables` | 5 (lunes a viernes, sin festivos) |
| `rondas_incluidas` | 2 |
| `cupo_mensual` | `null` = sin límite (cuenta los encargos a Oficiosos enviados en el mes de Madrid) |

Se muestran en el formulario. Para cambiarlas (super admin), en el SQL
Editor de Supabase:

```sql
update public.instagram_encargos_ajustes
   set plazo_dias_laborables = 5, rondas_incluidas = 2, cupo_mensual = null;
```

Las rondas incluidas se copian en cada encargo al enviarlo: cambiar el
ajuste no toca los que ya están en marcha.

## Entregas (ficheros de la agencia)

Se suben desde la ficha («Entregar versión») directamente a los cubos
públicos, porque Meta necesita una URL pública para publicar:

| Formato | Cubo | Ruta | Límite |
|---|---|---|---|
| Post / story | `instagram` | `encargos/<encargo>/v<N>-<8 hex>.jpg` | JPEG, 8 MB |
| Vídeo (reel) | `instagram-video` | `reels/AAAA-MM/<encargo>-<8 hex>.mp4` (+ `.jpg` de portada opcional) | MP4, 50 MB, 3-90 s |

La agencia solo puede **subir** (INSERT) en esos prefijos (políticas
`ig_encargos_*`); no puede borrar ni sobrescribir. La RPC comprueba que el
fichero existe y que no se entregó antes. Los JPEG de `encargos/` no los
borra la limpieza diaria (solo mira `piezas/`). Al publicar una pieza de
imagen, `instagram-publicar` la archiva en Drive y la borra del cubo, como
cualquier otra: la vista previa de esa versión deja de verse en la ficha.

Fuera de alcance de esta fase: la subida reanudable a Drive (material en
bruto de cientos de MB), los recordatorios de 48 h y el correo a la agencia.

## Avisos

- **Campana del panel** (`notificaciones_dashboard`, tipo
  `instagram_encargo`): lo que va al restaurante (aceptado, rechazado, en
  curso, versión entregada, pieza automática lista, mensaje de Oficiosos).
  La campana la ve quien tiene «Dashboard»; al pulsarla abre la ficha
  (`/instagram?tab=encargos&encargo=<id>`).
- **Web Push**: tras cada RPC el panel llama a `notificar-video` con
  `{ evento_id, tipo: "encargo" }`. La función exige Marketing o
  Instagram · Agencia, que el que llama sea el autor del evento y que no
  hayan pasado 15 minutos, y avisa a la otra parte
  (`instagram_encargo_destinatarios`, solo `service_role`):
  - lo que hace el restaurante → todos los usuarios con
    `instagram_agencia` y quien tiene el encargo asignado;
  - lo que hace la agencia → quien creó el encargo;
  - nunca al que lo hizo ni a un usuario bloqueado.
  Cada persona activa los avisos en su dispositivo con **«Avisarme»** en la
  pestaña (mismo mecanismo y mismas claves VAPID que
  `docs/video-dispositivo-potente.md`; en iPhone, solo con el panel añadido
  a la pantalla de inicio). Sin claves VAPID no llega el push y todo lo demás
  funciona igual.

## Calendario

Cada encargo enviado y vivo (enviado, aceptado, en curso, para revisar,
cambios pedidos o aprobado) pinta un **hueco** en su fecha deseada: tarjeta
azul con borde discontinuo y la etiqueta «Encargo»; en **rojo** si la fecha
ya pasó y aún no está aprobado. Al pulsarlo se abre su ficha. Al aprobarlo,
«Programar en la fecha pedida» abre el diálogo de programar con esa fecha a
las 13:00 (la regla de ±30 min por marca sigue avisando de choques).

## Despliegue

Demo primero (`sfonaclosuafvlhutkon`); producción (`haqmmdfdzzatdnrrcgez`)
solo después de aceptar el PR y con el «sí» del dueño. Desde la raíz del repo:

1. **Migración** (una sola vez, nunca `db push`; después de
   `20261109100000_instagram_video`):
   ```
   npx supabase db query --linked -f supabase/migrations/20261110100000_instagram_encargos.sql
   ```
   Tiene que terminar en «instagram_encargos: aplicada». Deshacer:
   `supabase/rollbacks/20261110100000_instagram_encargos_ROLLBACK.sql`.
2. **Volver a desplegar `notificar-video`** (tipo «encargo»):
   ```
   npx supabase functions deploy notificar-video --project-ref sfonaclosuafvlhutkon
   ```
   No necesita secretos nuevos (usa los VAPID que ya tiene).
3. **Panel**: se publica solo con Vercel al subir a `staging`.

Sin la migración, la pestaña dice «Los encargos aún no están activados en
este Supabase» y el calendario sigue como antes.

## Cómo dar el permiso de agencia a un usuario

1. Crea el usuario (Usuarios → Invitar) o elige uno que ya exista.
2. Usuarios → **Permisos** del usuario (solo lo puede guardar un super
   admin) → marca **«Ver»** en **«Instagram · Agencia (Oficiosos)»**. Hoy
   «Ver» basta para actuar (`can_write_section` aún no exige «Puede
   editar»); márcalo también para cuando lo exija.
3. No le des «Newsletter» (Marketing) si solo debe ver los encargos: con
   Marketing también sería «restaurante» y vería Crear, Campañas, etc.
4. Que entre en el panel, abra **Instagram → Encargos** y pulse
   **«Avisarme»** en su móvil u ordenador.

Por SQL (equivalente, con el id del usuario):

```sql
insert into public.user_permissions (user_id, section_key, can_view, can_edit)
values ('<uuid del usuario>', 'instagram_agencia', true, true)
on conflict (user_id, section_key) do update set can_view = true, can_edit = true;
```

## Qué probar en la demo

Con dos usuarios (uno con Marketing y otro solo con Instagram · Agencia):

1. Restaurante: «Pedir un vídeo o una pieza» → vídeo, Casa Tomás, fecha en
   10 días, «Encargo a Oficiosos», idea y dos fotos → **Enviar**. Sale en
   «Pedido» y en el calendario (hueco azul).
2. Agencia: lo ve (y no ve los borradores), **Aceptar** con fecha →
   el restaurante recibe campana y push.
3. Agencia: **Entregar versión** con un MP4 9:16 → «Para revisar».
4. Restaurante: **Pedir cambios** (ronda 1 de 2) → agencia entrega v2 →
   **Aprobar** → «Programar en la fecha pedida». Al publicarse, el encargo
   pasa a «Publicado».
5. Automático: post con la plantilla «Foto y titular», una foto y un título
   corto → se genera al momento y queda «Para revisar»; **Aprobar**.

## Código

| Pieza | Dónde |
|---|---|
| Tablas, RLS, RPC, trigger | `supabase/migrations/20261110100000_instagram_encargos.sql` (rollback en `supabase/rollbacks/`) |
| Prueba SQL (PGlite) | `scripts/test-instagram-encargos.mjs` (`npm run test:instagram-encargos:db`, en el CI) |
| Push | `supabase/functions/notificar-video/` (`logica.ts`: `autorizarNotificacionEncargo`, `construirCargaEncargo`) |
| Panel | `src/components/instagram/encargos/` (`EncargosInstagram`, `FormularioEncargo`, `FichaEncargo`, `HuecoCalendario`, `logica.ts`, `api.ts`, `automatico.ts`) |
| Pestaña y contador | `src/pages/Instagram.tsx` |
| Huecos en el calendario | `src/components/instagram/programar/CalendarioInstagram.tsx` (`useHuecosEncargo`) |
| Permiso | `src/hooks/useUserRole.tsx` (`instagram_agencia`), `ProtectedRoute`, `AppSidebar` |
| Campana | `src/lib/avisos.ts` (`referencia_tipo = instagram_encargo`) |
