// ============================================================================
// MOTOR DE RENDERIZADO — copia deliberada, solo para la VISTA PREVIA del panel
// ============================================================================
// Este fichero es un ESPEJO manual de la única fuente de verdad del esqueleto
// de correo: `supabase/functions/emails-reserva/plantillas.ts` (léela primero
// si vas a tocar esto — su cabecera documenta el contrato completo: tipos,
// tokens, bloques). NO se importa código entre los dos paquetes porque son
// runtimes distintos (Deno Edge Function vs. app Vite/browser) sin un paquete
// compartido — así que este archivo se mantiene a mano en sincronía con el
// original. `plantillas.ts` no tiene ninguna dependencia externa (funciones
// puras, sin I/O), por eso es portable tal cual al navegador.
//
// Si algún día `plantillas.ts` cambia el esqueleto HTML, los tokens o los
// bloques, este fichero debe actualizarse a la vez o la vista previa del
// panel dejará de coincidir con el correo real que recibe el cliente.
//
// NUNCA se usa esto para enviar nada — solo para pintar el <iframe> de vista
// previa mientras el usuario edita. El envío real (y el de prueba, cuando
// exista) siempre pasa por el backend, que usa el `plantillas.ts` original.
// ============================================================================

export type TipoPlantilla =
  | "solicitud_recibida"
  | "propuesta"
  | "confirmada"
  | "rechazada"
  | "recordatorio";

export interface FilaPlantilla {
  tipo: TipoPlantilla;
  version: number;
  asunto: string;
  saludo: string;
  cuerpo: string;
  texto_boton_principal: string | null;
  texto_boton_secundario: string | null;
  pie: string | null;
  color_acento: string;
  color_oscuro: string;
  logo_url: string | null;
  bloques: Record<string, unknown> | null;
}

export interface DatosReservaParaCorreo {
  nombre: string;
  /** ISO "YYYY-MM-DD" */
  fecha: string;
  /** "HH:MM" o "HH:MM:SS" — hora VIGENTE (la ofrecida, si hubo contraoferta) */
  hora: string;
  comensales: number;
  /** Nombre del espacio VIGENTE ya resuelto (no el uuid), o null si no hay asignado */
  espacio: string | null;
  /** Hora tal y como se pidió originalmente. Si es igual a `hora`, no hay contraoferta de hora. */
  horaSolicitada?: string | null;
  /** Nombre del espacio tal y como se pidió originalmente, ya resuelto. */
  espacioSolicitado?: string | null;
  botonPrincipalUrl?: string | null;
  botonSecundarioUrl?: string | null;
}

interface FilaTabla {
  etiqueta: string;
  valor: string;
}

interface Boton {
  texto: string;
  url: string;
  estilo: "primario" | "secundario";
}

export interface ResultadoRenderizado {
  asunto: string;
  html: string;
}

// ----------------------------------------------------------------------------
// Utilidades puras (idénticas a plantillas.ts)
// ----------------------------------------------------------------------------

