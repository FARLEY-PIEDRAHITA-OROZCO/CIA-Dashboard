import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Bug } from "../api/tipos";
import { TableroBugs } from "./TableroBugs";

function bug(overrides: Partial<Bug> = {}): Bug {
  return {
    azure_id: 10,
    titulo: "Error de validación",
    estado: "Active",
    descripcion: "",
    prioridad: "1",
    severidad: "Critical",
    asignado_a: "Persona",
    relacion: "hierarchy",
    ...overrides,
  };
}

describe("TableroBugs", () => {
  it("muestra métricas visibles y filtra por severidad", () => {
    render(
      <TableroBugs
        bugs={[
          bug(),
          bug({ azure_id: 11, titulo: "Bug resuelto", estado: "Closed", severidad: "Minor" }),
        ]}
      />,
    );

    expect(screen.getByText("Error de validación")).toBeInTheDocument();
    expect(screen.getByText("Bug resuelto")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/filtrar por severidad/i), {
      target: { value: "Critical" },
    });
    expect(screen.queryByText("Bug resuelto")).not.toBeInTheDocument();
    expect(screen.getByText("Error de validación")).toBeInTheDocument();
  });

  it("expande la descripción sanitizable", () => {
    render(
      <TableroBugs
        bugs={[bug({ descripcion: "<p>Detalle del bug</p>", url: "https://azure/bug/10" })]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /ampliar detalle del bug/i }));
    expect(screen.getByText("Detalle del bug")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /abrir en azure/i })).toHaveAttribute(
      "href",
      "https://azure/bug/10",
    );
  });
});
