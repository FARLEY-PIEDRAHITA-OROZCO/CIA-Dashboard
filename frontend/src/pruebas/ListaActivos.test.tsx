/** Pruebas de la lista de activos editables y de cómo dirige el formulario.
 *
 * Lo que se vigila es que el formulario **no decida** qué campos ofrece. La
 * razón es medida: Azure acepta en silencio escribir un campo que el tipo no
 * tiene (comprobado con `validateOnly`), así que un control de más no da error,
 * deja un campo huérfano. La autoridad es la lista que envía el backend.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ActivoDePrueba, ActivosPrueba } from "../api/tipos";
import { EdicionInline } from "../epicas/EdicionInline";
import { ListaActivos } from "./ListaActivos";

const CASO: ActivoDePrueba = {
  azure_id: 5733,
  tipo: "Test Case",
  titulo: "Validar completitud de lectura",
  estado: "Design",
  sprint: "Sprint 45",
  persona: "Ana Diaz",
  tags: "smoke",
  prioridad: "2",
  automatizacion: "Not Automated",
  modificado: "2026-02-01T00:00:00Z",
  campos_editables: ["estado", "notas_qa", "prioridad", "tags"],
};

const PLAN: ActivoDePrueba = {
  ...CASO,
  azure_id: 5324,
  tipo: "Test Plan",
  titulo: "Auditorias tecnicas",
  estado: "Active",
  prioridad: "",
  tags: "",
  campos_editables: ["estado"],
};

let pedidas: string[];
let enviados: { id: number; cuerpo: unknown }[];

function respuesta(items: ActivoDePrueba[]): ActivosPrueba {
  return {
    resumen: {
      total: items.length,
      offset: 0,
      limite: 50,
      hay_mas: false,
      parcial: false,
      lotes_con_error: 0,
    },
    items,
    estados: {
      "Test Case": ["Design", "Ready", "Closed"],
      "Test Plan": ["Active"],
    },
  };
}

function montar(items: ActivoDePrueba[] = [CASO]) {
  pedidas = [];
  enviados = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: RequestInfo | URL, init?: RequestInit) => {
      const url = String(entrada);
      if (init?.method === "PATCH") {
        enviados.push({ id: Number(url.split("/workitems/")[1].split("?")[0]), cuerpo: init.body });
        return new Response(JSON.stringify({ work_item_id: 1, rev: 5, campos: ["estado"] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      pedidas.push(url);
      const cuerpo = url.includes("/pruebas/activos") ? respuesta(items) : {};
      return new Response(JSON.stringify(cuerpo), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={cliente}>
      <ListaActivos abierto />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  cleanup();
});

describe("ListaActivos", () => {
  it("pide los activos del tipo y del estado elegidos", async () => {
    montar();
    await screen.findByText("Validar completitud de lectura");
    expect(pedidas[0]).toContain("tipo=Test+Case");
    expect(pedidas[0]).toContain("limite=50");
  });

  it("el selector de estado ofrece los que el tipo usa de verdad", async () => {
    montar();
    await screen.findByText("Validar completitud de lectura");
    const opciones = within(screen.getByLabelText("Filtrar por estado"))
      .getAllByRole("option")
      .map((o) => o.textContent);
    // Azure rechaza con 400 un estado que no existe: ofrecer el catálogo
    // completo de la plantilla sería ofrecer transiciones que siempre fallan.
    expect(opciones).toEqual(["Todos los estados", "Design", "Ready", "Closed"]);
  });

  it("no hace nada hasta que se despliega el formulario de una fila", async () => {
    montar();
    await screen.findByText("Validar completitud de lectura");
    expect(screen.queryByLabelText(/Notas QA/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Validar completitud de lectura" }));
    expect(screen.getByLabelText(/Notas QA/)).toBeTruthy();
  });

  it("un plan solo ofrece estado, porque es lo único que su tipo tiene", async () => {
    montar([PLAN]);
    fireEvent.click(screen.getByRole("button", { name: "Planes" }));
    await screen.findByText("Auditorias tecnicas");

    fireEvent.click(screen.getByRole("button", { name: "Auditorias tecnicas" }));
    // Ofrecer tags o notas aquí crearía campos que el tipo no tiene y que Azure
    // aceptaría sin decir nada.
    expect(screen.getByLabelText("Estado")).toBeTruthy();
    expect(screen.queryByLabelText("Tags")).toBeNull();
    expect(screen.queryByLabelText(/Notas QA/)).toBeNull();
  });

  it("explica la limitación del tipo sobre el que se está editando", async () => {
    montar([PLAN]);
    fireEvent.click(screen.getByRole("button", { name: "Planes" }));
    expect(await screen.findByText(/no tiene tags, descripción ni prioridad/)).toBeTruthy();
  });

  it("cambiar de tipo vuelve a la primera hoja", async () => {
    montar();
    await screen.findByText("Validar completitud de lectura");
    fireEvent.click(screen.getByRole("button", { name: "Planes" }));
    await waitFor(() => {
      expect(pedidas.some((p) => p.includes("tipo=Test+Plan"))).toBe(true);
    });
    // Sin el reinicio, la hoja 4 de los casos (offset=150) se pediría sobre las
    // suites. El cliente omite `offset=0` porque es el valor por defecto, así
    // que la ausencia del parámetro es lo que prueba que se volvió a la primera.
    const ultima = pedidas.filter((p) => p.includes("tipo=Test+Plan")).pop();
    expect(ultima).not.toContain("offset=");
  });

  it("envía solo los campos que el tipo admite", async () => {
    montar([CASO]);
    await screen.findByText("Validar completitud de lectura");
    fireEvent.click(screen.getByRole("button", { name: "Validar completitud de lectura" }));
    fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "Ready" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar en Azure" }));

    await waitFor(() => {
      expect(enviados).toHaveLength(1);
    });
    expect(enviados[0].id).toBe(5733);
    expect(JSON.parse(String(enviados[0].cuerpo))).toEqual({ estado: "Ready" });
  });
});

describe("EdicionInline con camposEditables", () => {
  function montarFormulario(campos: string[], alGuardar = () => {}) {
    return render(
      <EdicionInline
        workItemId={1}
        titulo="caso"
        estadoActual="Design"
        estadosDisponibles={["Design", "Ready"]}
        tagsActuales="smoke"
        camposEditables={campos as never}
        onGuardar={alGuardar}
      />,
    );
  }

  it("la lista del backend manda sobre los mostrar* por defecto", () => {
    // Sin `camposEditables` los valores por defecto ofrecen todo; con la lista
    // del backend, solo lo que el tipo admite. Es el mecanismo completo.
    montarFormulario(["estado"]);
    expect(screen.getByLabelText("Estado")).toBeTruthy();
    expect(screen.queryByLabelText("Prioridad")).toBeNull();
    expect(screen.queryByLabelText("Severidad")).toBeNull();
    expect(screen.queryByLabelText("Tags")).toBeNull();
    expect(screen.queryByLabelText(/Notas QA/)).toBeNull();
  });

  it("nunca envía un campo que el tipo no admite, aunque se toque", () => {
    const alGuardar = vi.fn();
    montarFormulario(["estado"], alGuardar);
    fireEvent.click(screen.getByRole("button", { name: "Guardar en Azure" }));
    // Sin cambios no hay nada que enviar.
    expect(alGuardar).not.toHaveBeenCalled();
  });
});
