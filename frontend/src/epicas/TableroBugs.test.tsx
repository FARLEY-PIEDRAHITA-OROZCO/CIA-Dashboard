import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

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

/** `TarjetaBugEditable` es data-connected: necesita un QueryClient. */
function renderConQuery(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("TableroBugs", () => {
  it("muestra métricas visibles y filtra por severidad", () => {
    renderConQuery(
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
    renderConQuery(
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

  it("abre el formulario de edición QA y permite añadir un tag", () => {
    renderConQuery(<TableroBugs bugs={[bug()]} />);

    fireEvent.click(screen.getByRole("button", { name: /editar bug #10 \(qa\)/i }));
    const formulario = screen.getByRole("form", { name: /Editar Error de validación/i });

    const chip = within(formulario).getByRole("button", { name: "verificado-qa" });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(chip);
    expect(
      within(formulario).getByRole("button", { name: "verificado-qa" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("muestra el aviso de solo lectura cuando la escritura está deshabilitada", () => {
    renderConQuery(<TableroBugs bugs={[bug()]} edicionHabilitada={false} />);

    fireEvent.click(screen.getByRole("button", { name: /editar bug #10 \(qa\)/i }));

    expect(screen.getByRole("note")).toHaveTextContent(/solo lectura/i);
    expect(screen.queryByRole("button", { name: /Guardar en Azure/i })).not.toBeInTheDocument();
  });

  it("envía el PATCH con los campos tocados al guardar", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          work_item_id: 10,
          rev: 5,
          campos: ["tags"],
          validado: false,
          detalle: "Cambio aplicado en Azure DevOps.",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderConQuery(<TableroBugs bugs={[bug()]} />);
    fireEvent.click(screen.getByRole("button", { name: /editar bug #10 \(qa\)/i }));
    fireEvent.click(screen.getByRole("button", { name: "verificado-qa" }));
    fireEvent.click(screen.getByRole("button", { name: /Guardar en Azure/i }));

    expect(await screen.findByText(/Cambio aplicado/i)).toBeInTheDocument();

    const llamada = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const [url, opciones] = llamada;
    expect(url).toContain("/api/workitems/10");
    expect(url).toContain("validar=false");
    expect(opciones.method).toBe("PATCH");
    expect(JSON.parse(String(opciones.body))).toEqual({ tags: "verificado-qa" });

    vi.unstubAllGlobals();
  });
});
