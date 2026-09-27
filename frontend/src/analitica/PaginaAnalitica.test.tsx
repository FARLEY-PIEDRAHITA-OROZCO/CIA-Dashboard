import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PaginaAnalitica } from "./PaginaAnalitica";

const BRECHA = {
  resumen: {
    bugs: 143,
    bugs_cerrados_sin_verificar: 136,
    bugs_verificados_sin_cerrar: 2,
    historias: 601,
    historias_sin_evidencia: 410,
    verificados: 0,
    generado: "2026-09-26T12:00:00Z",
  },
  cerrados_sin_verificar: [
    { azure_id: 700, tipo: "Bug", titulo: "Cálculo duplicado", estado: "Closed", sprint: "Sprint 44", persona: "Ana Pérez", modificado: "2026-09-10T08:00:00Z" },
    { azure_id: 701, tipo: "Bug", titulo: "Corte mal aplicado", estado: "Closed", sprint: "Sprint 43", persona: "Luis Gómez", modificado: "2026-09-08T08:00:00Z" },
  ],
  verificados_sin_cerrar: [
    { azure_id: 702, tipo: "Bug", titulo: "Fallo de redondeo", estado: "Active", sprint: "Sprint 45", persona: "Ana Pérez", modificado: "2026-09-12T08:00:00Z" },
  ],
  historias_sin_evidencia: [
    { azure_id: 800, tipo: "User Story", titulo: "Herederos", estado: "Done", sprint: "Sprint 40", persona: "Luis Gómez", modificado: "2026-08-02T08:00:00Z" },
  ],
};

const AGING = {
  resumen: { inactivos: 84, en_curso: 578, dias_inactivo: 14, dias_en_curso: 30, generado: "2026-09-26T12:00:00Z" },
  inactivos: [
    { azure_id: 900, tipo: "Task", titulo: "Migrar contratos", estado: "New", sprint: "Sprint 30", persona: "Ana Pérez", modificado: "2026-08-20T08:00:00Z" },
  ],
  en_curso: [
    { azure_id: 901, tipo: "Task", titulo: "Reconciliación", estado: "Active", sprint: "Sprint 22", persona: "Luis Gómez", modificado: "2026-06-01T08:00:00Z" },
  ],
};

const REZAGO = {
  resumen: {
    sprints: 37,
    sprint_referencia: "Sprint 45",
    sprints_con_rezago: 32,
    rezagados: 594,
    generado: "2026-09-26T12:00:00Z",
  },
  sprints: [
    { sprint: "Sprint 2", abiertos: 41, items: [] },
    { sprint: "Sprint 3", abiertos: 12, items: [] },
  ],
};

/** Stub de las tres señales; `caen` simula un endpoint caído. */
function stubSenales(caen?: "aging" | "rezago") {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: RequestInfo | URL) => {
      const url = String(entrada);
      const clave = url.includes("/analitica/aging")
        ? "aging"
        : url.includes("/analitica/rezago")
          ? "rezago"
          : "brecha";
      if (caen === clave) return new Response("{}", { status: 500 });
      const cuerpo = clave === "aging" ? AGING : clave === "rezago" ? REZAGO : BRECHA;
      return new Response(JSON.stringify(cuerpo), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
}

function envolver(ui: ReactNode) {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={cliente}>{ui}</QueryClientProvider>);
}

const renderPagina = () => envolver(<PaginaAnalitica />);

