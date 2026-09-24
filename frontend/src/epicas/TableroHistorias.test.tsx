import { fireEvent, render, screen } from "@testing-library/react";

import { describe, expect, it } from "vitest";

import type { Epic } from "../api/tipos";
import {
  agruparPorEstado,
  aplanarHistorias,
  TableroHistorias,
  type HistoriaConContexto,
} from "./TableroHistorias";

function historia(
  azure_id: number,
  titulo: string,
  estado: string,
  descripcion = "",
  featureId?: number,
  contexto = "Feature Onboarding",
): HistoriaConContexto {
  return { hu: { azure_id, titulo, estado, descripcion, url: "" }, contexto, featureId };
}

const DESC = "<div>Detalle de la historia</div>";

describe("agruparPorEstado", () => {
  it("agrupa en columnas por tono de estado", () => {
    const grupos = agruparPorEstado([
      historia(201, "HU A", "New"),
      historia(202, "HU B", "Done"),
      historia(203, "HU C", "In Progress"),
    ]);

    expect(grupos.get("nuevo")?.map((h) => h.hu.azure_id)).toEqual([201]);
    expect(grupos.get("terminado")?.map((h) => h.hu.azure_id)).toEqual([202]);
    expect(grupos.get("progreso")?.map((h) => h.hu.azure_id)).toEqual([203]);
  });

  it("ordena dentro de la columna por ID", () => {
    const grupos = agruparPorEstado([
      historia(300, "HU 3", "New"),
      historia(100, "HU 1", "New"),
      historia(200, "HU 2", "New"),
    ]);

    expect(grupos.get("nuevo")?.map((h) => h.hu.azure_id)).toEqual([100, 200, 300]);
  });

  it("deja sin columna asignada un estado desconocido", () => {
    const grupos = agruparPorEstado([historia(400, "HU rara", "Estado Inventado")]);
    expect(grupos.get("neutro")?.map((h) => h.hu.azure_id)).toEqual([400]);
  });
});

describe("aplanarHistorias", () => {
  it("aplana directas y por feature conservando el contexto", () => {
    const epica: Epic = {
      azure_id: 100,
      titulo: "Épica",
      estado: "New",
      descripcion: "",
      url: "",
      hus: [{ azure_id: 300, titulo: "Directa", estado: "New", descripcion: "" }],
      features: [
        {
          azure_id: 101,
          titulo: "Onboarding",
          estado: "Committed",
          descripcion: "",
          hus: [{ azure_id: 201, titulo: "HU Registro", estado: "Done", descripcion: "" }],
        },
      ],
    };

    const planas = aplanarHistorias(epica);

    expect(planas).toHaveLength(2);
    expect(planas[0].hu.azure_id).toBe(300);
    expect(planas[0].contexto).toBe("");
    expect(planas[0].featureId).toBeUndefined();
    expect(planas[1].hu.azure_id).toBe(201);
    expect(planas[1].contexto).toBe("Onboarding");
    expect(planas[1].featureId).toBe(101);
  });
});

