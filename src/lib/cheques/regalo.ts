import { fechaCaducidad } from "./caducidad";

export interface PlantillaRegalo {
  caducidad_meses: number;
  email_asunto: string;
  email_mensaje: string;
  pdf_titulo: string;
  pdf_subtitulo: string;
  pdf_instrucciones: string;
  pdf_pie: string;
  logo_data: string;
  color_acento: string;
  color_fondo: string;
}

export const PLANTILLA_REGALO: PlantillaRegalo = {
  caducidad_meses: 12,
  email_asunto: "Tu cheque regalo de Casa Tomás",
  email_mensaje: "Hola {comprador},\n\nGracias por regalar un momento en Casa Tomás. Tu cheque {codigo} ya está listo.\nAdjuntamos el PDF para imprimirlo o compartirlo.",
  pdf_titulo: "Cheque regalo",
  pdf_subtitulo: "Un momento para disfrutar de Casa Tomás",
  pdf_instrucciones: "Presenta este cheque, impreso o en el móvil, al pagar en Casa Tomás. El código solo puede canjearse una vez.",
  pdf_pie: "C/ Santa María de la Cabeza, 2 · Crevillent, Alicante\n966 10 78 87 · restaurantecasatomascrevillente.es",
  logo_data: "",
  color_acento: "#795440",
  color_fondo: "#faf7f1",
};

export interface ChequeRegalo {
  id: string;
  codigo: string;
  caduca_el?: string | null;
  emitido_en?: string | null;
  importe_eur: number;
  comprador_nombre: string;
  comprador_email: string;
  comprador_telefono?: string | null;
  destinatario_nombre: string | null;
  mensaje: string | null;
  fecha_entrega_deseada: string | null;
  creado_en?: string | null;
  created_at?: string | null;
  ocultar_importe?: boolean;
  solicita_factura?: boolean;
  plantilla_cheque?: Partial<PlantillaRegalo> | null;
}

export const CHEQUE_EJEMPLO: ChequeRegalo = {
  id: "ejemplo", codigo: "CT-EJEMPLO", importe_eur: 100,
  caduca_el: "2027-10-08",
  comprador_nombre: "Ana García", comprador_email: "ana@example.com",
  destinatario_nombre: "María", mensaje: "Para que disfrutes de un momento especial. ¡Feliz cumpleaños!",
  fecha_entrega_deseada: null,
};

/** Un único reemplazo: los tokens escritos por un comprador no se evalúan de nuevo. */
export function textoRegalo(texto: string, cheque: ChequeRegalo, ocultarImporte = false): string {
  const valores: Record<string, string> = {
    comprador: cheque.comprador_nombre, destinatario: cheque.destinatario_nombre || "",
    codigo: cheque.codigo,
    caducidad: fechaCaducidad(cheque.caduca_el),
    importe: ocultarImporte ? "" : Number(cheque.importe_eur).toFixed(2).replace(".", ",") + " €",
  };
  return texto.replace(/\{(comprador|destinatario|codigo|importe|caducidad)\}/g, (_, key: string) => valores[key]);
}

export function errorCheques(error: unknown): string {
  const e = error as { code?: string; message?: string };
  if (["PGRST202", "PGRST205", "42P01", "42883"].includes(e?.code || "")) {
    return "Falta instalar la actualización de Cheques en Supabase. Aplica las migraciones de Cheques, incluida la actualización de factura en compra manual.";
  }
  return e?.message || "No se pudo completar la operación. Vuelve a intentarlo.";
}
