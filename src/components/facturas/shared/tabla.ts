// ---------------------------------------------------------------------------
// Medidas compartidas por las tablas de Facturas y Albaranes
// ---------------------------------------------------------------------------
// CERO scroll horizontal (2026-09-28, peticion del dueño). Mismo criterio que
// ya se aplico en `ListaReservasAvanzada` (commit a8383a4): si no cabe, se
// encoge el contenido; nunca se corta.
//
// Que estaba mal
// --------------
// Las dos tablas llevaban un `min-w` fijo en el `<table>`:
//   · facturas   `min-w-[1220px] lg:min-w-[1400px]`
//   · albaranes  `min-w-[1080px] lg:min-w-[1260px]`
// El contenedor nunca da tanto ancho, asi que aparecia scroll horizontal
// SIEMPRE y la columna Total —la ultima antes de Acciones— quedaba cortada a
// media cifra. En la captura del dueño se leia "58", "113" y "43" donde los
// valores reales eran 585,33 €, 1.130,47 € y 436,92 €. Un total truncado no es
// un fallo estetico: es una cifra FALSA, y 58 € frente a 585 € se cuela en una
// lectura rapida.
//
// Ancho util real (medido en el navegador, no calculado)
// -----------------------------------------------------
// La pagina de Facturas anida mas cajas que la de Reservas, asi que el ancho
// util es MENOR a igualdad de ventana:
//   ventana
//     − 256 px de menu lateral (SIDEBAR_WIDTH = 16rem)
//     − 48 px del relleno del `main` (`p-3 sm:p-6`)
//     − 2 px del borde de la tarjeta exterior
//     − 48 px del relleno interior (`p-2 sm:p-4 md:p-6`)
//     − 2 px del borde del contenedor de la tabla
//     − ~15 px de la barra de desplazamiento vertical del listado
//   = ~653 px a 1024 · ~909 px a 1280 · ~1085 px a 1456
//
// Por que el corte a tarjetas esta en 1024 px (`lg`) y no en 768
// --------------------------------------------------------------
// Hasta ahora el cambio a tarjetas lo decidia `useIsMobile()`, que corta en
// 768 px. Pero el menu lateral aparece precisamente a 768 px y se lleva 16rem:
// entre 768 y 1023 px a la tabla le quedan ~397 px utiles. Ocho columnas no
// caben ahi de ninguna manera, asi que en esa franja se dibujaba una tabla
// imposible. El corte pasa a `lg` (1024 px), que es donde hay ~653 px y todo
// entra. Se hace con clases CSS (`lg:hidden` / `hidden lg:flex`) y no con el
// hook de JS para que no dependa de un segundo origen de verdad.
//
// Las tres bandas
// ---------------
//   · < 1024 px          tarjetas apiladas, sin tabla.
//   · 1024–1279 px (lg)  tabla apretada: relleno px-2, acciones solo con
//                        iconos, fecha de dos cifras de año, insignias a 10 px.
//   · >= 1280 px (xl)    tabla comoda: relleno px-3, "Asistente IA" con texto,
//                        año de cuatro cifras, proveedor con mas sitio.

/** Relleno de celda. Apretado en `lg`, comodo a partir de `xl`. */
export const CELDA = "px-1.5 py-2 align-middle xl:px-3";

/** Alto fijo de fila: ninguna celda puede pasar de dos lineas. */
export const ALTO_FILA = "h-14";

/**
 * Insignias de la tabla. El primitivo `Badge` NO lleva `whitespace-nowrap` y
 * lo comparte toda la app, asi que no se toca ahi: sin esto "Sin revisar"
 * rompe en dos lineas y descuadra el alto de la fila.
 */
export const INSIGNIA =
  "inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0 text-[10px] font-medium leading-none xl:text-[11px]";

