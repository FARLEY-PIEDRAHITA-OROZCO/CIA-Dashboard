import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Feature, UserStory } from "../api/tipos";
import type { Tarea } from "../api/tipos";
import {
  agruparTareasPorEstado,
  aplanarTareas,
  TableroTareas,
  type TareaConContexto,
} from "./TableroTareas";

function tarea(azure_id: number, titulo: string, estado: string): Tarea {
  return { azure_id, titulo, estado, descripcion: "" };
}

function hu(azure_id: number, titulo: string, tareas: Tarea[]): UserStory {
  return { azure_id, titulo, estado: "New", descripcion: "", tareas };
}

const FEATURES: Feature[] = [
  { azure_id: 101, titulo: "Onboarding", estado: "Committed", descripcion: "", hus: [hu(201, "Registro", [tarea(300, "Firma electrónica", "New")])] },
  { azure_id: 102, titulo: "OCR", estado: "Active", descripcion: "", hus: [hu(202, "Escaneo", [tarea(310, "Limpiar imagen", "In Progress")])] },
];

const EPICA = {
  azure_id: 7,
  titulo: "Épica demo",
  estado: "New",
  descripcion: "",
  url: "",
  hus: [hu(203, "Directa", [tarea(320, "Empaquetar", "Done")])],
  features: FEATURES,
};

/** Construye una tarea ya con contexto (espejo de la de historias). */
function tareaConContexto(
  t: Tarea,
  contexto = "",
  huAzureId = 201,
  huTitulo = "Registro",
): TareaConContexto {
  return { tarea: t, hu: huTitulo, huAzureId, contexto };
}

describe("aplanarTareas", () => {
  it("aplana directas y por feature conservando el contexto", () => {
    const planas = aplanarTareas(EPICA);

    expect(planas).toHaveLength(3);
    expect(planas[0].tarea.azure_id).toBe(300);
    expect(planas[0].contexto).toBe("Onboarding");
    expect(planas[0].huAzureId).toBe(201);
    expect(planas[2].contexto).toBe("");
    expect(planas[2].huAzureId).toBe(203);
  });
});

describe("agruparTareasPorEstado", () => {
  it("agrupa por tono y ordena por id", () => {
    const grupos = agruparTareasPorEstado([
      tareaConContexto(tarea(400, "T1", "New")),
      tareaConContexto(tarea(300, "T0", "New")),
      tareaConContexto(tarea(310, "En curso", "In Progress")),
    ]);

    expect(grupos.get("nuevo")?.map((t) => t.tarea.azure_id)).toEqual([300, 400]);
    expect(grupos.get("progreso")?.map((t) => t.tarea.azure_id)).toEqual([310]);
  });
});

describe("TableroTareas", () => {
  it("muestra cinturón, columnas y tarjetas", () => {
    render(
      <TableroTareas
        tareas={[
          tareaConContexto(tarea(300, "Firma", "New")),
          tareaConContexto(tarea(310, "OCR", "In Progress"), "OCR", 202, "Escaneo"),
        ]}
      />,
    );

    expect(screen.getAllByText("Nueva").length).toBeGreaterThan(0);
    expect(screen.getAllByText("En curso").length).toBeGreaterThan(0);
    expect(screen.getByText("Firma")).toBeInTheDocument();
    expect(screen.getByText("OCR")).toBeInTheDocument();
  });

  it("abre una tarjeta con descripción", () => {
    const tareas = [
      tareaConContexto({
        azure_id: 345,
        titulo: "Subir captura",
        estado: "New",
        descripcion: "<p>Detalle de la tarea</p>",
      }),
    ];
    render(<TableroTareas tareas={tareas} />);
    fireEvent.click(screen.getByRole("button", { name: /ampliar detalle de la tarea/i }));
    expect(screen.getByText("Detalle de la tarea")).toBeInTheDocument();
  });

  it("filtra por texto", () => {
    render(
      <TableroTareas
        tareas={[
          tareaConContexto(tarea(350, "Escaneo", "New")),
          tareaConContexto(tarea(360, "OCR final", "New")),
        ]}
      />,
    );
    fireEvent.change(screen.getByLabelText(/buscar tarea/i), { target: { value: "ocr" } });
    expect(screen.queryByText("Escaneo")).not.toBeInTheDocument();
    expect(screen.getByText("OCR final")).toBeInTheDocument();
  });

  it("muestra aviso cuando no quedan coincidencias", () => {
    render(
      <TableroTareas tareas={[tareaConContexto(tarea(370, "Única tarea", "New"))]} />,
    );
    fireEvent.change(screen.getByLabelText(/buscar tarea/i), { target: { value: "xyz" } });
    expect(screen.getByText(/no hay tareas que coincidan/i)).toBeInTheDocument();
  });

  it("mantiene el enlace a Azure aunque la tarea no tenga descripción", () => {
    render(
      <TableroTareas
        tareas={[
          {
            tarea: {
              azure_id: 390,
              titulo: "Tarea con enlace",
              estado: "New",
              descripcion: "",
              url: "https://dev.azure.com/org/proyecto/_workitems/edit/390",
            },
            hu: "HU origen",
            huAzureId: 201,
            contexto: "",
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /ampliar detalle de la tarea #390/i }));
    expect(screen.getByRole("link", { name: /abrir en azure/i })).toHaveAttribute(
      "href",
      "https://dev.azure.com/org/proyecto/_workitems/edit/390",
    );
  });

  it("permite volver a expandir una columna colapsada", () => {
    render(
      <TableroTareas
        tareas={[tareaConContexto(tarea(380, "Tarea visible", "New"))]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /contraer columna nueva/i }));
    expect(screen.queryByText("Tarea visible")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /expandir columna nueva/i }),
    ).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(screen.getByRole("button", { name: /expandir columna nueva/i }));
    expect(screen.getByText("Tarea visible")).toBeInTheDocument();
  });
});