describe("TableroHistorias", () => {
  const FEATURES = [
    { azure_id: 101, titulo: "Onboarding", estado: "Committed", descripcion: "", hus: [] },
    { azure_id: 102, titulo: "OCR", estado: "Active", descripcion: "", hus: [] },
  ];

  it("muestra cinturón, columnas, tarjetas y contexto de feature", () => {
    render(
      <TableroHistorias
        historias={[
          historia(201, "Escaneo", "New", "", 101),
          historia(202, "Extracción OCR", "In Progress", "", 102, "Feature OCR"),
        ]}
        features={FEATURES}
      />,
    );

    expect(screen.getAllByText("Nueva").length).toBeGreaterThan(0);
    expect(screen.getAllByText("En curso").length).toBeGreaterThan(0);

    expect(screen.getByText("#201")).toBeInTheDocument();
    expect(screen.getByText("Escaneo")).toBeInTheDocument();
    expect(screen.getByText("Extracción OCR")).toBeInTheDocument();

    expect(screen.getByText("Onboarding")).toBeInTheDocument();
    expect(screen.getByText("OCR")).toBeInTheDocument();
  });

  it("filtra por texto", () => {
    render(
      <TableroHistorias
        historias={[historia(201, "Escaneo", "New"), historia(202, "OCR final", "New")]}
        features={FEATURES}
      />,
    );

    fireEvent.change(screen.getByLabelText(/buscar historia/i), {
      target: { value: "ocr" },
    });

    expect(screen.queryByText("Escaneo")).not.toBeInTheDocument();
    expect(screen.getByText("OCR final")).toBeInTheDocument();
  });

  it("filtra por feature", () => {
    render(
      <TableroHistorias
        historias={[
          historia(201, "HU Onboarding", "New", "", 101),
          historia(202, "HU OCR", "New", "", 102, "Feature OCR"),
        ]}
        features={FEATURES}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Onboarding" }));

    expect(screen.getByText("HU Onboarding")).toBeInTheDocument();
    expect(screen.queryByText("HU OCR")).not.toBeInTheDocument();
  });

  it("aisla una columna desde el cinturón de estados", () => {
    render(
      <TableroHistorias
        historias={[historia(201, "HU nueva", "New"), historia(202, "HU en curso", "In Progress")]}
        features={FEATURES}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: /en curso/i })[0]);

    expect(screen.queryByText("HU nueva")).not.toBeInTheDocument();
    expect(screen.getByText("HU en curso")).toBeInTheDocument();
  });

  it("alterna a modo compacto sin descripciones recortadas", () => {
    render(
      <TableroHistorias
        historias={[historia(201, "HU con detalle", "New", DESC)]}
        features={FEATURES}
      />,
    );

    expect(screen.getByText(/Detalle de la historia/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Compacta" }));

    expect(screen.queryByText(/Detalle de la historia/)).not.toBeInTheDocument();
  });

  it("colapsa una columna", () => {
    render(
      <TableroHistorias historias={[historia(201, "HU colapsable", "New")]} features={FEATURES} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /contraer columna nueva/i }));

    expect(screen.queryByText("HU colapsable")).not.toBeInTheDocument();
  });

  it("amplía una tarjeta y enlaza a Azure", () => {
    const url = "https://dev.azure.com/org/proyecto/_workitems/edit/202";
    const base = historia(202, "HU con enlace", "New", DESC, 101);
    render(
      <TableroHistorias
        historias={[{ ...base, hu: { ...base.hu, url } }]}
        features={FEATURES}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /ampliar detalle de la historia #202/i }));

    const enlace = screen.getByRole("link", { name: /abrir en azure/i });
    expect(enlace).toHaveAttribute("href", url);
  });

  it("mantiene el enlace a Azure aunque la historia no tenga descripción", () => {
    const historiaSinDescripcion = historia(220, "HU con enlace", "New");
    historiaSinDescripcion.hu.url = "https://dev.azure.com/org/proyecto/_workitems/edit/220";

    render(
      <TableroHistorias
        historias={[historiaSinDescripcion]}
        features={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /ampliar detalle de la historia #220/i }));
    expect(screen.getByRole("link", { name: /abrir en azure/i })).toHaveAttribute(
      "href",
      "https://dev.azure.com/org/proyecto/_workitems/edit/220",
    );
  });

  it("muestra aviso cuando los filtros no dejan coincidencias", () => {
    render(
      <TableroHistorias historias={[historia(201, "Escaneo", "New")]} features={FEATURES} />,
    );

    fireEvent.change(screen.getByLabelText(/buscar historia/i), {
      target: { value: "inexistente" },
    });

    expect(screen.getByText(/no hay historias que coincidan/i)).toBeInTheDocument();
  });
});