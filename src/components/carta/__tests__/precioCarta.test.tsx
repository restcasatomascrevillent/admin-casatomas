/**
 * Precio válido en vinos y bebidas (revisión QA, tanda 1): sin precio, con
 * letras, 0 o negativo no se guarda y sale el mensaje del panel junto al campo
 * (no el aviso nativo del navegador, F-42). «4,50» y «4.50» valen lo mismo.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Form } from "@/components/ui/form";
import { CamposVino } from "../CamposVino";
import { MENSAJES_PRECIO, esquemaPrecioCarta, precioParaCampo } from "../precioCarta";

const precio = (v: unknown) => esquemaPrecioCarta.safeParse(v);
const mensaje = (v: unknown) => {
  const r = precio(v);
  return r.success ? null : r.error.issues[0].message;
};

describe("esquemaPrecioCarta", () => {
  it.each([
    ["4,50", 4.5],
    ["4.50", 4.5],
    [" 12 ", 12],
    ["0,01", 0.01],
    ["9999,99", 9999.99],
    [24.5, 24.5],
  ])("acepta %j como %s", (entrada, esperado) => {
    const r = precio(entrada);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBe(esperado);
  });

  it("vacío o sin valor: pide el precio", () => {
    expect(mensaje("")).toBe(MENSAJES_PRECIO.obligatorio);
    expect(mensaje("   ")).toBe(MENSAJES_PRECIO.obligatorio);
    expect(mensaje(undefined)).toBe(MENSAJES_PRECIO.obligatorio);
    expect(mensaje(null)).toBe(MENSAJES_PRECIO.obligatorio);
  });

  it("con letras o formato raro: dice que no es un número", () => {
    for (const v of ["abc", "4,5€", "1.234,50", "4,50,1", "e3"]) {
      expect(mensaje(v)).toBe(MENSAJES_PRECIO.noNumero);
    }
  });

  it("0 y negativos: mensaje propio del panel", () => {
    expect(mensaje("0")).toBe(MENSAJES_PRECIO.noPositivo);
    expect(mensaje("0,00")).toBe(MENSAJES_PRECIO.noPositivo);
    expect(mensaje("-3")).toBe(MENSAJES_PRECIO.noPositivo);
    expect(mensaje(0)).toBe(MENSAJES_PRECIO.noPositivo);
  });

  it("más de 2 decimales o por encima del máximo: no se guarda", () => {
    expect(mensaje("4,505")).toBe(MENSAJES_PRECIO.decimales);
    expect(mensaje("10000")).toBe(MENSAJES_PRECIO.maximo);
  });

  it("precioParaCampo deja el precio guardado como texto editable", () => {
    expect(precioParaCampo(4.5)).toBe("4.5");
    expect(precioParaCampo(0)).toBe("0");
    expect(precioParaCampo(null)).toBe("");
  });
});

const esquema = z.object({ precio_eur: esquemaPrecioCarta });

function FormularioPrueba({ alGuardar, inicial = "" }: { alGuardar: (v: z.output<typeof esquema>) => void; inicial?: string }) {
  const form = useForm<z.input<typeof esquema>, unknown, z.output<typeof esquema>>({
    resolver: zodResolver(esquema),
    defaultValues: { precio_eur: inicial },
  });
  return (
    <Form {...form}>
      <form noValidate onSubmit={form.handleSubmit(alGuardar)}>
        <CamposVino control={form.control} categorias={[]} denominaciones={[]} regiones={[]} paises={[]} />
        <button type="submit">Guardar</button>
      </form>
    </Form>
  );
}

describe("campo de precio del formulario de vino", () => {
  const campo = () => screen.getByLabelText("Precio en carta (€)") as HTMLInputElement;

  it("es de texto con teclado decimal (sin aviso nativo del navegador)", () => {
    render(<FormularioPrueba alGuardar={vi.fn()} />);
    expect(campo().type).toBe("text");
    expect(campo().inputMode).toBe("decimal");
    expect(campo().getAttribute("min")).toBeNull();
  });

  it.each([
    ["", MENSAJES_PRECIO.obligatorio],
    ["abc", MENSAJES_PRECIO.noNumero],
    ["-2", MENSAJES_PRECIO.noPositivo],
  ])("con %j no guarda y enseña el mensaje junto al campo", async (valor, texto) => {
    const alGuardar = vi.fn();
    render(<FormularioPrueba alGuardar={alGuardar} />);
    fireEvent.change(campo(), { target: { value: valor } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText(texto)).toBeTruthy();
    expect(alGuardar).not.toHaveBeenCalled();
    expect(campo().getAttribute("aria-invalid")).toBe("true");
  });

  it("guarda «4,50» como 4.5", async () => {
    const alGuardar = vi.fn();
    render(<FormularioPrueba alGuardar={alGuardar} />);
    fireEvent.change(campo(), { target: { value: "4,50" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(alGuardar).toHaveBeenCalled());
    expect(alGuardar.mock.calls[0][0]).toEqual({ precio_eur: 4.5 });
  });

  it("un vino guardado a 0 € no se puede volver a guardar sin poner precio", async () => {
    const alGuardar = vi.fn();
    render(<FormularioPrueba alGuardar={alGuardar} inicial={precioParaCampo(0)} />);
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText(MENSAJES_PRECIO.noPositivo)).toBeTruthy();
    expect(alGuardar).not.toHaveBeenCalled();
  });
});
