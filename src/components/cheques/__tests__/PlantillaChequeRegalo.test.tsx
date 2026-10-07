import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PLANTILLA_REGALO } from "@/lib/cheques/regalo";
const mock = vi.hoisted(() => ({ from: vi.fn(), update: vi.fn(), edit: true, error: null as unknown }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mock.from } }));
vi.mock("@/hooks/useUserRole", () => ({ useCanAccessSection: () => ({ canAccess: mock.edit }) }));
vi.mock("../VistaChequeRegalo", () => ({ VistaChequeRegalo: () => <div>Vista PDF</div> }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
import { PlantillaChequeRegalo } from "../PlantillaChequeRegalo";
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
    fireEvent.change(screen.getByLabelText("Título del cheque"), { target: { value: "Una cena especial" } });
    expect(screen.getByText("Gracias Ana García, código CT-EJEMPLO")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Guardar correo y PDF" }));
    await waitFor(() => expect(mock.update).toHaveBeenCalledWith(expect.objectContaining({ email_mensaje: "Gracias {comprador}, código {codigo}", pdf_titulo: "Una cena especial" })));
    expect(mock.from).toHaveBeenCalledWith("plantilla_cheques_regalo");
  });
  it("bloquea la edición cuando la migración no está instalada", async () => {
    mock.error = { code: "PGRST205", message: "Tabla ausente" };
    render(<PlantillaChequeRegalo />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Falta instalar");
    expect(screen.getByLabelText("Mensaje del correo")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Guardar correo y PDF" })).toBeDisabled();
    expect(mock.update).not.toHaveBeenCalled();
  });
});
