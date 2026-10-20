// Fixture de la factura mensual ML/101511 de LUGA SABORES S.L. (factura 54).
// Generado a partir de la verdad de campo transcrita a mano (ground-truth/31.json,
// scratchpad 952d3c36): 54 filas, suma 3.787,53; filas 0-35 en la página 1 y
// 36-53 en la 2. El albarán V/ 781.316 empieza al final de la p1 (2 filas) y
// sigue en la p2 (8 filas) SIN repetir su cabecera. Formato numérico anglosajón.
// IVA por fila (columna «IVA»): 4 % en PICOS Sin Gluten y ROSQUILLA (filas 0,
// 14, 35, 43, 45), 10 % en el resto; el pie de totales no sale en la captura.
// Solo datos: lo usa consolidacion.test.ts para simular páginas y franjas.

export interface FilaLuga {
  nombre: string;
  cantidad: number;
  peso_kg: number | null;
  precio_unitario: number;
  total: number;
  /** Tipo de IVA impreso en la columna «IVA» de la fila (4 o 10). */
  iva_pct: number;
  albaran_ref: string;
}

export const LUGA_FILAS: FilaLuga[] = [
  {nombre: "PICOS Sin Gluten (C/ 25 U)(individual 20g) Obando", cantidad: 2, peso_kg: null, precio_unitario: 9.03, total: 18.07, iva_pct: 4, albaran_ref: "V/ 774.077"},
  {nombre: "ESPINAS PESCADO SALMONETE (B/ 2K) -Maritimus-", cantidad: 1, peso_kg: 2.0, precio_unitario: 4.2, total: 8.4, iva_pct: 10, albaran_ref: "V/ 774.077"},
  {nombre: "NATOP (20%nata animal de 35mg) 2 L -Debic-", cantidad: 12, peso_kg: 24.0, precio_unitario: 4.14, total: 99.46, iva_pct: 10, albaran_ref: "V/ 774.077"},
  {nombre: "ROUX CLARO (BOTE 1K) -Knorr-", cantidad: 1, peso_kg: null, precio_unitario: 12.31, total: 12.31, iva_pct: 10, albaran_ref: "V/ 774.077"},
  {nombre: "LAMINAS (C/ 72 rac.)HOJALDRE invertido CARAMELIZADO", cantidad: 3, peso_kg: 1.5, precio_unitario: 17.84, total: 53.53, iva_pct: 10, albaran_ref: "V/ 774.077"},
  {nombre: "RUSTICO POMODORO y OLIVA 10g (C / 3kg)-Laduc-", cantidad: 1, peso_kg: 3.0, precio_unitario: 16.4, total: 49.2, iva_pct: 10, albaran_ref: "V/ 774.077"},
  {nombre: "ss.MIX FLORES SECAS (50g) -SOSA-", cantidad: 1, peso_kg: null, precio_unitario: 9.48, total: 9.48, iva_pct: 10, albaran_ref: "V/ 774.077"},
  {nombre: "FR.COSTILLA CONFITADA en su jugo (350/450) -Buenapinta-", cantidad: 24, peso_kg: 12.8, precio_unitario: 8.9, total: 113.88, iva_pct: 10, albaran_ref: "V/ 774.077"},
  {nombre: "MAYONESA ORIGINAL (CUBO 5L) -Hellmanns-", cantidad: 3, peso_kg: null, precio_unitario: 17.25, total: 51.75, iva_pct: 10, albaran_ref: "V/ 774.077"},
  {nombre: "ESPINAS PESCADO SALMONETE (B/ 2K) -Maritimus-", cantidad: 1, peso_kg: 2.0, precio_unitario: 4.2, total: 8.4, iva_pct: 10, albaran_ref: "V/ 775.630"},
  {nombre: "TARTA CARAMELO SALADO / QUESO MANCHEGO (1,5 K ) Candida", cantidad: 2, peso_kg: null, precio_unitario: 21.8, total: 43.6, iva_pct: 10, albaran_ref: "V/ 775.630"},
  {nombre: "PERDIZ (DESHUESADA) ESCABECHE (Tarro/400g)-Candida", cantidad: 2, peso_kg: null, precio_unitario: 13.88, total: 27.76, iva_pct: 10, albaran_ref: "V/ 775.630"},
  {nombre: "NATOP (20%nata animal de 35mg) 2 L -Debic-", cantidad: 12, peso_kg: 24.0, precio_unitario: 4.14, total: 99.46, iva_pct: 10, albaran_ref: "V/ 775.630"},
  {nombre: "LAMINAS (C/ 72 rac.)HOJALDRE invertido CARAMELIZADO", cantidad: 4, peso_kg: 2.0, precio_unitario: 17.84, total: 71.38, iva_pct: 10, albaran_ref: "V/ 775.630"},
  {nombre: "ROSQUILLA NATURAL (C/ 2 K) Individuales", cantidad: 1, peso_kg: null, precio_unitario: 13.15, total: 13.15, iva_pct: 4, albaran_ref: "V/ 775.630"},
  {nombre: "ss.MIX FLORES SECAS (50g) -SOSA-", cantidad: 1, peso_kg: null, precio_unitario: 9.48, total: 9.48, iva_pct: 10, albaran_ref: "V/ 775.630"},
  {nombre: "GAMBON REBOZADO XXL (C/2K- 45U aprox) -Gegarri-", cantidad: 1, peso_kg: 2.0, precio_unitario: 19.9, total: 39.8, iva_pct: 10, albaran_ref: "V/ 775.630"},
  {nombre: "CG.(INDUSTRIAL)PUNTAS y recorte KRISSIA (B/ 5 K)", cantidad: 3, peso_kg: 15.0, precio_unitario: 5.8, total: 87.0, iva_pct: 10, albaran_ref: "V/ 775.630"},
  {nombre: "MAYONESA ORIGINAL (CUBO 5L) -Hellmanns-", cantidad: 3, peso_kg: null, precio_unitario: 17.25, total: 51.75, iva_pct: 10, albaran_ref: "V/ 775.630"},
  {nombre: "MERMELADA-CHUTNEY- MANZANA (T/260g)CAN BECH", cantidad: 1, peso_kg: null, precio_unitario: 3.49, total: 3.49, iva_pct: 10, albaran_ref: "V/ 775.630"},
  {nombre: "CRUJIENTE DE WASABI ( C/ 48 U) Didess", cantidad: 1, peso_kg: null, precio_unitario: 24.9, total: 24.9, iva_pct: 10, albaran_ref: "V/ 775.630"},
  {nombre: "MOSTAZA DE CERVEZA 150g -ROOFTOP-", cantidad: 2, peso_kg: null, precio_unitario: 4.48, total: 8.97, iva_pct: 10, albaran_ref: "V/ 778.342"},
  {nombre: "CRUJIENTE DE WASABI ( C/ 48 U) Didess", cantidad: 3, peso_kg: null, precio_unitario: 24.9, total: 74.71, iva_pct: 10, albaran_ref: "V/ 778.342"},
  {nombre: "ESPINAS PESCADO SALMONETE (B/ 2K) -Maritimus-", cantidad: 1, peso_kg: 2.0, precio_unitario: 4.2, total: 8.4, iva_pct: 10, albaran_ref: "V/ 778.342"},
  {nombre: "PERDIZ (DESHUESADA) ESCABECHE (Tarro/400g)-Candida", cantidad: 4, peso_kg: null, precio_unitario: 13.88, total: 55.52, iva_pct: 10, albaran_ref: "V/ 778.342"},
  {nombre: "NATOP (20%nata animal de 35mg) 2 L -Debic-", cantidad: 12, peso_kg: 24.0, precio_unitario: 4.14, total: 99.46, iva_pct: 10, albaran_ref: "V/ 778.342"},
  {nombre: "MAIZENA EXPRESS CLARA (BOTE 1K)", cantidad: 1, peso_kg: null, precio_unitario: 12.31, total: 12.31, iva_pct: 10, albaran_ref: "V/ 778.342"},
  {nombre: "MAIZENA EXPRESS OSCURA (BOTE 1K)", cantidad: 2, peso_kg: null, precio_unitario: 13.19, total: 26.37, iva_pct: 10, albaran_ref: "V/ 778.342"},
  {nombre: "LAMINAS (C/ 72 rac.)HOJALDRE invertido CARAMELIZADO", cantidad: 5, peso_kg: 2.5, precio_unitario: 17.84, total: 89.22, iva_pct: 10, albaran_ref: "V/ 778.342"},
  {nombre: "RUSTICO POMODORO y OLIVA 10g (C / 3kg)-Laduc-", cantidad: 1, peso_kg: 3.0, precio_unitario: 16.4, total: 49.2, iva_pct: 10, albaran_ref: "V/ 778.342"},
  {nombre: "MERMELADA-CHUTNEY- MANZANA (T/260g)CAN BECH", cantidad: 8, peso_kg: null, precio_unitario: 3.49, total: 27.9, iva_pct: 10, albaran_ref: "V/ 778.342"},
  {nombre: "PANCETA IBERICA BELLOTA (Pzas. 3 K aprox)-S.M-", cantidad: 1, peso_kg: 3.34, precio_unitario: 7.53, total: 25.13, iva_pct: 10, albaran_ref: "V/ 778.342"},
  {nombre: "SALSA POMODORO (BOTE 875g) -Knorr-", cantidad: 1, peso_kg: null, precio_unitario: 17.51, total: 17.51, iva_pct: 10, albaran_ref: "V/ 778.342"},
  {nombre: "MAYONESA ORIGINAL (CUBO 5L) -Hellmanns-", cantidad: 2, peso_kg: null, precio_unitario: 17.25, total: 34.5, iva_pct: 10, albaran_ref: "V/ 778.342"},
  {nombre: "MOSTAZA DE CERVEZA 150g -ROOFTOP-", cantidad: 2, peso_kg: null, precio_unitario: 4.48, total: 8.97, iva_pct: 10, albaran_ref: "V/ 781.316"},
  {nombre: "PICOS Sin Gluten (C/ 25 U)(individual 20g) Obando", cantidad: 1, peso_kg: null, precio_unitario: 9.03, total: 9.03, iva_pct: 4, albaran_ref: "V/ 781.316"},
  {nombre: "ESPINAS PESCADO SALMONETE (B/ 2K) -Maritimus-", cantidad: 1, peso_kg: 2.0, precio_unitario: 4.2, total: 8.4, iva_pct: 10, albaran_ref: "V/ 781.316"},
  {nombre: "PERDIZ (DESHUESADA) ESCABECHE (Tarro/400g)-Candida", cantidad: 3, peso_kg: null, precio_unitario: 13.88, total: 41.64, iva_pct: 10, albaran_ref: "V/ 781.316"},
  {nombre: "NATOP (20%nata animal de 35mg) 2 L -Debic-", cantidad: 12, peso_kg: 24.0, precio_unitario: 4.14, total: 99.46, iva_pct: 10, albaran_ref: "V/ 781.316"},
  {nombre: "MAIZENA EXPRESS OSCURA (BOTE 1K)", cantidad: 2, peso_kg: null, precio_unitario: 13.19, total: 26.37, iva_pct: 10, albaran_ref: "V/ 781.316"},
  {nombre: "LAMINAS (C/ 72 rac.)HOJALDRE invertido CARAMELIZADO", cantidad: 4, peso_kg: 2.0, precio_unitario: 17.84, total: 71.38, iva_pct: 10, albaran_ref: "V/ 781.316"},
  {nombre: "CG.(INDUSTRIAL)PUNTAS y recorte KRISSIA (B/ 5 K)", cantidad: 3, peso_kg: 15.0, precio_unitario: 5.8, total: 87.0, iva_pct: 10, albaran_ref: "V/ 781.316"},
  {nombre: "MAYONESA ORIGINAL (CUBO 5L) -Hellmanns-", cantidad: 6, peso_kg: null, precio_unitario: 17.25, total: 103.5, iva_pct: 10, albaran_ref: "V/ 781.316"},
  {nombre: "ROSQUILLA NATURAL (C/ 2 K) Individuales", cantidad: 1, peso_kg: null, precio_unitario: 13.15, total: 13.15, iva_pct: 4, albaran_ref: "V/ 781.316"},
  {nombre: "JAMON (CEBO CAMPO) IBERICO  -Lisardo Castro", cantidad: 8, peso_kg: 75.48, precio_unitario: 20.5, total: 1547.26, iva_pct: 10, albaran_ref: "V/ 781.528"},
  {nombre: "PICOS Sin Gluten (C/ 25 U)(individual 20g) Obando", cantidad: 1, peso_kg: null, precio_unitario: 9.03, total: 9.03, iva_pct: 4, albaran_ref: "V/ 783.241"},
  {nombre: "ESPINAS PESCADO SALMONETE (B/ 2K) -Maritimus-", cantidad: 1, peso_kg: 2.0, precio_unitario: 4.2, total: 8.4, iva_pct: 10, albaran_ref: "V/ 783.241"},
  {nombre: "NATOP (20%nata animal de 35mg) 2 L -Debic-", cantidad: 12, peso_kg: 24.0, precio_unitario: 4.14, total: 99.46, iva_pct: 10, albaran_ref: "V/ 783.241"},
  {nombre: "MAIZENA EXPRESS OSCURA (BOTE 1K)", cantidad: 1, peso_kg: null, precio_unitario: 13.19, total: 13.19, iva_pct: 10, albaran_ref: "V/ 783.241"},
  {nombre: "MAIZENA EXPRESS CLARA (BOTE 1K)", cantidad: 1, peso_kg: null, precio_unitario: 12.31, total: 12.31, iva_pct: 10, albaran_ref: "V/ 783.241"},
  {nombre: "LAMINAS (C/ 72 rac.)HOJALDRE invertido CARAMELIZADO", cantidad: 4, peso_kg: 2.0, precio_unitario: 17.84, total: 71.38, iva_pct: 10, albaran_ref: "V/ 783.241"},
  {nombre: "RUSTICO POMODORO y OLIVA 10g (C / 3kg)-Laduc-", cantidad: 1, peso_kg: 3.0, precio_unitario: 16.4, total: 49.2, iva_pct: 10, albaran_ref: "V/ 783.241"},
  {nombre: "MERMELADA-CHUTNEY- MANZANA (T/260g)CAN BECH", cantidad: 4, peso_kg: null, precio_unitario: 3.49, total: 13.95, iva_pct: 10, albaran_ref: "V/ 783.241"},
  {nombre: "MAYONESA ORIGINAL (CUBO 5L) -Hellmanns-", cantidad: 4, peso_kg: null, precio_unitario: 17.25, total: 69.0, iva_pct: 10, albaran_ref: "V/ 783.241"},
];

export const LUGA_SUMA = 3787.53;
/** IVA con el tipo de cada fila, una cuota por tipo redondeada a céntimos:
 *  10 % de 3.725,10 = 372,51 + 4 % de 62,43 = 2,50 (2,4972) → 375,01. Sin
 *  recargo de equivalencia. Total = 3.787,53 + 375,01 = 4.162,54. */
export const LUGA_IVA = 375.01;
export const LUGA_TOTAL = 4162.54;
export const LUGA_FILAS_P1 = 36;
