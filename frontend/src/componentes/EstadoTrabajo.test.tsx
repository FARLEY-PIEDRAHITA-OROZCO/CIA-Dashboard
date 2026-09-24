import { render, screen } from "@testing-library/react";

import { describe, expect, it } from "vitest";

import { EstadoTrabajo, tonoEstado } from "./EstadoTrabajo";

describe("tonoEstado", () => {
  it("mapea estados conocidos de Azure normalizando el texto", () => {
    expect(tonoEstado("In Progress")).toBe("progreso");
    expect(tonoEstado("  iN pRoGrEsS ")).toBe("progreso");
    expect(tonoEstado("Done")).toBe("terminado");
    expect(tonoEstado("New")).toBe("nuevo");
    expect(tonoEstado("Removed")).toBe("removido");
    expect(tonoEstado("Committed")).toBe("pendiente");
  });

  it("degenera a neutro para estados desconocidos", () => {
    expect(tonoEstado("Custom State XYZ")).toBe("neutro");
    expect(tonoEstado("")).toBe("neutro");
  });
});

describe("EstadoTrabajo", () => {
  it("dibuja la etiqueta con la clase de tono correcta", () => {
    render(<EstadoTrabajo estado="In Progress" />);
    const badge = screen.getByText("In Progress");
    expect(badge).toHaveClass("estado-progreso");
  });

  it("tolera estados vacíos", () => {
    render(<EstadoTrabajo estado="  " />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});