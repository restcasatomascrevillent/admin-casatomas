# Redes: rrss dentro del panel

23/11/2026, rama `feature/redes-rrss`. Diseño completo, amenazas y orden de despliegue en el repo de
rrss: `docs/integracion-casatomas.md` (rama `f66/integracion-casatomas`).

## Qué es

La sección **Redes** (`/redes`) abre rrss, la herramienta de redes sociales, en un iframe. El personal
entra con su usuario del panel, sin otra cuenta ni contraseña y sin cookies:

1. El iframe (`rrss/embed`, sin nada en la dirección) genera un secreto y manda su huella al panel.
2. El panel pide a su servidor un **pase firmado** (ES256, 30 s, de un solo uso) ligado a esa huella y
   se lo da **solo** a ese iframe (comprueba `event.source` y el origen de rrss).
3. rrss lo cambia por una sesión limitada a la marca del restaurante.
4. Cada 10 minutos se repite. Si a alguien le quitan «Redes» o lo borran del panel, un disparador de
   `user_permissions` (migración `20261224100100`) llama a la función `rrss-embed-revoke`, que avisa a
   rrss con un aviso firmado, y rrss le corta el acceso **al momento**. Si el aviso no llega, rrss lo
   corta igual por caducidad (~20 minutos), porque el panel ya no le da pases.

Sustituye a la sección antigua **RRSS/Instagram** (`/rrss`, `/instagram`, `/instagram/rapido`), que
ahora redirige a `/redes`. Su código, tablas y funciones **no se han borrado**: siguen en el repo
y archivados en la rama local `archivo/instagram-estudio` (desde `origin/staging` en `903446d7`). El
borrado será otro PR cuando el dueño lo confirme. Sus tres cron (`instagram-programador`,
`instagram-metricas-diarias` e `instagram-limpieza-bucket`) publicarían lo que ya estuviera programado
sin pantalla que lo enseñe: este PR los quita con la migración
`20261224100000_instagram_antiguo_sin_cron.sql` (vuelta atrás en `supabase/rollbacks/`; prueba
`npm run test:instagram-sin-cron:db`). Lo programado queda guardado, sin publicarse.

## Historia del jueves de tapas (26/11/2026)

Con Redes configurada (`VITE_RRSS_URL`), la historia de tapas la hace **rrss con su plantilla de
tapas** y la antigua (render en `/api/instagram-render` + `instagram-programador`) ya no se crea:

1. Al guardar las tapas en Gestión web › Tapas (o al encender «Tapas» en la web), el panel llama a
   la función **`rrss-menu`** con el día. Exige «Redes» con «Puede editar» (o super admin).
2. `rrss-menu` **lee las tapas guardadas** de la base de datos (no las que manda el navegador),
   respeta el interruptor «historia automática» y «Mostrar Tapas en la web», calcula la hora (la de
   los ajustes, 12:00 por defecto; si ya pasó, en 15 minutos) y manda a rrss un **pedido firmado**
   (misma clave que los pases, `typ: "rrss-menu"`, 60 s, un solo uso) con nombre y precio de cada
   tapa (`Nombre | 2,50 €`, `Nombre · 2,50 €` o `Nombre 2,50 €`), «Jueves de tapas», la fecha y
   los turnos. Un pedido por semana: si cambian las tapas, rrss rehace la misma pieza.
3. Si rrss lo acepta, se **cancela la historia antigua** de esa semana si estaba programada; si la
   antigua ya salió, no se manda nada (409). Así nunca salen dos.
4. Como rrss dibuja la pieza en el navegador, el panel abre rrss un momento en un **iframe oculto**
   (`components/redes/PreparadorRedes.tsx`, mismo pase que la página Redes) para que la monte, la
   exporte y la deje en su calendario. Si no puede (o quien guarda no tiene «Redes»), la prepara rrss
   la próxima vez que alguien con edición abra Redes.
5. En rrss la pieza queda **aprobada y programada** solo si la integración tiene
   `menu_auto_approve = true` (lo pone la plataforma); si no, queda en el calendario pendiente de que
   la apruebe la agencia. Sin cuenta de Instagram conectada en rrss, queda en espera.