// ---------------------------------------------------------------------------
// Anchos de columna
// ---------------------------------------------------------------------------
// Los anchos de una tabla con reparto automatico son una SUGERENCIA: lo que
// manda de verdad es el ancho MINIMO del contenido de cada celda. Por eso,
// ademas de estrecharlos aqui, el contenido se abrevia en la franja `lg`.
//
// OJO con `truncate` (lo aprendimos en ListaReservasAvanzada): `truncate` es
// `white-space: nowrap`, y en un reparto automatico eso hace que la columna
// RECLAME el ancho del texto mas largo de la pagina. `min-width: 0` por dentro
// NO lo corta; hace falta un `max-width` en la CELDA. De ahi los `max-w` de
// Proveedor y Observaciones: sin ellos "MR FRIOSAT DISTRIBUCIONES
// ALIMENTARIAS S.L." reclama ~330 px el solo y tumba el reparto entero.
export const ANCHO_CHEVRON = "w-[24px] xl:w-[32px]";
// El numero de documento NO lleva `w-` a secas sino un `max-w`: va con
// `whitespace-nowrap` (es el identificador, no puede partirse) y sin tope
// bastaria un numero de proveedor largo para recuperar el desbordamiento.
// Medido, la holgura a 1024 px es de 27 px, o sea unos 4 caracteres mas que
// "ALB-2026-00231". Con el tope, un numero kilometrico se recorta con el
// completo en el `title` — feo, pero nunca vuelve el scroll ni un total
// cortado. Los cinco documentos reales entran de sobra sin recortarse.
export const ANCHO_NUMERO = "min-w-[80px] max-w-[112px] xl:max-w-[148px]";
export const ANCHO_PROVEEDOR = "min-w-[88px] max-w-[112px] xl:max-w-[200px] min-[1400px]:max-w-[300px]";
export const ANCHO_ESTADO = "w-[100px] xl:w-[124px]";
export const ANCHO_FECHA = "w-[54px] xl:w-[92px]";
export const ANCHO_IMPORTE = "w-[78px] xl:w-[104px]";
export const ANCHO_TOTAL = "w-[84px] xl:w-[112px]";
export const ANCHO_OBSERVACIONES = "min-w-[80px] max-w-[104px] xl:max-w-[190px]";
export const ANCHO_ITEMS = "w-[40px] xl:w-[56px]";
export const ANCHO_FECHA_LARGA = "w-[96px] xl:w-[124px]";
/** Acciones: Escaneo + Editar + IA. Solo iconos en `lg`, con texto en `xl`. */
export const ANCHO_ACCIONES = "w-[92px] xl:w-[132px] 2xl:w-[176px]";

// ---------------------------------------------------------------------------
// Presupuesto del selector "Columnas"
// ---------------------------------------------------------------------------
// El boton "Columnas" ofrecia DOCE columnas conmutables sin ningun tope. Con
// todas encendidas no caben ni de lejos, o sea que era la otra mitad del
// problema: aunque se arregle el `min-w`, el usuario podia volver a provocar
// el recorte con dos clics.
//
// Ahora hay un presupuesto en pixeles. Cada columna opcional declara lo que
// pide como minimo en la franja estrecha; el chevron y las acciones no son
// opcionales y se descuentan de entrada:
//   ancho util a 1024 px (medido) 668
//     − 24 px del chevron
//     − 90 px de las acciones
//     − 8 px de colchon
//   = 546 px repartibles
//
// Los PESOS de abajo NO son estimaciones: son el ancho minimo real de cada
// columna medido en el navegador a 1024 px con los cinco documentos de
// produccion (el peor caso manda: "ALB-2026-00231", "Precio extremo" y
// "120.580,00 €" son mas anchos que sus equivalentes en facturas). El juego
// por defecto suma 542 de 546, o sea que a 1024 px no se puede añadir una
// columna sin quitar otra. Eso es lo que se quiere: medido, la tabla entera
// pide 642 px de los 668 utiles (albaranes, que es el caso peor), y la mas
// estrecha de las columnas apagadas son 88 px — no cabe ninguna.
//
// Si se toca cualquier ANCHO_* de arriba, hay que volver a MEDIR esto. La
// forma: poner `width: max-content` al <table> y leer `offsetWidth` de cada
// <th>; eso da el minimo real, que es lo unico que manda en una tabla de
// reparto automatico.
export const PRESUPUESTO_LG = 546;

/** Lo que pide cada columna opcional en la franja estrecha (`lg`). */
export const PESOS: Record<string, number> = {
  numero: 112,
  proveedor: 112,
  estado: 112,
  fecha: 62,
  subtotal: 88,
  iva: 88,
  total: 96,
  observaciones: 116,
  items: 48,
  procesado_en: 100,
  creado: 100,
};

/** Suma de lo que piden las columnas encendidas. */
export const pesoVisible = (visibles: Record<string, boolean>): number =>
  Object.entries(visibles).reduce((suma, [key, on]) => (on ? suma + (PESOS[key] ?? 0) : suma), 0);

/**
 * Si encender `key` cabe en el presupuesto. Una columna ya encendida siempre
 * se puede apagar, asi que solo se comprueba al encender.
 */
export const cabeColumna = (visibles: Record<string, boolean>, key: string): boolean =>
  visibles[key] === true || pesoVisible(visibles) + (PESOS[key] ?? 0) <= PRESUPUESTO_LG;
