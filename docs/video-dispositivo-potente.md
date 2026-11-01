# Vídeo del plato: «Mandar a un dispositivo potente»

Procesar el vídeo del plato (quitar el fondo fotograma a fotograma) en un móvil tarda varios minutos y gasta batería. Con esta función, el móvil **sube el vídeo tal cual** y un **ordenador potente** que tenga el panel abierto lo procesa, lo guarda en el plato y avisa al móvil con una notificación, aunque el panel del móvil esté cerrado.

## Cómo funciona

1. **Móvil** → en el plato, sección «Vídeo del plato», botón **«Mandar a un dispositivo potente»**. Se elige o graba el vídeo y se sube en bruto a `platos/pendientes/<uuid>.<ext>` (máx. 50 MB, el límite del plan gratuito de Supabase; 3–4 s de vídeo pesan mucho menos). Se crea una fila en `trabajos_video` y el plato muestra **«Vídeo pendiente»**. Se ofrece **«Avisarme cuando esté listo»** (pide permiso de notificaciones y guarda la suscripción push).
2. **Ordenador potente** (WebGPU y menos de 2 s por fotograma con el modelo del recorte; la prueba se hace sola y se guarda una semana en el navegador) con el panel abierto → cada 60 s mira si hay pendientes. Si los hay sale un aviso fijo: *«Hay 1 vídeo pendiente: Arroz meloso. ¿Procesarlo aquí?»*. Al aceptar: reclama el trabajo (nadie más puede cogerlo), descarga el bruto y lo mete en la **cola de vídeo del panel** (la misma que «Generar vídeo»: se procesa en segundo plano, con su indicador, y guarda `video_url` sola). Al terminar marca el trabajo como listo y borra el bruto.
3. **Aviso al móvil**: el ordenador llama a la Edge Function `notificar-video`, que manda un Web Push a las suscripciones del que grabó: *«Vídeo listo: Arroz meloso»*. Al pulsarlo se abre el panel en la carta (`/gestion-web?tab=carta&plato=<id>`).

Si un ordenador reclama un vídeo y se cierra a medias, a los 10 minutos otro lo puede volver a coger. Si el procesado falla, el trabajo queda en «error» y el móvil recibe *«No se pudo hacer el vídeo: …»*; el bruto se conserva.

## Qué tiene que hacer el dueño (una vez, primero demo y luego producción)

Nada de esto lo puede hacer Claude: no tiene acceso a Supabase ni a los secretos.

### 1. Generar las claves VAPID (en tu ordenador)

```bash
npx web-push generate-vapid-keys
```

Sale una **Public Key** y una **Private Key**. Usa **el mismo par** en demo y en producción, o uno por entorno (si las cambias, los móviles tienen que volver a pulsar «Avisarme»). **La privada no se pega en ningún sitio más que en los secretos de Supabase.** No la subas al repositorio.

### 2. Demo (`sfonaclosuafvlhutkon`)

1. **Migración**: aplicar `supabase/migrations/20261101160000_trabajos_video.sql`:
   ```bash
   npx supabase db query --linked -f supabase/migrations/20261101160000_trabajos_video.sql
   ```
   (con el proyecto enlazado a la demo). Se puede repetir sin riesgo.
2. **Secretos de la función** (Supabase → Edge Functions → Secrets, o por terminal):
   ```bash
   npx supabase secrets set --project-ref sfonaclosuafvlhutkon \
     VAPID_PUBLIC_KEY=<Public Key> \
     VAPID_PRIVATE_KEY=<Private Key> \
     VAPID_SUBJECT=mailto:<correo del restaurante>
   ```
3. **Desplegar la función**:
   ```bash
   npx supabase functions deploy notificar-video --project-ref sfonaclosuafvlhutkon
   ```
4. **Vercel** (proyecto `admin-casatomas`, entorno **Preview**): variable `VITE_VAPID_PUBLIC_KEY=<Public Key>` y volver a desplegar `staging` (las `VITE_*` se leen al compilar).

### 3. Producción (`haqmmdfdzzatdnrrcgez`), solo tras aceptar el PR

Lo mismo con `--project-ref haqmmdfdzzatdnrrcgez` y la variable de Vercel en el entorno **Production**.