export function escapeHtml(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** "2026-03-16" -> "16 de marzo de 2026". Sin Intl a propósito: determinista. */
export function formatearFecha(fechaIso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(fechaIso || "");
  if (!m) return fechaIso || "";
  const [, anio, mes, dia] = m;
  const idx = parseInt(mes, 10) - 1;
  const nombreMes = MESES[idx] ?? mes;
  return `${parseInt(dia, 10)} de ${nombreMes} de ${anio}`;
}

/** "21:00:00" o "21:00" -> "21:00" */
export function formatearHora(hora: string): string {
  return (hora || "").slice(0, 5);
}

function normalizarComparable(valor: string | null | undefined): string {
  return (valor ?? "").trim().toLowerCase();
}

/** Verdadero si la hora u espacio VIGENTE difieren de lo solicitado originalmente. */
export function hayContraoferta(datos: DatosReservaParaCorreo): boolean {
  if (datos.horaSolicitada === undefined || datos.horaSolicitada === null) return false;
  const horaDistinta = formatearHora(datos.hora) !== formatearHora(datos.horaSolicitada);
  const espacioDistinto =
    normalizarComparable(datos.espacio) !== normalizarComparable(datos.espacioSolicitado ?? null);
  return horaDistinta || espacioDistinto;
}

const TOKEN_RE = /\{\{\s*([a-zA-Z_]+)\s*\}\}/g;

export function construirTokens(datos: DatosReservaParaCorreo): Record<string, string> {
  return {
    nombre: datos.nombre || "",
    fecha: formatearFecha(datos.fecha),
    hora: formatearHora(datos.hora),
    comensales: `${datos.comensales} ${datos.comensales === 1 ? "persona" : "personas"}`,
    espacio: datos.espacio || "",
    hora_solicitada: formatearHora(datos.horaSolicitada || datos.hora),
    espacio_solicitado: datos.espacioSolicitado || "",
  };
}

/** Sustituye {{token}} en texto plano por valores de `tokens`, escapando ambos lados. */
export function sustituirTexto(textoPlano: string, tokens: Record<string, string>): string {
  const escapado = escapeHtml(textoPlano ?? "");
  return escapado.replace(TOKEN_RE, (_match, clave: string) => {
    const valor = tokens[clave];
    return valor !== undefined ? escapeHtml(valor) : "";
  });
}

/** Texto ya escapado+sustituido, con línea en blanco = separador de párrafo. */
function parrafosHtml(textoEscapado: string): string {
  const bloques = textoEscapado
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  if (bloques.length === 0) return "";
  return bloques
    .map((b) => `<p style="margin:0 0 20px;font-size:15px;color:#6B6560;line-height:1.7;">${b.replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

function leerBloque(bloques: Record<string, unknown> | null, clave: string, porDefecto: boolean): boolean {
  if (!bloques || !(clave in bloques)) return porDefecto;
  return bloques[clave] !== false;
}

const INSIGNIA_POR_TIPO: Record<TipoPlantilla, string> = {
  solicitud_recibida: "Solicitud recibida",
  propuesta: "Confirmación pendiente",
  confirmada: "Reserva confirmada",
  rechazada: "Solicitud no procesada",
  recordatorio: "Recordatorio de tu reserva",
};

// ----------------------------------------------------------------------------
// Esqueleto fijo — idéntico al de plantillas.ts (tabla 560px, Georgia serif,
// paleta oro/antracita, todo estilos en línea).
// ----------------------------------------------------------------------------

function filaTablaHtml(fila: FilaTabla): string {
  return `
                <tr>
                  <td style="padding:16px 20px;border-bottom:1px solid #E8E0D5;">
                    <span style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#B8936A;display:block;margin-bottom:4px;">${escapeHtml(fila.etiqueta)}</span>
                    <span style="font-size:16px;color:#1C1F22;font-weight:600;">${escapeHtml(fila.valor)}</span>
                  </td>
                </tr>`;
}

function botonHtml(boton: Boton, colorAcento: string, colorOscuro: string): string {
  const esPrimario = boton.estilo === "primario";
  const fondo = esPrimario ? colorAcento : "transparent";
  const color = esPrimario ? "#FFFFFF" : "#6B6560";
  const borde = esPrimario ? "" : `border:1px solid #E8E0D5;`;
  return `
              <a href="${escapeHtml(boton.url)}" style="display:block;text-align:center;background:${fondo};color:${color};text-decoration:none;font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;padding:18px 0;margin-bottom:12px;${borde}">
                ${escapeHtml(boton.texto)}
              </a>`;
}

interface EsqueletoParams {
  insignia: string;
  saludoHtml: string;
  cuerpoHtml: string;
  filasTabla: FilaTabla[];
  comparacion: { solicitado: FilaTabla; ofrecido: FilaTabla } | null;
  botones: Boton[];
  pieHtml: string | null;
  colorAcento: string;
  colorOscuro: string;
  logoUrl: string | null;
}

function envolverEsqueleto(p: EsqueletoParams): string {
  const marca = p.logoUrl
    ? `<img src="${escapeHtml(p.logoUrl)}" alt="Casa Tomás" style="max-height:48px;display:inline-block;">`
    : `<div style="font-family:Georgia,'Times New Roman',serif;font-size:28px;letter-spacing:4px;color:${escapeHtml(p.colorOscuro)};text-transform:uppercase;font-weight:normal;">Casa Tomás</div>`;

  const bloqueComparacion = p.comparacion
    ? `
          <tr>
            <td style="padding:0 48px 8px;">
              <div style="background:#FFF9F0;border:1px solid ${escapeHtml(p.colorAcento)};padding:16px 20px;font-size:13px;color:#6B6560;line-height:1.6;">
                <strong style="color:${escapeHtml(p.colorOscuro)};">Pediste:</strong> ${escapeHtml(p.comparacion.solicitado.valor)}<br>
                <strong style="color:${escapeHtml(p.colorOscuro)};">Te ofrecemos:</strong> ${escapeHtml(p.comparacion.ofrecido.valor)}
              </div>
            </td>
          </tr>`
    : "";

  const bloqueTabla = p.filasTabla.length
    ? `
          <tr>
            <td style="padding:0 48px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E8E0D5;border-top:2px solid ${escapeHtml(p.colorAcento)};">
                ${p.filasTabla.map(filaTablaHtml).join("\n")}
              </table>
            </td>
          </tr>`
    : "";

  const bloqueBotones = p.botones.length
    ? `
          <tr>
            <td style="padding:0 48px 16px;">
              ${p.botones.map((b) => botonHtml(b, p.colorAcento, p.colorOscuro)).join("\n")}
            </td>
          </tr>`
    : "";

  const bloquePie = p.pieHtml
    ? `
          <tr>
            <td style="padding:24px 48px;background:${escapeHtml(p.colorOscuro)};text-align:center;">
              <div style="font-size:12px;color:#C9C2B8;line-height:1.6;">${p.pieHtml}</div>
            </td>
          </tr>`
    : "";

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Casa Tomás</title>
</head>
<body style="margin:0;padding:0;background-color:#F7F3EE;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#F7F3EE;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background-color:#FFFFFF;border-top:3px solid ${escapeHtml(p.colorAcento)};">
          <tr>
            <td style="padding:40px 48px 32px;text-align:center;border-bottom:1px solid #E8E0D5;">
              ${marca}
              <div style="width:40px;height:1px;background:${escapeHtml(p.colorAcento)};margin:14px auto 10px;"></div>
              <div style="font-size:10px;letter-spacing:3px;color:${escapeHtml(p.colorAcento)};text-transform:uppercase;">Crevillente</div>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 48px 0;text-align:center;">
              <span style="display:inline-block;background:#F7F3EE;border:1px solid #E8E0D5;color:#6B6560;font-size:10px;letter-spacing:2px;text-transform:uppercase;padding:6px 16px;">${escapeHtml(p.insignia)}</span>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 48px 0;">
              <p style="margin:0 0 20px;font-size:22px;color:${escapeHtml(p.colorOscuro)};font-family:Georgia,'Times New Roman',serif;font-weight:normal;">${p.saludoHtml}</p>
              ${p.cuerpoHtml}
            </td>
          </tr>${bloqueComparacion}${bloqueTabla}${bloqueBotones}
          <tr>
            <td style="padding:0 48px 24px;">
              <p style="margin:0;font-size:12px;color:#9B948E;text-align:center;line-height:1.6;">Casa Tomás · C/ Santa María de la Cabeza, 2, Crevillente · <a href="tel:966107887" style="color:#9B948E;">966 10 78 87</a></p>
            </td>
          </tr>${bloquePie}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ----------------------------------------------------------------------------
// Render principal — misma firma que renderPlantilla() en plantillas.ts
// ----------------------------------------------------------------------------

export function renderPlantilla(
  plantilla: FilaPlantilla,
  datos: DatosReservaParaCorreo,
): ResultadoRenderizado {
  const tokens = construirTokens(datos);

  const asunto = sustituirTexto(plantilla.asunto, tokens);
  const saludoHtml = sustituirTexto(plantilla.saludo, tokens);
  const cuerpoHtml = parrafosHtml(sustituirTexto(plantilla.cuerpo, tokens));
  const pieTexto = plantilla.pie ? sustituirTexto(plantilla.pie, tokens) : null;

  const mostrarTabla = leerBloque(plantilla.bloques, "mostrar_tabla_detalles", true);
  const mostrarBotonSecundario = leerBloque(plantilla.bloques, "mostrar_boton_secundario", true);
  const mostrarPie = leerBloque(plantilla.bloques, "mostrar_pie_contacto", true);

  const filasTabla: FilaTabla[] = mostrarTabla
    ? [
        { etiqueta: "Fecha", valor: formatearFecha(datos.fecha) },
        { etiqueta: "Hora", valor: formatearHora(datos.hora) },
        { etiqueta: "Comensales", valor: `${datos.comensales}` },
        ...(datos.espacio ? [{ etiqueta: "Espacio", valor: datos.espacio }] : []),
      ]
    : [];

  const comparacion = hayContraoferta(datos)
    ? {
        solicitado: {
          etiqueta: "Solicitado",
          valor: `${formatearHora(datos.horaSolicitada || datos.hora)}${datos.espacioSolicitado ? ` en ${datos.espacioSolicitado}` : ""}`,
        },
        ofrecido: {
          etiqueta: "Ofrecido",
          valor: `${formatearHora(datos.hora)}${datos.espacio ? ` en ${datos.espacio}` : ""}`,
        },
      }
    : null;

  const botones: Boton[] = [];
  if (plantilla.texto_boton_principal && datos.botonPrincipalUrl) {
    botones.push({
      texto: sustituirTexto(plantilla.texto_boton_principal, tokens),
      url: datos.botonPrincipalUrl,
      estilo: "primario",
    });
  }
  if (mostrarBotonSecundario && plantilla.texto_boton_secundario && datos.botonSecundarioUrl) {
    botones.push({
      texto: sustituirTexto(plantilla.texto_boton_secundario, tokens),
      url: datos.botonSecundarioUrl,
      estilo: "secundario",
    });
  }

  const html = envolverEsqueleto({
    insignia: INSIGNIA_POR_TIPO[plantilla.tipo],
    saludoHtml,
    cuerpoHtml,
    filasTabla,
    comparacion,
    botones,
    pieHtml: mostrarPie ? pieTexto : null,
    colorAcento: plantilla.color_acento || "#B8936A",
    colorOscuro: plantilla.color_oscuro || "#1C1F22",
    logoUrl: plantilla.logo_url,
  });

  return { asunto, html };
}
