# Changelog

Publicaciones en producción de admin-casatomas. Cada entrada la escribe `scripts/release.mjs` al preparar la release y recoge solo los cambios incluidos en ella. La numeración 1.x empieza en 1.0.0; las versiones 0.N anteriores están en las Releases de GitHub.

## [1.19.0] - 2026-11-10

Objetivo: Ver el gasto de leer las reservas escritas a mano

### Añadido
- Reservas: gasto de leer las reservas escritas a mano en Super Admin › Servicios › Costes y en el libro ([#104](https://github.com/restcasatomascrevillent/admin-casatomas/pull/104))

Nota: montada igualando producción con staging; entrada escrita a mano, no por scripts/release.mjs.

## [1.18.0] - 2026-11-10

Objetivo: Un solo «Nueva Reserva» con formulario o libro, más contraste en Reservas, libro proporcionado en el ordenador y «Sentar sin reserva» eligiendo entre todas las mesas

### Añadido
- Reservas: un solo «Nueva Reserva» con «Formulario» o «Libro (lápiz)» dentro, recordando la elección ([#100](https://github.com/restcasatomascrevillent/admin-casatomas/pull/100))
- Reservas: «Sentar sin reserva» eligiendo entre todas las mesas, como al sentar una reserva sin mesa ([#102](https://github.com/restcasatomascrevillent/admin-casatomas/pull/102))

### Cambiado
- Reservas: más contraste en botones, campos, textos secundarios y pestaña activa ([#100](https://github.com/restcasatomascrevillent/admin-casatomas/pull/100))
- Reservas: el renglón del libro se ajusta al alto de la pantalla y la lista del día no queda aplastada ([#100](https://github.com/restcasatomascrevillent/admin-casatomas/pull/100))

Nota: montada igualando producción con staging (como la 1.16.0 y la 1.17.0); entradas escritas a mano, no por scripts/release.mjs.

## [1.17.0] - 2026-11-10

Objetivo: Libro de reservas con letra legible y «Guardar sin interpretar»; formularios de reserva sin textos de ejemplo, personas escritas a mano y resumen antes de guardar

### Añadido
- Reservas: libro — guardar lo escrito sin interpretar y pasarlo a limpio luego ([#96](https://github.com/restcasatomascrevillent/admin-casatomas/pull/96))
- Reservas: resumen de la reserva antes de guardarla en el alta ([#98](https://github.com/restcasatomascrevillent/admin-casatomas/pull/98))
- Vinos: migraciones de vinos nuevos, precios y origen ([5232711](https://github.com/restcasatomascrevillent/admin-casatomas/commit/52327112))

### Cambiado
- Reservas: libro con letra normal y más grande ([#95](https://github.com/restcasatomascrevillent/admin-casatomas/pull/95))
- Reservas: formularios sin textos de ejemplo y número de personas escrito a mano en alta/edición, Hoy y «Sentar sin reserva» ([#97](https://github.com/restcasatomascrevillent/admin-casatomas/pull/97))

### Arreglado
- RRSS: el script de copias de contratos reconoce el import con .js ([fad7f6f](https://github.com/restcasatomascrevillent/admin-casatomas/commit/fad7f6f7))

Nota: montada igualando producción con staging (como la 1.16.0); entradas escritas a mano, no por scripts/release.mjs.

## [1.16.0] - 2026-11-10

Objetivo: Publicar todo lo que quedaba en staging (lo que chocaba con producción en la 1.15.0), alineando producción con la demo

### Añadido
- Super Admin: módulo «Informes» con todos los informes del panel ([#78](https://github.com/restcasatomascrevillent/admin-casatomas/pull/78))
- Informes: el módulo reúne también Servicios y Cheques regalo ([#80](https://github.com/restcasatomascrevillent/admin-casatomas/pull/80))
- Logs: agrupación de errores repetidos, causas conocidas y tickets con contexto ([#71](https://github.com/restcasatomascrevillent/admin-casatomas/pull/71))
- Vinos: añadas y puntuación Parker ([#75](https://github.com/restcasatomascrevillent/admin-casatomas/pull/75))
- Reservas: «Sentar fuera» en Hoy (Touza, Terraza Touza u otro) sin contar en las salas ([#90](https://github.com/restcasatomascrevillent/admin-casatomas/pull/90))
- Reservas: botones Cerrar comida / Cerrar noche con confirmación ([c989662](https://github.com/restcasatomascrevillent/admin-casatomas/commit/c989662))
- RRSS: motor real de edición de fotos (sharp) y vídeos (ffmpeg) en Vercel ([5493010](https://github.com/restcasatomascrevillent/admin-casatomas/commit/5493010))

### Cambiado
- Tienda: repaso de estética del panel y sin botón de abrir la web ([#66](https://github.com/restcasatomascrevillent/admin-casatomas/pull/66))
- Carta PDF: interlineado a elegir y sin aviso de «varias páginas» ([#67](https://github.com/restcasatomascrevillent/admin-casatomas/pull/67))
- Permisos: Stripe de Cheques y «PDF Carta» solo con «Editar» ([#83](https://github.com/restcasatomascrevillent/admin-casatomas/pull/83))
- Facturas: la migración de «Comparar facturas» pasa a la versión 20261122100100 ([#91](https://github.com/restcasatomascrevillent/admin-casatomas/pull/91))

### Arreglado
- Vercel: errores de tipos de api/ en el build ([#84](https://github.com/restcasatomascrevillent/admin-casatomas/pull/84))
- Release: la rama capturas-release lleva siempre su vercel.json sin despliegue ([#77](https://github.com/restcasatomascrevillent/admin-casatomas/pull/77))
- CI: tests solo de lo cambiado en staging; suite completa solo en release ([71a18f0](https://github.com/restcasatomascrevillent/admin-casatomas/commit/71a18f0))

Nota: esta release se montó igualando producción con staging (los cambios chocaban al copiarlos uno a uno); entradas escritas a mano, no por scripts/release.mjs.

## [1.15.0] - 2026-11-10

Objetivo: Libro de reservas con lápiz, avisos de reservas nuevas y canceladas, facturas (comparar y gráficas), newsletter, cheques, reseñas, servicios, usuarios y más

### Añadido
- Reservas: la Lista se pone al día sola con los cambios de otros dispositivos ([#65](https://github.com/restcasatomascrevillent/admin-casatomas/pull/65))
- Rama feature/gestor-web-dietas ([#68](https://github.com/restcasatomascrevillent/admin-casatomas/pull/68))
- Dashboard: módulos «Márgenes de precio» y «Avisos»; «Análisis general» pasa a Facturas › Márgenes ([#70](https://github.com/restcasatomascrevillent/admin-casatomas/pull/70))
- Rama feature/servicios-costes ([#72](https://github.com/restcasatomascrevillent/admin-casatomas/pull/72))
- Resenas: contestador con IA y reseñas de Google que se traen solas ([#73](https://github.com/restcasatomascrevillent/admin-casatomas/pull/73))
- Rama feature/usuarios-reservas-albaranes ([#74](https://github.com/restcasatomascrevillent/admin-casatomas/pull/74))
- Newsletter: plantillas con la estética de Casa Tomás, plantillas nuevas y «Crear con IA» ([#76](https://github.com/restcasatomascrevillent/admin-casatomas/pull/76))
- Cheques: pestaña Stripe revisada e informe de cheques regalo en diapositivas y PDF ([#79](https://github.com/restcasatomascrevillent/admin-casatomas/pull/79))
- Reservas: libro de reservas para escribir la reserva a mano con el lápiz ([#81](https://github.com/restcasatomascrevillent/admin-casatomas/pull/81))
- Reservas: Avisos solo con reservas nuevas y canceladas ([#87](https://github.com/restcasatomascrevillent/admin-casatomas/pull/87))
- Facturas: «Comparar facturas» en los avisos de precio que sube o baja ([#86](https://github.com/restcasatomascrevillent/admin-casatomas/pull/86))
- Facturas: gráficas de precio sin ejes vacíos y selector de unidad ([#88](https://github.com/restcasatomascrevillent/admin-casatomas/pull/88))

### Cambiado
- Instagram: en Crear, los vinos de la carta salen en su filtro y con su miniatura ([04f2fb8](https://github.com/restcasatomascrevillent/admin-casatomas/commit/04f2fb880c3a32bd028215616751087283563e5b))
- Reservas: libro — el calendario cambia de fecha y renglón más alto ([#85](https://github.com/restcasatomascrevillent/admin-casatomas/pull/85))

## [1.14.0] - 2026-11-10

Objetivo: Reservas: bloqueo de servicio, menú del día, reservas del mismo día, campana y avisos, Hoy mejorado (sentar al tocar mesa, colores, personas, tamaños), estrella importante, registro de origen y jueves de tapas

### Añadido
- Reservas: bloquear servicio a la web, hoy a mediodía solo por teléfono y menú del día ([ddab644](https://github.com/restcasatomascrevillent/admin-casatomas/commit/ddab644c967735ad320be815ad52c731dfefe081))
- Reservas: teléfono opcional, bloqueo de comida/cena online desde Hoy y menú del día ([0b6c72b](https://github.com/restcasatomascrevillent/admin-casatomas/commit/0b6c72bdddf813922a518bcd3efd00ce2a900cfa))
- Reservas: la campana muestra las reservas y solicitudes por gestionar ([355f9b2](https://github.com/restcasatomascrevillent/admin-casatomas/commit/355f9b23317d590f9671f368011cb1126354d559))
- Reservas-web: se puede reservar para hoy desde la web ([af8693d](https://github.com/restcasatomascrevillent/admin-casatomas/commit/af8693d7258dbc8fa1ba18d947b3cd5d83aa8160))
- Reservas: en turno, tocar una mesa libre o prevista es para sentar ([d759c1a](https://github.com/restcasatomascrevillent/admin-casatomas/commit/d759c1a252c4869ee749c44ee4e571b8556362fe))
- Reservas: cambiar el número de personas desde Hoy con un toque ([d9f05d2](https://github.com/restcasatomascrevillent/admin-casatomas/commit/d9f05d2b93c062702630a1b7a40978b2802ab7f1))
- Reservas: Hoy en escritorio con lista mas grande y mesas mas pequenas ([5735a8a](https://github.com/restcasatomascrevillent/admin-casatomas/commit/5735a8aa02bdd2dfbb5f8085c4e569faf39ccb6c))
- Reservas: avisos en vivo más visibles y canal «En local» para sin reserva ([df57b1f](https://github.com/restcasatomascrevillent/admin-casatomas/commit/df57b1fc74d4fa8815827820037c45846af5a598))
- Reservas: lista de reservas del día en Nueva reserva en lugar de la disponibilidad ([5b52066](https://github.com/restcasatomascrevillent/admin-casatomas/commit/5b5206686f31b8a4e60b4bb7ef4d67f45e48c6d3))
- Reservas: «Cómo se hizo la reserva» — columna origen, reservas-web y ficha ([ae0ab0b](https://github.com/restcasatomascrevillent/admin-casatomas/commit/ae0ab0bf70ae1db1ee2733bd75266fe842431b7f))
- Reservas: marcar como importante (reserva del jefe) en Nueva reserva ([f91910c](https://github.com/restcasatomascrevillent/admin-casatomas/commit/f91910cb4891949681ef9cc7b36eb815b99b6ced))

### Cambiado
- Movil: decidir teléfono también por pantalla y puntero táctil ([90344ac](https://github.com/restcasatomascrevillent/admin-casatomas/commit/90344ac0438cfd6f4ecb81bc03127300d97e54b1))
- Rama fix/calendario-jueves ([#69](https://github.com/restcasatomascrevillent/admin-casatomas/pull/69))
- Reservas: mismos colores de mesa en móvil y escritorio ([4e593ef](https://github.com/restcasatomascrevillent/admin-casatomas/commit/4e593efbc641452bbe67f57afdd8e17e074d5bfc))
- Reservas: una mesa liberada se puede volver a dar enseguida ([322d7df](https://github.com/restcasatomascrevillent/admin-casatomas/commit/322d7dfb2c6684167ee37cd1adcbd04fcac6fe57))

### Otros
- Reservas: el teléfono vacío ya vale al editar ([843954b](https://github.com/restcasatomascrevillent/admin-casatomas/commit/843954bf0a4e4f77d3ca83d31babbd094c64fd0d))

## [1.13.0] - 2026-11-10

Objetivo: Instagram: plantillas por papel (portada, plato, cierre, frase) que no parecen de IA

### Añadido
- Instagram: plantillas v2 por papel (portada, plato, cierre, frase) ([49f19cc](https://github.com/restcasatomascrevillent/admin-casatomas/commit/49f19cc20e805700ca1aa2b6fb6d30c484596d41))

### Otros
- Instagram: plantillas v2 por papel y papeles en montar_pieza ([26dec24](https://github.com/restcasatomascrevillent/admin-casatomas/commit/26dec24cf11088a1ad2fbf1f844029c0cc5f9a37))

## [1.12.0] - 2026-11-10

Objetivo: Carta impresa: un plato por línea, cada sección en sus páginas y alineación a elegir

### Añadido
- Carta impresa: un plato por línea, secciones en varias páginas y alineación a elegir ([#58](https://github.com/restcasatomascrevillent/admin-casatomas/pull/58))

## [1.11.0] - 2026-11-10

Objetivo: Panel sin el aviso flotante «Instalar app» en el móvil

### Añadido
- Panel: quita el aviso flotante «Instalar app» del móvil ([#57](https://github.com/restcasatomascrevillent/admin-casatomas/pull/57))

## [1.10.0] - 2026-11-10

Objetivo: El interruptor de la tienda en la web pasa a Panel › Tienda

### Añadido
- Tienda: el interruptor de la tienda en la web va en Panel › Tienda ([#59](https://github.com/restcasatomascrevillent/admin-casatomas/pull/59))

## [1.9.0] - 2026-11-10

Objetivo: Gestor Web › Tienda con su interruptor y menú del panel sin «Instalar app»

### Añadido
- Panel: quita el botón «Instalar app» del menú lateral ([#54](https://github.com/restcasatomascrevillent/admin-casatomas/pull/54))
- Gestor-web: pestaña «Tienda» con el interruptor de la tienda en la web ([#55](https://github.com/restcasatomascrevillent/admin-casatomas/pull/55))

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