### Si no se hace

- **Sin la migración**: el botón y el aviso no aparecen. El resto del vídeo del plato funciona igual.
- **Sin `VITE_VAPID_PUBLIC_KEY`**: se puede mandar y procesar, pero no se ofrece «Avisarme»; se explica que los avisos push no están configurados.
- **Sin la función o sin los secretos VAPID**: el vídeo se procesa y se guarda igual; solo no llega la notificación.

## Detalles técnicos

| Pieza | Dónde |
|---|---|
| Tablas, RLS y RPC | `supabase/migrations/20261101160000_trabajos_video.sql` (rollback en `supabase/rollbacks/`) |
| Prueba SQL (PGlite) | `scripts/test-trabajos-video.mjs` (`npm run test:trabajos-video:db`, en el CI) |
| ¿Dispositivo potente? | `src/components/carta/potente/dispositivoPotente.ts` |
| Cola, textos, extensiones | `src/components/carta/potente/colaPendientes.ts` |
| Supabase (subir, reclamar, terminar…) | `src/components/carta/potente/trabajosVideo.ts` |
| Procesar un trabajo | `src/components/carta/potente/procesarTrabajoRemoto.ts` |
| Botón del móvil | `src/components/carta/potente/BotonMandarPotente.tsx` |
| Aviso en el ordenador | `src/components/carta/potente/AvisoTrabajosVideo.tsx` (montado en `App.tsx` dentro de `ColaVideosProvider`) |
| Puente con la cola de vídeo | `src/components/carta/potente/esperasCola.ts` (encola el bruto y espera listo/fallo/cancelado) |
| Suscripción push | `src/components/carta/potente/pushVideo.ts` |
| Service worker (push y clic) | `public/sw-push.js`, cargado desde `public/sw.js` con `importScripts` |
| Edge Function | `supabase/functions/notificar-video/` (`verify_jwt = true` en `config.toml`) |

- **Permisos**: todo exige la sección `gestor_carta` (como las políticas de `Platos` y del bucket `platos`) y sesión de panel no bloqueada. Los cambios de estado solo van por RPC (`reclamar_trabajo_video`, `terminar_trabajo_video`, `soltar_trabajo_video`); no hay `UPDATE` directo. `reclamar_trabajo_video` usa `FOR UPDATE SKIP LOCKED`: dos ordenadores a la vez nunca cogen el mismo vídeo. Cada usuario solo ve y borra sus suscripciones push; el alta va por `guardar_suscripcion_push` (si en un navegador entra otro usuario, la suscripción pasa a él).
- **`notificar-video`** solo envía si el que llama procesó (o creó) el trabajo y el trabajo ya terminó. Borra las suscripciones caducadas (404/410).
- **Privacidad**: el bucket `platos` es público; el bruto está en una ruta con UUID aleatorio y se borra al terminar. Un trabajo en «error» conserva su bruto hasta que se cancela desde el plato.
- **iPhone**: Safari solo admite Web Push si el panel está **añadido a la pantalla de inicio** y se abre desde ahí (iOS 16.4 o posterior).
- **Recorte a 4 s antes de subir**: no se hace. Recortar sin recodificar no es fiable en el navegador; se sube el vídeo entero con el límite de 50 MB y el ordenador usa los primeros 4 s.

## Qué probar en la demo (tras los pasos 1–2)

1. En el **móvil**: abrir un plato → «Mandar a un dispositivo potente» → elegir un vídeo de 3–4 s. Debe salir «Vídeo pendiente». Pulsar «Avisarme cuando esté listo» y aceptar el permiso.
2. En el **ordenador** con el panel abierto (Chrome o Edge con WebGPU): antes de un minuto debe salir el aviso con el nombre del plato. «Procesarlo aquí» → progreso → «Vídeo guardado».
3. En el **móvil** (con el panel cerrado): debe llegar «Vídeo listo: <plato>». Al pulsarla se abre la carta. El plato tiene el vídeo.
4. Con el plato pendiente, «Cancelar envío» debe quitar el aviso del ordenador en el siguiente minuto.
5. Sin la migración (p. ej. en producción antes de aplicarla), el botón no debe aparecer.