Las fotos de cada tapa salen de la biblioteca de rrss de la marca: la que se llame como la tapa
(nombre del archivo) o la lleve como etiqueta. Sin foto, la tapa va sin foto.

## Quién entra

Permiso nuevo **«Redes»** (`redes`) en Usuarios › Permisos. No cuenta para el rol (admin/manager/staff).

| En el panel | Nivel que va en el pase | En rrss (lo decide la integración de rrss; propuesta) |
| --- | --- | --- |
| Super admin | `superadmin` | Editor: sube, crea y publica |
| Redes: Ver + Puede editar | `editar` | Editor |
| Redes: solo Ver | `ver` | Solo lectura |

El pase lleva el nombre visible (`display_name`) del usuario, nunca su correo.
| Sin Redes | — | No ve la sección (403 en la función) |

El interruptor del módulo en Control del Panel sigue siendo la clave `rrss` (ahora se llama «Redes»).

## Piezas

- `src/pages/Redes.tsx`: la página (pide el pase, iframe con `sandbox` sin `allow-top-navigation`,
  vuelve a pedir pase si rrss avisa `rrss:expired`, como mucho 3 veces por minuto).
- `src/lib/redes.ts`: origen de rrss (`VITE_RRSS_URL`) y la dirección `…/embed#pass=…`.
- `supabase/functions/rrss-embed-pass/`: la función que firma el pase (`pase.ts`, 30 s) y sus pruebas.
- `supabase/functions/rrss-menu/`: el pedido de la historia de tapas (`menu.ts`) y sus pruebas; `lib/redesTapas.ts` y
  `components/redes/PreparadorRedes.tsx` en el panel.
- `supabase/functions/rrss-embed-revoke/`: el aviso de revocación (`aviso.ts`) y sus pruebas; el
  disparador, en `20261224100100_redes_aviso_revocar.sql` (prueba `npm run test:redes-aviso:db`).
- `vercel.json`: `frame-src` admite `https://rrss-omega.vercel.app` (rrss de staging). Si rrss cambia
  de dominio, hay que cambiarlo aquí también.

## Configuración (la pone el dueño)

Secretos de la función en el Supabase **demo** (`sfonaclosuafvlhutkon`):

| Secreto | Valor |
| --- | --- |
| `RRSS_EMBED_PRIVATE_JWK` | Clave privada EC P-256 en JWK (la pública va a rrss) |
| `RRSS_EMBED_KID` | Nombre de la clave, p. ej. `ct-demo-2026-11` |
| `RRSS_EMBED_ISSUER` | `https://sfonaclosuafvlhutkon.supabase.co/functions/v1/rrss-embed-pass` |
| `RRSS_EMBED_BRAND_ID` | `b141a5b7-65c1-4d79-acc8-a18ac6a5c84b` (Casa Tomás en rrss) |
| `RRSS_EMBED_PANEL_ORIGINS` | `https://admin-casatomas-git-staging-casa-tomas.vercel.app` (y `http://localhost:8080` para probar en local) |
| `RRSS_EMBED_AUDIENCE` | Opcional; por defecto `rrss` |
| `RRSS_EMBED_REVOKE_SECRET` | Secreto aleatorio (32 caracteres o más) para el aviso de revocación; el mismo valor en Vault como `rrss_embed_revoke_secret` |
| `RRSS_EMBED_MENU_URL` | `https://zzkdrfhqmjfvrdsoguio.supabase.co/functions/v1/embed-session/menu` (pedidos de tapas a rrss de staging) |
| `RRSS_EMBED_REVOKE_URL` | `https://zzkdrfhqmjfvrdsoguio.supabase.co/functions/v1/embed-session/revoke` (rrss de staging) |

Variable de Vercel (Preview): `VITE_RRSS_URL=https://rrss-omega.vercel.app`.

Migraciones: la de los cron (arriba) y la del aviso de revocación; los permisos por sección son filas de `user_permissions`.
