import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import ReactMarkdown from "react-markdown";
import { urlSegura, esUrlHttp } from "@/lib/url-segura";
import { COMPONENTES_MARKDOWN_SEGUROS, urlMarkdownSegura } from "@/lib/markdown-seguro";
import { ErrorNegocio, mensajeUsuario } from "@/lib/mensaje-usuario";
import { OriginalIncrustado } from "@/components/facturas/shared/OriginalIncrustado";

describe("urlSegura (FE-06)", () => {
  it.each(["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<b>x</b>", "vbscript:x", "//evil.tld", "/ruta", "", "  ", null, undefined])(
    "rechaza %s",
    (u) => expect(urlSegura(u as string | null | undefined)).toBeNull(),
  );
  it("acepta http y https", () => {
    expect(urlSegura("https://drive.google.com/file/d/1/view")).toBe("https://drive.google.com/file/d/1/view");
    expect(esUrlHttp("http://a.tld/x")).toBe(true);
  });
  it("mailto/tel solo si se piden", () => {
    expect(urlSegura("mailto:a@b.es")).toBeNull();
    expect(urlSegura("mailto:a@b.es", ["mailto:"])).toBe("mailto:a@b.es");
  });
  it("OriginalIncrustado no pinta <a> para javascript: / data:", () => {
    const { container, rerender } = render(<OriginalIncrustado driveUrl="javascript:alert(1)" archivoPath={null} titulo="t" />);
    expect(container.querySelector("a")).toBeNull();
    rerender(<OriginalIncrustado driveUrl="data:text/html,x" archivoPath={null} titulo="t" />);
    expect(container.querySelector("a")).toBeNull();
    rerender(<OriginalIncrustado driveUrl="https://drive.google.com/x" archivoPath={null} titulo="t" />);
    expect(container.querySelector("a")?.getAttribute("rel")).toBe("noopener noreferrer");
  });
});

const md = (texto: string) =>
  render(
    <ReactMarkdown components={COMPONENTES_MARKDOWN_SEGUROS} urlTransform={urlMarkdownSegura}>
      {texto}
    </ReactMarkdown>,
  );

describe("Markdown del chat de facturas (IA-02)", () => {
  it("una imagen externa no genera <img>", () => {
    const { container } = md("hola ![x](https://att.tld/?d=gastos)");
    expect(container.querySelector("img")).toBeNull();
  });
  it("una imagen con javascript:/data: tampoco, ni enlace", () => {
    const { container } = md("![a](javascript:alert(1)) ![b](data:image/png;base64,AAAA)");
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
  });
  it("enlaces: solo http(s) con rel seguro", () => {
    const { container } = md("[ok](https://a.tld) [mal](javascript:alert(1))");
    const as = container.querySelectorAll("a");
    expect(as.length).toBe(1);
    expect(as[0].getAttribute("rel")).toBe("noopener noreferrer");
    expect(as[0].getAttribute("target")).toBe("_blank");
  });
  it("se mantienen negritas y tablas", () => {
    const { container } = md("**total**\n\n| a | b |\n|---|---|\n| 1 | 2 |\n");
    expect(container.querySelector("strong")?.textContent).toBe("total");
  });
});

describe("mensajeUsuario (FE-08)", () => {
  it("error técnico -> genérico y detalle a console.error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const pg = { code: "23505", message: 'duplicate key value violates unique constraint "x"', details: "d" };
    expect(mensajeUsuario(pg, "No se pudo guardar")).toBe("No se pudo guardar");
    expect(mensajeUsuario(new TypeError("Failed to fetch"), "g")).toBe("g");
    expect(mensajeUsuario(new Error("JWT expired"), "g")).toBe("g");
    expect(spy).toHaveBeenCalledTimes(3);
    spy.mockRestore();
  });
  it("error de negocio en español se muestra tal cual", () => {
    expect(mensajeUsuario(new Error("La mesa ya está ocupada a esa hora"), "g")).toBe("La mesa ya está ocupada a esa hora");
    expect(mensajeUsuario(new ErrorNegocio("Falta el NIF"), "g")).toBe("Falta el NIF");
  });
  it("RAISE EXCEPTION de negocio (P0001) se muestra tal cual", () => {
    const e = { code: "P0001", message: "El cheque no es válido o ya ha sido canjeado", details: null, hint: null };
    expect(mensajeUsuario(e, "g")).toBe("El cheque no es válido o ya ha sido canjeado");
  });
  it("códigos técnicos siguen genéricos (42501, 23505, PGRST)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const code of ["42501", "23505", "PGRST301", "28000"]) {
      expect(mensajeUsuario({ code, message: "Aforo superado" }, "g")).toBe("g");
    }
    spy.mockRestore();
  });
});
