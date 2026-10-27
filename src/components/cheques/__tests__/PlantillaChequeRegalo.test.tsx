import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PLANTILLA_REGALO } from "@/lib/cheques/regalo";
const mock = vi.hoisted(() => ({ from: vi.fn(), update: vi.fn(), edit: true, error: null as unknown }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mock.from } }));
vi.mock("@/hooks/useUserRole", () => ({ useCanAccessSection: () => ({ canAccess: mock.edit }) }));
vi.mock("../VistaChequeRegalo", () => ({ VistaChequeRegalo: ({ cheque }: { cheque: { mensaje?: string | null; ocultar_importe?: boolean } }) => <div data-testid="vista-pdf" data-importe={cheque.ocultar_importe ? "oculto" : "visible"}>{cheque.mensaje || "Sin dedicatoria"}</div> }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
import { PlantillaChequeRegalo } from "../PlantillaChequeRegalo";
/** Las subpestañas son tabs de Radix: se activan con mousedown, no con click. */
const abrir = (nombre: string) => fireEvent.mouseDown(screen.getByRole("tab", { name: nombre }), { button: 0 });
describe("Plantilla del regalo", () => {
  beforeEach(() => {
    mock.edit = true; mock.error = null; mock.update.mockReset();
    const result = () => ({ eq: () => ({ single: async () => ({ data: { id: true, ...PLANTILLA_REGALO }, error: mock.error }) }) });
    mock.update.mockReturnValue({ eq: () => ({ select: () => ({ single: async () => ({ data: { id: true }, error: null }) }) }) });
    mock.from.mockReturnValue({ select: result, update: mock.update });
  });
  it("guarda el mensaje y diseño y sustituye los datos de ejemplo en la vista previa", async () => {
    render(<PlantillaChequeRegalo />);
    await waitFor(() => expect(screen.queryByText("Cargando plantilla…")).toBeNull());
    fireEvent.change(screen.getByLabelText("Mensaje del correo"), { target: { value: "Gracias {comprador}, código {codigo}" } });
    expect(screen.getByText("Gracias Ana García, código CT-EJEMPLO")).toBeTruthy();
    abrir("Diseño del PDF");
    fireEvent.change(screen.getByLabelText("Título del cheque"), { target: { value: "Una cena especial" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar correo y PDF" }));
    await waitFor(() => expect(mock.update).toHaveBeenCalledWith(expect.objectContaining({ email_mensaje: "Gracias {comprador}, código {codigo}", pdf_titulo: "Una cena especial" })));
    expect(mock.from).toHaveBeenCalledWith("plantilla_cheques_regalo");
  });
  it("prueba ambas selecciones sin alterar la plantilla guardada", async () => {
    render(<PlantillaChequeRegalo />);
    await waitFor(() => expect(screen.queryByText("Cargando plantilla…")).toBeNull());
    expect(screen.getByText("100,00 €")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Mostrar el importe en el regalo y en el PDF" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Incluir dedicatoria en el PDF" }));
    expect(screen.queryByText("100,00 €")).toBeNull();
    // Las opciones del ejemplo se conservan al pasar a la vista previa del PDF.
    abrir("Diseño del PDF");
    expect(screen.getByTestId("vista-pdf")).toHaveAttribute("data-importe", "oculto");
    expect(screen.getByTestId("vista-pdf")).toHaveTextContent("Sin dedicatoria");
    expect(screen.getByRole("button", { name: "Guardar correo y PDF" })).toBeDisabled();
    expect(mock.update).not.toHaveBeenCalled();
  });
  it("bloquea la edición cuando la migración no está instalada", async () => {
    mock.error = { code: "PGRST205", message: "Tabla ausente" };
    render(<PlantillaChequeRegalo />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Falta instalar");
    expect(screen.getByLabelText("Mensaje del correo")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Guardar correo y PDF" })).toBeDisabled();
    expect(mock.update).not.toHaveBeenCalled();
  });
  it("muestra un año por defecto y guarda otro plazo en meses", async () => {
    render(<PlantillaChequeRegalo />);
    await waitFor(() => expect(screen.queryByText("Cargando plantilla…")).toBeNull());
    abrir("Validez");
    expect(screen.getByLabelText("Validez del cheque (meses)")).toHaveValue(12);
    fireEvent.change(screen.getByLabelText("Validez del cheque (meses)"), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar correo y PDF" }));
    await waitFor(() => expect(mock.update).toHaveBeenCalledWith(expect.objectContaining({ caducidad_meses: 6 })));
  });
  it("organiza la configuración en subpestañas y conserva lo escrito al cambiar de una a otra", async () => {
    render(<PlantillaChequeRegalo />);
    await waitFor(() => expect(screen.queryByText("Cargando plantilla…")).toBeNull());
    expect(screen.getAllByRole("tab").map(t => t.textContent)).toEqual(["Correo", "Diseño del PDF", "Validez"]);
    expect(screen.getByRole("tab", { name: "Correo" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByLabelText("Título del cheque")).toBeNull(); // solo los campos de la subpestaña abierta
    fireEvent.change(screen.getByLabelText("Asunto del correo"), { target: { value: "Tu regalo" } });
    abrir("Validez");
    fireEvent.change(screen.getByLabelText("Validez del cheque (meses)"), { target: { value: "24" } });
    abrir("Correo");
    expect(screen.getByLabelText("Asunto del correo")).toHaveValue("Tu regalo");
    fireEvent.click(screen.getByRole("button", { name: "Guardar correo y PDF" }));
    await waitFor(() => expect(mock.update).toHaveBeenCalledWith(expect.objectContaining({ email_asunto: "Tu regalo", caducidad_meses: 24 })));
  });
  it("si falta un dato de otra subpestaña, lleva a ella al guardar", async () => {
    render(<PlantillaChequeRegalo />);
    await waitFor(() => expect(screen.queryByText("Cargando plantilla…")).toBeNull());
    abrir("Diseño del PDF");
    fireEvent.change(screen.getByLabelText("Título del cheque"), { target: { value: "" } });
    abrir("Validez");
    fireEvent.click(screen.getByRole("button", { name: "Guardar correo y PDF" }));
    expect(await screen.findByLabelText("Título del cheque")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Diseño del PDF" })).toHaveAttribute("aria-selected", "true");
    expect(mock.update).not.toHaveBeenCalled();
  });
  it("añade la subpestaña externa sin perder lo escrito en ella al volver", async () => {
    const Externa = () => <input aria-label="Campo externo" defaultValue="" />;
    render(<PlantillaChequeRegalo extra={{ valor: "gastos", etiqueta: "Gastos de gestión", contenido: <Externa /> }} />);
    await waitFor(() => expect(screen.queryByText("Cargando plantilla…")).toBeNull());
    abrir("Gastos de gestión");
    fireEvent.change(screen.getByLabelText("Campo externo"), { target: { value: "2,8" } });
    expect(screen.queryByLabelText("Mensaje del correo")).toBeNull();
    abrir("Correo");
    abrir("Gastos de gestión");
    expect(screen.getByLabelText("Campo externo")).toHaveValue("2,8");
  });
});
