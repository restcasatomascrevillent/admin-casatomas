/**
 * La plantilla «Reserva modificada» en el editor de plantillas del panel:
 * aparece como una pestaña más (con su descripción de cuándo sale), y la vista
 * previa enseña lo mismo que recibirá el cliente — el bloque automático
 * «Cambios en tu reserva» (antes/ahora), la frase según el estado y los
 * botones del enlace nuevo — porque es el MISMO render que la Edge Function.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { email: "dueno@ejemplo.com" } }) }));
vi.mock("@/hooks/useUserRole", () => ({ useCanAccessSection: () => ({ canAccess: true, loading: false }) }));
// Cada pestaña monta su editor (con consultas a la BD): aquí basta saber qué pestañas hay.
vi.mock("../PlantillaTipoEditor", () => ({ PlantillaTipoEditor: ({ tipo }: { tipo: string }) => <div>editor {tipo}</div> }));

import { EditorPlantillasEmail } from "../EditorPlantillasEmail";
import { VistaPreviaEmail } from "../VistaPreviaEmail";
import { renderPlantilla as renderPanel, type FilaPlantilla } from "../motorPlantilla";
import { renderPlantilla as renderFuncion, TIPOS_PLANTILLA as TIPOS_FUNCION } from "../../../../supabase/functions/emails-reserva/plantillas";
import { datosEjemploPara, DESCRIPCION_TIPO, ETIQUETA_TIPO } from "../catalogoTokens";
import { TIPOS_PLANTILLA, type CamposEditablesPlantilla } from "@/hooks/usePlantillasEmail";

/** La plantilla por defecto de la migración 20260930211000 (copia literal). */
const CAMPOS_POR_DEFECTO: CamposEditablesPlantilla = {
  asunto: "Hemos modificado tu reserva - {{negocio}}",
  saludo: "Hola, {{nombre}}",
  cuerpo:
    "Te escribimos porque hemos modificado tu reserva en {{negocio}}. Aquí tienes lo que ha cambiado y cómo queda.\n\nSi los nuevos datos no te vienen bien o tienes cualquier duda, llámanos y buscamos una solución.",
  texto_boton_principal: "Sí, confirmo mi asistencia",
  texto_boton_secundario: "No puedo, cancelar reserva",
  pie: "Si necesitas cambiar algo más o cancelarla, llámanos con antelación.",
  color_acento: "#B8936A",
  color_oscuro: "#1C1F22",
  logo_url: null,
  bloques: { mostrar_tabla_detalles: true, mostrar_boton_secundario: true, mostrar_pie_contacto: true },
};
const FILA: FilaPlantilla = { tipo: "reserva_modificada", version: 1, ...CAMPOS_POR_DEFECTO };

describe("«Reserva modificada» en el editor de plantillas", () => {
  it("el panel conoce exactamente los mismos tipos que la Edge Function (6, el último el nuevo)", () => {
    expect([...TIPOS_PLANTILLA]).toEqual([...TIPOS_FUNCION]);
    expect(TIPOS_PLANTILLA).toHaveLength(6);
    expect(TIPOS_PLANTILLA.at(-1)).toBe("reserva_modificada");
  });

  it("todos los tipos tienen etiqueta y descripción (la pestaña no sale en blanco)", () => {
    for (const tipo of TIPOS_PLANTILLA) {
      expect(ETIQUETA_TIPO[tipo], tipo).toBeTruthy();
      expect(DESCRIPCION_TIPO[tipo], tipo).toBeTruthy();
    }
    expect(ETIQUETA_TIPO.reserva_modificada).toBe("Reserva modificada");
    expect(DESCRIPCION_TIPO.reserva_modificada).toMatch(/Avisar al cliente del cambio/);
  });

  it("sale como una pestaña más del editor", () => {
    render(<EditorPlantillasEmail />);
    expect(screen.getByRole("tab", { name: "Reserva modificada" })).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(6);
  });
});

describe("vista previa de «Reserva modificada»", () => {
  it("los datos de ejemplo traen un cambio de verdad y ninguna contraoferta", () => {
    const datos = datosEjemploPara("reserva_modificada");
    expect(datos.modificacion).toBeTruthy();
    expect(datos.horaSolicitada ?? null).toBeNull();
  });

  it("enseña el bloque de cambios, la frase de confirmar y los dos botones; nada de «Pediste»", () => {
    const { html, asunto } = renderPanel(FILA, datosEjemploPara("reserva_modificada"));
    expect(asunto).toBe("Hemos modificado tu reserva - Casa Tomás");
    expect(html).toContain("Reserva modificada");
    expect(html).toContain("Cambios en tu reserva");
    expect(html).toContain("Hora:</strong> antes");
    expect(html).toMatch(/pendiente de tu confirmación/);
    expect(html).toContain("Sí, confirmo mi asistencia");
    expect(html).toContain("No puedo, cancelar reserva");
    expect(html).not.toContain("Pediste:");
  });

  it("es el mismo HTML que mandaría la Edge Function (espejo)", () => {
    const datos = datosEjemploPara("reserva_modificada");
    expect(renderPanel(FILA, datos)).toEqual(renderFuncion(FILA, datos));
  });

  it("el iframe de la vista previa lo pinta", () => {
    render(<VistaPreviaEmail tipo="reserva_modificada" campos={CAMPOS_POR_DEFECTO} />);
    const iframe = screen.getByTitle("Vista previa del correo — reserva_modificada");
    expect(iframe.getAttribute("srcdoc")).toContain("Cambios en tu reserva");
    expect(screen.getByText("Hemos modificado tu reserva - Casa Tomás")).toBeInTheDocument();
  });
});
