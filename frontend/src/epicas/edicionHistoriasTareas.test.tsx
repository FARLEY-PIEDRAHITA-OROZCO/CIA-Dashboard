import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Tarea, UserStory } from "../api/tipos";
import { TableroTareas } from "./TableroTareas";
import { TableroHistorias } from "./TableroHistorias";

function tarea(overrides: Partial<Tarea> = {}): Tarea {
  return {
    azure_id: 300,
    titulo: "Crear formulario",
    estado: "New",
    descripcion: "",
    ...overrides,
  };
}

function historia(overrides: Partial<UserStory> = {}): UserStory {
  return {
    azure_id: 201,
    titulo: "HU Registro",
    estado: "New",
    descripcion: "",
    ...overrides,
  };
}

function renderConQuery(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

/** Los tableros renderizan TODAS las columnas del estado, así que un mismo
 *  campo puede aparecer en varias tarjetas a la vez. Los tests que abren el
 *  formulario se limitan a una columna mediante `densidad` o a un solo elemento. */
function campoUnico(etiqueta: RegExp) {
  const encontrados = screen.getAllByLabelText(etiqueta);
  expect(encontrados.length).toBeGreaterThan(0);
  return encontrados[0];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Una sola tarea, en columna "Nueva", para que el DOM sea predecible. */
const UNA_TAREA = [
  { tarea: tarea(), hu: "HU Registro", huAzureId: 201, contexto: "" },
];

describe("Edición QA de tareas", () => {
  it("abre el formulario y envía solo los campos modificados", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          work_item_id: 300,
          rev: 4,
          campos: ["tags"],
          validado: false,
          detalle: "Cambio aplicado en Azure DevOps.",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderConQuery(<TableroTareas tareas={UNA_TAREA} />);

    fireEvent.click(screen.getByRole("button", { name: /editar tarea #300 \(QA\)/i }));
    fireEvent.click(screen.getByRole("button", { name: "verificado-qa" }));
    fireEvent.click(screen.getByRole("button", { name: /Guardar en Azure/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(/Cambio aplicado/i);

    const [url, opciones] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/workitems/300");
    expect(opciones.method).toBe("PATCH");
    expect(JSON.parse(String(opciones.body))).toEqual({ tags: "verificado-qa" });
  });

  it("no ofrece prioridad ni severidad, que no existen en tareas", () => {
    renderConQuery(<TableroTareas tareas={UNA_TAREA} />);

    fireEvent.click(screen.getByRole("button", { name: /editar tarea #300 \(QA\)/i }));

    expect(screen.queryByLabelText(/^Prioridad/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Severidad/)).not.toBeInTheDocument();
    expect(campoUnico(/^Estado/)).toBeInTheDocument();
    expect(campoUnico(/^Tags/)).toBeInTheDocument();
  });

  it("ofrece un desplegable de estados de Azure", () => {
    renderConQuery(<TableroTareas tareas={UNA_TAREA} />);

    fireEvent.click(screen.getByRole("button", { name: /editar tarea #300 \(QA\)/i }));

    const estado = campoUnico(/^Estado/) as HTMLSelectElement;
    expect(estado.tagName).toBe("SELECT");
    expect(estado.value).toBe("New");
  });

  it("muestra los tags actuales de la tarea", () => {
    renderConQuery(
      <TableroTareas
        tareas={[
          {
            tarea: tarea({ tags: "bloqueado" }),
            hu: "HU",
            huAzureId: 201,
            contexto: "",
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /editar tarea #300 \(QA\)/i }));

    expect(campoUnico(/^Tags/)).toHaveValue("bloqueado");
  });

  it("explica el modo solo lectura", () => {
    renderConQuery(<TableroTareas tareas={UNA_TAREA} edicionHabilitada={false} />);

    fireEvent.click(screen.getByRole("button", { name: /editar tarea #300 \(QA\)/i }));

    expect(screen.getByRole("note")).toHaveTextContent(/solo lectura/i);
  });
});

describe("Edición QA de historias", () => {
  it("abre el formulario con los tags actuales precargados", () => {
    renderConQuery(
      <TableroHistorias
        historias={[{ hu: historia({ tags: "reproducible" }), contexto: "Onboarding" }]}
        features={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /editar historia #201 \(QA\)/i }));

    expect(screen.getByRole("form", { name: /Editar HU Registro/i })).toBeInTheDocument();
    expect(campoUnico(/^Tags/)).toHaveValue("reproducible");
  });

  it("tampoco ofrece prioridad ni severidad en historias", () => {
    renderConQuery(
      <TableroHistorias historias={[{ hu: historia(), contexto: "" }]} features={[]} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /editar historia #201 \(QA\)/i }));

    expect(screen.queryByLabelText(/^Prioridad/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Severidad/)).not.toBeInTheDocument();
  });

  it("envía el cambio de estado de la historia", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          work_item_id: 201,
          rev: 2,
          campos: ["estado"],
          validado: false,
          detalle: "Cambio aplicado en Azure DevOps.",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderConQuery(
      <TableroHistorias historias={[{ hu: historia(), contexto: "" }]} features={[]} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /editar historia #201 \(QA\)/i }));
    fireEvent.change(campoUnico(/^Estado/), { target: { value: "Done" } });
    fireEvent.click(screen.getByRole("button", { name: /Guardar en Azure/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(/Cambio aplicado/i);
    const [url, opciones] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/workitems/201");
    expect(JSON.parse(String(opciones.body))).toEqual({ estado: "Done" });
  });

  it("valida en seco sin escribir", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          work_item_id: 201,
          rev: 1,
          campos: ["estado"],
          validado: true,
          detalle: "Azure validó el cambio; no se guardó nada.",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderConQuery(
      <TableroHistorias historias={[{ hu: historia(), contexto: "" }]} features={[]} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /editar historia #201 \(QA\)/i }));
    fireEvent.change(campoUnico(/^Estado/), { target: { value: "Done" } });
    fireEvent.click(screen.getByRole("button", { name: /Validar sin guardar/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(/no se guardó nada/i);
    const [url, opciones] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("validar=true");
    expect(opciones.method).toBe("PATCH");
  });

  it("propaga el aviso de solo lectura", () => {
    renderConQuery(
      <TableroHistorias
        historias={[{ hu: historia(), contexto: "" }]}
        features={[]}
        edicionHabilitada={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /editar historia #201 \(QA\)/i }));

    expect(screen.getByRole("note")).toHaveTextContent(/ESCRITURA_HABILITADA/);
  });
});