/** Acota a una tarjeta por su título (las señales comparten cifras y botones). */
async function tarjeta(titulo: RegExp): Promise<HTMLElement> {
  return (await screen.findByRole("heading", { name: titulo })).closest(
    ".senal",
  ) as HTMLElement;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Tarjetas de señal", () => {
  it("muestra una cifra por señal, con su contexto en una frase", async () => {
    stubSenales();
    renderPagina();

    const bugs = await tarjeta(/Bugs cerrados sin verificar/);
    expect(within(bugs).getByText("136")).toBeInTheDocument();
    // El porcentaje es lo que da la cifra: 136 de 143.
    expect(within(bugs).getByText(/95% de 143 bugs/)).toBeInTheDocument();

    const inactivos = await tarjeta(/Sin cambio en más de 14 días/);
    expect(within(inactivos).getByText("84")).toBeInTheDocument();

    const rezago = await tarjeta(/Ítems rezagados/);
    expect(within(rezago).getByText("594")).toBeInTheDocument();
  });

  it("el tono de la cifra avisa del problema sin cambiar el texto", async () => {
    stubSenales();
    renderPagina();

    const bugs = await tarjeta(/Bugs cerrados sin verificar/);
    expect(within(bugs).getByText("136").closest(".senal-numero")).toHaveAttribute(
      "data-tono",
      "alerta",
    );
  });

  it("las listas de ejemplos están cerradas al abrir", async () => {
    stubSenales();
    renderPagina();

    const bugs = await tarjeta(/Bugs cerrados sin verificar/);
    expect(within(bugs).queryByText("Cálculo duplicado")).toBeNull();
    // Pero el botón dice cuántos casos hay detrás.
    expect(within(bugs).getByRole("button", { name: /Ver los 2 casos/ })).toBeInTheDocument();
  });

  it("el botón despliega los ejemplos y los vuelve a ocultar", async () => {
    stubSenales();
    renderPagina();

    const bugs = await tarjeta(/Bugs cerrados sin verificar/);
    fireEvent.click(within(bugs).getByRole("button", { name: /Ver los 2 casos/ }));

    expect(await within(bugs).findByText("Cálculo duplicado")).toBeInTheDocument();
    expect(within(bugs).getByText("Corte mal aplicado")).toBeInTheDocument();

    fireEvent.click(within(bugs).getByRole("button", { name: "Ocultar" }));
    await waitFor(() => expect(within(bugs).queryByText("Cálculo duplicado")).toBeNull());
  });

  it("el botón distingue el tipo de lo que se va a ver", async () => {
    stubSenales();
    renderPagina();

    // Sin esto, dos señales con 2 casos ofrecen un botón idéntico y no se sabe
    // cuál es cuál.
    const rezago = await tarjeta(/Ítems rezagados/);
    expect(within(rezago).getByRole("button", { name: /Ver los 2 sprints/ })).toBeInTheDocument();
  });

  it("cada señal abre su propia lista sin afectar a las demás", async () => {
    stubSenales();
    renderPagina();

    const bugs = await tarjeta(/Bugs cerrados sin verificar/);
    fireEvent.click(within(bugs).getByRole("button", { name: /Ver los 2 casos/ }));
    expect(await within(bugs).findByText("Cálculo duplicado")).toBeInTheDocument();

    // La lista de aging sigue cerrada.
    const inactivos = await tarjeta(/Sin cambio en más de 14 días/);
    expect(within(inactivos).queryByText("Migrar contratos")).toBeNull();
  });

  it("señala las historias sin evidencia con su propio botón", async () => {
    stubSenales();
    renderPagina();

    const historias = await tarjeta(/Historias terminadas sin evidencia/);
    expect(within(historias).getByText("410")).toBeInTheDocument();
    expect(within(historias).getByText(/de 601 historias/)).toBeInTheDocument();

    fireEvent.click(within(historias).getByRole("button", { name: /Ver los 1 caso/ }));
    expect(await within(historias).findByText("Herederos")).toBeInTheDocument();
  });

  it("el rezago despliega el desglose por sprint", async () => {
    stubSenales();
    renderPagina();

    const rezago = await tarjeta(/Ítems rezagados/);
    fireEvent.click(within(rezago).getByRole("button", { name: /Ver los 2 sprints/ }));

    const tabla = await within(rezago).findByRole("table");
    expect(within(tabla).getByRole("rowheader", { name: "Sprint 2" })).toBeInTheDocument();
    expect(within(tabla).getByText("41")).toBeInTheDocument();
  });

  it("el texto del rezago nombra el sprint de referencia", async () => {
    stubSenales();
    renderPagina();

    const rezago = await tarjeta(/Ítems rezagados/);
    expect(within(rezago).getByText(/32 sprints con deuda, de 37 sprints/)).toBeInTheDocument();
    expect(within(rezago).getByText(/referencia Sprint 45/)).toBeInTheDocument();
  });

  it("sin deuda acumulada, el cero se dice con claridad", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (entrada: RequestInfo | URL) => {
        const url = String(entrada);
        const cuerpo = url.includes("/aging")
          ? AGING
          : url.includes("/rezago")
            ? {
                resumen: { sprints: 37, sprint_referencia: "Sprint 45", sprints_con_rezago: 0, rezagados: 0, generado: "" },
                sprints: [],
              }
            : BRECHA;
        return new Response(JSON.stringify(cuerpo), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
    renderPagina();

    expect(
      await screen.findByText(/Ningún sprint anterior dejó trabajo abierto/),
    ).toBeInTheDocument();
  });
});

describe("Aislamiento de fallos", () => {
  it("una señal caída no borra las otras dos", async () => {
    stubSenales("aging");
    renderPagina();

    // La caída reporta su error en su propia tarjeta…
    const caida = await tarjeta(/Trabajo estancado/);
    expect(within(caida).getByText(/No se pudo calcular/)).toBeInTheDocument();
    // …y las otras dos siguen con su cifra.
    const bugs = await tarjeta(/Bugs cerrados sin verificar/);
    expect(within(bugs).getByText("136")).toBeInTheDocument();
    const rezago = await tarjeta(/Ítems rezagados/);
    expect(within(rezago).getByText("594")).toBeInTheDocument();
  });

  it("el fallo del rezago no afecta a la brecha de verificación", async () => {
    stubSenales("rezago");
    renderPagina();

    const caida = await tarjeta(/Rezago entre sprints/);
    expect(within(caida).getByText(/No se pudo calcular/)).toBeInTheDocument();

    const bugs = await tarjeta(/Bugs cerrados sin verificar/);
    expect(within(bugs).getByText("136")).toBeInTheDocument();
    const inactivos = await tarjeta(/Sin cambio en más de 14 días/);
    expect(within(inactivos).getByText("84")).toBeInTheDocument();
  });
});
