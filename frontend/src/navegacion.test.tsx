import { act, render, screen } from "@testing-library/react";

import { describe, expect, it } from "vitest";

import { enlaceA, irA, parsearHash, useVista } from "./navegacion";

function SondaVista() {
  const vista = useVista();
  const texto =
    vista.pagina === "epica" ? `epica:${vista.azureId}` : "dashboard";
  return <div data-testid="vista">{texto}</div>;
}

describe("parsearHash", () => {
  it("mapea rutas de la página de historias", () => {
    expect(parsearHash("#/epicas/5586")).toEqual({ pagina: "epica", azureId: 5586 });
    expect(parsearHash("#/epicas/1")).toEqual({ pagina: "epica", azureId: 1 });
    expect(parsearHash("#/epicas/1/tareas")).toEqual({
      pagina: "epicaTareas",
      azureId: 1,
    });
    expect(parsearHash("#/epicas/1/bugs")).toEqual({
      pagina: "epicaBugs",
      azureId: 1,
    });
  });

  it("degrada a dashboard para rutas vacías o inválidas", () => {
    expect(parsearHash("")).toEqual({ pagina: "dashboard" });
    expect(parsearHash("#/dashboard")).toEqual({ pagina: "dashboard" });
    expect(parsearHash("#/epicas/abc")).toEqual({ pagina: "dashboard" });
    expect(parsearHash("#/epicas/1e3")).toEqual({ pagina: "dashboard" });
    expect(parsearHash("#/epicas/1/extra")).toEqual({ pagina: "dashboard" });
    expect(parsearHash("#/epicas/0")).toEqual({ pagina: "dashboard" });
  });
});

describe("enlaceA", () => {
  it("genera hrefs coherentes", () => {
    expect(enlaceA({ pagina: "dashboard" })).toBe("#/dashboard");
    expect(enlaceA({ pagina: "epica", azureId: 100 })).toBe("#/epicas/100");
    expect(enlaceA({ pagina: "epicaTareas", azureId: 100 })).toBe("#/epicas/100/tareas");
    expect(enlaceA({ pagina: "epicaBugs", azureId: 100 })).toBe("#/epicas/100/bugs");
  });
});

describe("useVista", () => {
  it("reacciona a los cambios de hash", () => {
    const previo = window.location.hash;
    window.location.hash = "#/epicas/7";
    render(<SondaVista />);
    expect(screen.getByTestId("vista").textContent).toBe("epica:7");

    act(() => {
      irA({ pagina: "dashboard" });
      window.dispatchEvent(new Event("hashchange"));
    });
    expect(screen.getByTestId("vista").textContent).toBe("dashboard");

    window.location.hash = previo;
  });
});