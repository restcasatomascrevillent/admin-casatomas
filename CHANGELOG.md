# Changelog

Publicaciones en producción de admin-casatomas. Cada entrada la escribe `scripts/release.mjs` al preparar la release y recoge solo los cambios incluidos en ella. La numeración 1.x empieza en 1.0.0; las versiones 0.N anteriores están en las Releases de GitHub.

## [1.8.0] - 2026-11-10

Objetivo: Reservas web más resistente (límite en disponibilidad y sin arranque en frío) y retoques de Facturas

### Añadido
- Reservas-web: rate-limit de /disponibilidad y keep-warm (anti cold-start) ([#52](https://github.com/restcasatomascrevillent/admin-casatomas/pull/52))

### Cambiado
- Facturas: la barra de Análisis va en su propia fila bajo las pestañas ([#45](https://github.com/restcasatomascrevillent/admin-casatomas/pull/45))
- Facturas: «proveedor nuevo» ya no suena en la campana ([#49](https://github.com/restcasatomascrevillent/admin-casatomas/pull/49))

## [1.7.0] - 2026-11-10

Objetivo: Tráfico web más limpio, Servicios con más datos, «Hoy» de Reservas al momento con mala cobertura

### Añadido
- Trafico-web: estética más limpia de la página de Tráfico web ([#41](https://github.com/restcasatomascrevillent/admin-casatomas/pull/41))
- Servicios: varios anillos por servicio, más datos de Supabase y Vercel, y GitHub sin falsa alarma ([#42](https://github.com/restcasatomascrevillent/admin-casatomas/pull/42))

### Cambiado
- Reservas: «Hoy» se pinta al momento con mala cobertura ([5da46ab](https://github.com/restcasatomascrevillent/admin-casatomas/commit/5da46ab3911abaf8eb89852068ef32e5f7f5ea11))
- Instagram: el test de render de «Foto enmarcada» ya no falla con la foto sintética ([#46](https://github.com/restcasatomascrevillent/admin-casatomas/pull/46))

## [1.6.0] - 2026-11-09

Objetivo: RRSS: un solo panel de métricas para todas las redes, con informe mensual en diapositivas y PDF

### Añadido
- Rrss: panel de métricas global con informe mensual (diapositivas y PDF) ([#43](https://github.com/restcasatomascrevillent/admin-casatomas/pull/43))

## [1.5.0] - 2026-11-09

Objetivo: Premio y último día del sorteo «Vota tu vino favorito» desde el panel (bases legales)

### Añadido
- Carta: premio y último día del sorteo «Vota tu vino favorito» desde el panel ([fc3d515](https://github.com/restcasatomascrevillent/admin-casatomas/commit/fc3d51596e0af88ce0a44e97ca236e6c341a7fe1))

### Cambiado
- Carta: la migración del premio cierra una votación abierta sin premio ni fecha ([bd169eb](https://github.com/restcasatomascrevillent/admin-casatomas/commit/bd169eb6d2ba01f29123e96b2547dae0fa9cde82))

## [1.4.0] - 2026-11-09

Objetivo: Reservas (mesas al final, eventos con la sala entera, móvil), Facturas «Proveedores», originales de la carta en Drive e Instagram «Foto enmarcada»

### Añadido
- Facturas: el original se ve al lado de los datos en la ficha del documento ([98e5553](https://github.com/restcasatomascrevillent/admin-casatomas/commit/98e555340942dbc4c58decda2d9b3f02b414261d))
- Facturas: vista «Proveedores» para decidir (lista comparada + ficha) ([d419bd1](https://github.com/restcasatomascrevillent/admin-casatomas/commit/d419bd19226d97fcc0fff5dc9a9c526d82e364c2))
- Reservas: hoja de mesa libre del móvil grande y ordenada ([a13211d](https://github.com/restcasatomascrevillent/admin-casatomas/commit/a13211d6144bb1f0bd7e05b1c87cbdcadf04e7e6))
- Reservas: mesas que se usan al final (para dejar paso) ([0430083](https://github.com/restcasatomascrevillent/admin-casatomas/commit/0430083dc44e12624d005acf42ec8581bb8e3290))
- Instagram-drive: originales de las fotos de la carta en Drive ([04e5daa](https://github.com/restcasatomascrevillent/admin-casatomas/commit/04e5daa3776aaac798ae1f8f594b78041ceb3c7c))
- Carta: guardar el original de la foto en Drive e Instagram lo usa ([617fd4a](https://github.com/restcasatomascrevillent/admin-casatomas/commit/617fd4a7ea75a4934f553989f39bfe4d57f4510e))
- Instagram: plantillas «Foto enmarcada» para usar las fotos de la carta ([8be60f6](https://github.com/restcasatomascrevillent/admin-casatomas/commit/8be60f6d1799b1c9d9936bb07ad518dfa35f232c))
- Instagram-ia: elegir «Foto enmarcada» cuando la foto no cubre ([eb69e05](https://github.com/restcasatomascrevillent/admin-casatomas/commit/eb69e0513e77e4ac3fa74834158e43ec8f81742e))
- Instagram-drive: descargar_original y subir_original_video para originales de la carta solo en Drive ([811b3db](https://github.com/restcasatomascrevillent/admin-casatomas/commit/811b3db510546a03982ee9fac3da4fdeae96664e))
- Carta: en Supabase solo el sticker; los originales de platos y vinos van solo a Drive ([d67cc4a](https://github.com/restcasatomascrevillent/admin-casatomas/commit/d67cc4a93aa2021941dd9369dc4db6ef60cf2642))
- Scripts: mover-originales-a-drive (simula por defecto) y docs de «solo el sticker» ([0a13786](https://github.com/restcasatomascrevillent/admin-casatomas/commit/0a13786b81ef379412f43518314a55b32c86a8be))
- Reservas: leyenda de colores en la vista Mesas del móvil ([4961e55](https://github.com/restcasatomascrevillent/admin-casatomas/commit/4961e550f3a8510f05182943b1670acca8642d11))
- Reservas: evento con la sala entera ([d5f8950](https://github.com/restcasatomascrevillent/admin-casatomas/commit/d5f895010840fa8b316c841d2dcedb699260fd5d))

### Cambiado
- Supabase: categoría «Conservas y salazones» que faltaba en producción ([a31fdf8](https://github.com/restcasatomascrevillent/admin-casatomas/commit/a31fdf8d7497394887606bca49f247aba49c311f))
- Panel: menú lateral sin la barra de scroll blanca con flechas ([940e8b5](https://github.com/restcasatomascrevillent/admin-casatomas/commit/940e8b568ff7c9c63abfaa8021fcc890b50f318a))
- Reservas: Hoy de escritorio solo con mesas ordenadas, sin «Plano» ([6bab00e](https://github.com/restcasatomascrevillent/admin-casatomas/commit/6bab00ee090ccbeee3ed0e456bef742881a69f2a))
- Instagram: en el móvil «Programar» ya no se queda sin hora ([07dc455](https://github.com/restcasatomascrevillent/admin-casatomas/commit/07dc4555c6fed1201b2840f09ff76334af471b0b))
- Scripts: quitar el shebang de importar-originales para que vitest lo cargue ([a8897a4](https://github.com/restcasatomascrevillent/admin-casatomas/commit/a8897a45967cc72d1b862ac52c4764845b336e1d))

### Otros
- Proceso: nunca desplegar ni promocionar en Vercel a mano ([#29](https://github.com/restcasatomascrevillent/admin-casatomas/pull/29))

## [1.3.0] - 2026-11-09

Objetivo: RRSS: Instagram, Facebook y editor IA de fotos y vídeos; CI otra vez en marcha

### Cambiado
- CI otra vez en marcha (lockfile) y migraciones con versión propia ([#31](https://github.com/restcasatomascrevillent/admin-casatomas/pull/31))

### Otros
- Instagram, Facebook y editor IA de fotos y vídeos ([#27](https://github.com/restcasatomascrevillent/admin-casatomas/pull/27))

## [1.2.0] - 2026-11-09

Objetivo: Puntuaciones Parker con fuente por añada y búsqueda desde la foto de la etiqueta

### Cambiado
- Parker: migración Parker con versión propia (20261118103000) ([#32](https://github.com/restcasatomascrevillent/admin-casatomas/pull/32))

### Otros
- Puntuaciones con fuente por añada, revisión de la carta y búsqueda desde la foto de la etiqueta ([#26](https://github.com/restcasatomascrevillent/admin-casatomas/pull/26))

## [1.1.0] - 2026-11-09

Objetivo: Super Admin › Logs: actividad de la web, incidencias en Linear y estadísticas de comportamiento

### Añadido
- Super Admin › Logs: actividad de la web, incidencias en Linear y estadísticas de comportamiento ([#28](https://github.com/restcasatomascrevillent/admin-casatomas/pull/28))

## [1.0.0] - 2026-11-09

Objetivo: Primera release 1.x: proceso de releases y carta impresa con una sección por cara

Primera versión de la serie 1.x. Producción estaba en v0.403.

### Añadido
- Releases: publicar solo los cambios elegidos, con versiones 1.x ([#24](https://github.com/restcasatomascrevillent/admin-casatomas/pull/24))
- Carta impresa: una sección por cara en A4 y A5 (platos y vinos) ([#25](https://github.com/restcasatomascrevillent/admin-casatomas/pull/25))
