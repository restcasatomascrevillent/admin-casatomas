import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PestanasPagina } from "../PestanasPagina";

function montar(props: Partial<React.ComponentProps<typeof PestanasPagina>> = {}) {
  return render(
    <Tabs defaultValue="a">
      <PestanasPagina
        pestanas={[
          { valor: "a", etiqueta: "Primera", icono: <svg data-testid="icono-a" />, contador: 12 },
          { valor: "b", etiqueta: "Segunda", contador: 0 },
          { valor: "c", etiqueta: "Tercera", contador: 3, tonoContador: "dorado", contadorEnMovil: true, etiquetaContador: "3 en curso" },
        ]}
        {...props}
      />
      <TabsContent value="a">Contenido A</TabsContent>
      <TabsContent value="b">Contenido B</TabsContent>
    </Tabs>,
  );
}

describe("PestanasPagina", () => {
  it("pinta las pestañas, marca la activa con el subrayado dorado y cambia de contenido", () => {
    montar();
    const tabs = within(screen.getByRole("tablist")).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Primera12", "Segunda", "Tercera3"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[0].className).toContain("data-[state=active]:border-[hsl(38,59%,45%)]");
    expect(screen.getByText("Contenido A")).toBeInTheDocument();
    fireEvent.mouseDown(tabs[1], { button: 0 });
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Contenido B")).toBeInTheDocument();
  });

  it("mide 40 px con ratón y 44 px con dedo, sin barra de scroll", () => {
    montar();
    const tab = screen.getByRole("tab", { name: /^Primera/ });
    expect(tab.className).toContain("h-10");
    expect(tab.className).toContain("pointer-coarse:min-h-11");
    expect(screen.getByRole("tablist").className).toContain("[&::-webkit-scrollbar]:hidden");
  });

  it("contador: solo si es mayor que 0, oculto en móvil salvo que se pida, con nombre accesible", () => {
    montar();
    expect(screen.getByRole("tab", { name: /^Segunda$/ })).toBeInTheDocument(); // contador 0: no se pinta
    expect(screen.getByText("12").className).toContain("hidden sm:inline");
    const c = screen.getByLabelText("3 en curso");
    expect(c.className).not.toContain("hidden");
    expect(c.className).toContain("text-[hsl(38,59%,34%)]");
  });

  it("icono: se pinta dentro de la pestaña y es decorativo", () => {
    montar();
    const icono = screen.getByTestId("icono-a");
    expect(screen.getByRole("tab", { name: /^Primera/ })).toContainElement(icono);
    expect(icono.parentElement).toHaveAttribute("aria-hidden", "true");
  });

  it("acciones: van en la barra, a la derecha y fuera del tablist", () => {
    montar({ acciones: <button>Nueva reserva</button> });
    const boton = screen.getByRole("button", { name: "Nueva reserva" });
    expect(within(screen.getByRole("tablist")).queryByRole("button")).not.toBeInTheDocument();
    expect(boton.parentElement).toHaveClass("ml-auto", "shrink-0");
    expect(boton.closest("[data-testid=pestanas-pagina]")).toBe(screen.getByRole("tablist").closest("[data-testid=pestanas-pagina]"));
  });

  it("sin acciones no pinta el hueco; la fila lleva la línea fina de abajo", () => {
    montar();
    const barra = screen.getByTestId("pestanas-pagina");
    expect(barra).toHaveClass("border-b");
    expect(barra.querySelector(".ml-auto")).toBeNull();
  });

  it("degradados: aparecen cuando las pestañas no caben y según el scroll", () => {
    montar();
    const lista = screen.getByRole("tablist");
    expect(screen.queryByTestId("degradado-der")).not.toBeInTheDocument(); // jsdom: todo mide 0
    Object.defineProperty(lista, "scrollWidth", { configurable: true, value: 500 });
    Object.defineProperty(lista, "clientWidth", { configurable: true, value: 200 });
    fireEvent.scroll(lista);
    expect(screen.getByTestId("degradado-der")).toBeInTheDocument();
    expect(screen.queryByTestId("degradado-izq")).not.toBeInTheDocument();
    lista.scrollLeft = 300;
    fireEvent.scroll(lista);
    expect(screen.getByTestId("degradado-izq")).toBeInTheDocument();
    expect(screen.queryByTestId("degradado-der")).not.toBeInTheDocument();
  });

  it("con accionesDebajoEnMovil las pestañas van arriba con su línea y los botones bajan a una fila a todo el ancho; desde sm, una sola fila (F-47)", () => {
    montar({ acciones: <button type="button">Añadir</button>, accionesDebajoEnMovil: true });
    const barra = screen.getByTestId("pestanas-pagina");
    expect(barra.className).toContain("flex-wrap");
    expect(barra.className).toContain("sm:flex-nowrap");
    // La línea: bajo las pestañas en el móvil y bajo toda la barra desde sm.
    expect(barra.className).toContain("border-b-0");
    expect(barra.className).toContain("sm:border-b");
    const envoltorioPestanas = screen.getByRole("tablist").parentElement!;
    expect(envoltorioPestanas.className).toContain("basis-full");
    expect(envoltorioPestanas.className).toContain("border-b");
    expect(envoltorioPestanas.className).toContain("sm:border-b-0");
    const acciones = screen.getByRole("button", { name: "Añadir" }).parentElement!;
    expect(acciones.className).toContain("w-full");
    expect(acciones.className).toContain("sm:w-auto");
    expect(acciones.className).not.toContain("order-first");
    // Los botones, DESPUÉS de las pestañas (orden visual = orden de lectura).
    expect(envoltorioPestanas.compareDocumentPosition(acciones) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("sin accionesDebajoEnMovil la barra es una sola fila", () => {
    montar({ acciones: <button type="button">Añadir</button> });
    const barra = screen.getByTestId("pestanas-pagina");
    expect(barra.className).not.toContain("flex-wrap");
    expect(barra.className).not.toContain("border-b-0");
    expect(screen.getByRole("button", { name: "Añadir" }).parentElement!.className).not.toContain("w-full");
  });
});
