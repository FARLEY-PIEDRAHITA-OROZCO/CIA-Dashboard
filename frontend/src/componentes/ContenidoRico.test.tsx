import { render, screen } from "@testing-library/react";

import { describe, expect, it } from "vitest";

import { ContenidoRico, limpiarHtml } from "./ContenidoRico";

describe("limpiarHtml", () => {
  it("remueve scripts e iframes (XSS)", () => {
    const limpio = limpiarHtml('<p>Hola</p><script>alert("xss")</script><iframe src="x"></iframe>');
    expect(limpio).not.toContain("<script");
    expect(limpio).not.toContain("<iframe");
    expect(limpio).toContain("Hola");
  });

  it("remueve handlers de eventos en línea", () => {
    const limpio = limpiarHtml('<p onclick="hack()">texto</p>');
    expect(limpio).not.toContain("onclick");
  });

  it("remueve protocolos peligrosos de enlaces", () => {
    const limpio = limpiarHtml(
      '<a href="javascript:alert(1)">javascript</a><a href="data:text/html,x">data</a>',
    );
    expect(limpio).not.toContain("javascript:");
    expect(limpio).not.toContain("data:text/html");
  });

  it("remueve contenido activo y recursos externos", () => {
    const limpio = limpiarHtml(
      '<form action="https://example.com"><input name="token"><img src="https://example.com/pixel.png">texto</form>',
    );
    expect(limpio).not.toContain("<form");
    expect(limpio).not.toContain("<input");
    expect(limpio).not.toContain("<img");
    expect(limpio).toContain("texto");
  });

  it("remueve estilos inline que fragmentan el diseño", () => {
    const limpio = limpiarHtml(
      '<div style="font-family:Arial;font-size:13.3333px;text-align:left;">Contenido legible</div>',
    );
    expect(limpio).not.toContain("style=");
    expect(limpio).toContain("Contenido legible");
  });
});

describe("ContenidoRico", () => {
  it("renderiza el HTML sanitizado de la descripción", () => {
    render(
      <ContenidoRico
        html='<div><div>Desarrollar un sistema IA con OCR.</div><div>Validación de datos.</div></div>'
      />,
    );
    expect(screen.getByText("Desarrollar un sistema IA con OCR.")).toBeInTheDocument();
    expect(screen.getByText("Validación de datos.")).toBeInTheDocument();
    expect(document.querySelector(".contenido-rico")).not.toHaveAttribute("style");
  });

  it("no ejecuta scripts incrustados", () => {
    render(<ContenidoRico html='<img src="x" onerror="window.PWNED=1"/>Hola de nuevo' />);
    expect((window as unknown as { PWNED?: number }).PWNED).toBeUndefined();
    expect(screen.getByText(/Hola de nuevo/i)).toBeInTheDocument();
  });

  it("muestra marcador cuando no hay texto", () => {
    render(<ContenidoRico html="<div>&nbsp;</div>" />);
    expect(screen.getByText("Sin descripción.")).toBeInTheDocument();
  });
});