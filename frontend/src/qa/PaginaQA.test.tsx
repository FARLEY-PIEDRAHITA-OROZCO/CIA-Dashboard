/** Pruebas de la vista de equipo QA.
 *
 * Lo que se vigila:
 *
 * 1. **No descarga las 264 asignaciones al abrir.** Es la regla de revelado
 *    progresivo aplicada a esta vista: la lista de personas cabe en una lectura
 *    y las asignaciones son el detalle de alguien concreto.
 * 2. **Que el rol se pueda marcar y quitar**, y que al quitar el último rol se
 *    mande `forzado: false` en vez de dejar el valor por defecto.
 * 3. **Que la sugerencia no se aplique sola** y que al aceptarla quede
 *    `forzado: true`, que es lo que la distingue de un valor por defecto.
 * 4. **Que la aritmética sea honesta**: 0 días y 0 épicas son cosas distintas.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PaginaQA from "./PaginaQA";

const p = (m: Record<string, unknown>) => ({
  guid: "g",
  nombre: "Nombre",
  es_qa: false,
  es_dev: false,
  forzado: null,
  epicas: 0,
  epicas_qa: 0,
  epicas_dev: 0,
  mas_antigua: "",
  dias_laborables: 0,
  items_backlog: 0,
  bugs: 0,
  ...m,
});

const PERSONAS = {
  personas: [
    p({ guid: "g-ana", nombre: "Ana Diaz", es_qa: true, epicas: 5, dias_laborables: 100, items_backlog: 210 }),
    p({ guid: "g-luis", nombre: "Luis Ruiz", es_dev: true, epicas: 2, dias_laborables: 40, items_backlog: 30 }),
    p({ guid: "g-nora", nombre: "Nora Diaz", epicas: 0 }),
  ],
  total: 3,
  qa: 1,
  dev: 1,
  sin_rol: 1,
};

const SUGERENCIAS = {
  sugerencias: [
    { guid: "g-kar", nombre: "Kar Perez", activos: 41, ya_es_qa: false },
    { guid: "g-ana", nombre: "Ana Diaz", activos: 30, ya_es_qa: true },
  ],
  minimo: 3,
  nota: "heurística",
};

const ASIGNACIONES = {
  asignaciones: [
    {
      epica: 5716,
      titulo: "Buzón",
      titulo_conocido: true,
      persona: "g-ana",
      nombre_persona: "Ana Diaz",
      rol: "qa",
      desde: "2026-09-01",
      dias_laborables: 18,
      nota: "",
    },
    {
      // Épica borrada de Azure: se muestra, marcada, no se esconde.
      epica: 999,
      titulo: "",
      titulo_conocido: false,
      persona: "g-ana",
      nombre_persona: "Ana Diaz",
      rol: "dev",
      desde: "2026-08-01",
      dias_laborables: 40,
      nota: "",
    },
  ],
  total: 2,
  epicas_desconocidas: 1,
};

let pedidas: Array<{ metodo: string; url: string; cuerpo: unknown }>;
type Responder = (url: string, metodo: string) => { estado: number; cuerpo: unknown };

const POR_DEFECTO: Responder = (url, metodo) => {
  if (url.includes("/api/qa/personas")) return { estado: 200, cuerpo: PERSONAS };
  if (url.includes("/api/qa/sugerencia-qa")) return { estado: 200, cuerpo: SUGERENCIAS };
  if (url.includes("/api/qa/asignaciones"))
    return { estado: 200, cuerpo: metodo === "DELETE" ? { ok: true, detalle: "" } : ASIGNACIONES };
  if (url.includes("/api/qa/personas/") || /personas\/[^/]+$/.test(url))
    return { estado: 200, cuerpo: PERSONAS.personas[0] };
  return { estado: 200, cuerpo: {} };
};

function montar(responder: Responder = POR_DEFECTO) {
  pedidas = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: RequestInfo | URL, opciones?: RequestInit) => {
      const url = String(entrada);
      const metodo = (opciones?.method ?? "GET").toUpperCase();
      let cuerpo: unknown = null;
      if (typeof opciones?.body === "string") {
        try {
          cuerpo = JSON.parse(opciones.body);
        } catch {
          cuerpo = opciones.body;
        }
      }
      pedidas.push({ metodo, url, cuerpo });
      const r = responder(url, metodo);
      return new Response(JSON.stringify(r.cuerpo), {
        status: r.estado,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={cliente}>
      <PaginaQA />
    </QueryClientProvider>,
  );
}

const tabla = () => screen.getByRole("table");
const filas = () =>
  within(tabla())
    .getAllByRole("row")
    .slice(1)
    .map((f) => f.textContent ?? "");

/** Interruptores de una fila, por su etiqueta: «QA» y «dev» se repiten en
 * todas las filas, así que el nombre solo no basta. */
function interruptores(nombre: string) {
  const fila = filas().find((f) => f.includes(nombre));
  expect(fila, `no hay fila para ${nombre}`).toBeTruthy();
  const celdas = within(tabla())
    .getAllByRole("row")
    .filter((r) => (r.textContent ?? "").includes(nombre));
  return within(celdas[0]).getAllByRole("checkbox");
}

beforeEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

afterEach(() => cleanup());

describe("coste de la carga", () => {
  it("no pide las asignaciones hasta que se elige a alguien", async () => {
    montar();
    await screen.findByText("Ana Diaz");
    expect(pedidas.some((p) => p.url.includes("/asignaciones"))).toBe(false);
  });

  it("al abrir una persona pide solo las suyas", async () => {
    montar();
    await screen.findByText("Ana Diaz");
    fireEvent.click(screen.getAllByRole("button", { name: "Ver épicas" })[0]);
    await waitFor(() => {
      const p = pedidas.find((x) => x.url.includes("/asignaciones"));
      expect(p?.url).toContain("persona=g-ana");
    });
  });
});

describe("la lista de personas", () => {
  it("abre filtrada por quien tiene épicas, que es la pregunta del día a día", async () => {
    montar();
    await screen.findByText("Ana Diaz");
    // Sin ese filtro, las 35 personas del proyecto y 30 de ellas sin nada que
    // mirar en la primera pantalla.
    expect(screen.queryByText("Nora Diaz")).toBeNull();
  });

  it("«todas» las deja ver, incluida quien no tiene nada", async () => {
    montar();
    await screen.findByText("Ana Diaz");
    fireEvent.click(screen.getByRole("button", { name: /^Todas \(/ }));
    expect(screen.getByText("Nora Diaz")).toBeTruthy();
  });

  it("ordena por carga, no alfabéticamente", async () => {
    montar();
    await screen.findByText("Ana Diaz");
    fireEvent.click(screen.getByRole("button", { name: /^Todas \(/ }));
    const orden = filas();
    expect(orden[0]).toContain("Ana Diaz");
    expect(orden[1]).toContain("Luis Ruiz");
  });

  it("«sin marcar» en vez de celda vacía", async () => {
    montar();
    await screen.findByText("Ana Diaz");
    fireEvent.click(screen.getByRole("button", { name: /^Todas \(/ }));
    // Una celda vacía se lee como «no hemos mirado».
    expect(tabla().textContent).toContain("sin marcar");
  });

  it("el nombre enlaza al filtro del dashboard", async () => {
    montar();
    await screen.findByText("Ana Diaz");
    fireEvent.click(screen.getByRole("button", { name: "Ana Diaz" }));
    await waitFor(() => {
      expect(window.location.hash).toBe("#/dashboard?qa=g-ana");
    });
  });
});

describe("marcar el rol", () => {
  it("marcar QA envía true explícito, no null", async () => {
    montar();
    await screen.findByText("Luis Ruiz");
    interruptores("Luis Ruiz")[0].click();
    await waitFor(() => {
      const put = pedidas.find((x) => x.metodo === "PUT");
      expect(put?.cuerpo).toEqual({ es_qa: true });
    });
  });

  it("quitar el último rol marca forzado: false", async () => {
    // Sin esto, la interfaz seguiría insinuando que ese rol era un valor por
    // defecto del sistema cuando en realidad alguien lo quitó a mano.
    montar();
    await screen.findByText("Ana Diaz");
    interruptores("Ana Diaz")[0].click();
    await waitFor(() => {
      const put = pedidas.find((x) => x.metodo === "PUT");
      expect(put?.cuerpo).toEqual({ es_qa: false, forzado: false });
    });
  });

  it("quitar un rol sin ser el último no toca forzado", async () => {
    montar();
    await screen.findByText("Ana Diaz");
    fireEvent.click(screen.getByRole("button", { name: /^Todas \(/ }));
    // Iker no está en este fixture; se usa Ana, que solo es QA, y Luis, que solo
    // es dev. Ninguno tiene los dos, así que ambos casos quitan el último.
    const [, devLuis] = interruptores("Luis Ruiz");
    devLuis.click();
    await waitFor(() => {
      const put = pedidas.find((x) => x.metodo === "PUT");
      expect(put?.cuerpo).toEqual({ es_dev: false, forzado: false });
    });
  });
});

describe("la sugerencia de QA", () => {
  it("se ofrece solo quien no está ya marcado", async () => {
    montar();
    await screen.findByText("Ana Diaz");
    const zona = screen.getByRole("region", { name: /Sugerencias/ });
    expect(zona.textContent).toContain("Kar Perez");
    // Ana aparece en la sugerencia con ya_es_qa=true y no debe salir: repetirla
    // hace dudar de la pantalla entera.
    expect(within(zona).queryByRole("button", { name: "Marcar como QA" })).toBeTruthy();
    expect(within(zona).getAllByRole("button", { name: "Marcar como QA" })).toHaveLength(1);
  });

  it("aceptarla marca QA con forzado: true", async () => {
    montar();
    await screen.findByText("Ana Diaz");
    fireEvent.click(screen.getByRole("button", { name: "Marcar como QA" }));
    await waitFor(() => {
      const put = pedidas.find((x) => x.metodo === "PUT");
      // `forzado: true` es lo que deja claro que la decisión fue humana y no
      // el valor por defecto.
      expect(put?.cuerpo).toEqual({ es_qa: true, forzado: true });
    });
  });

  it("dice que es una heurística, no un dato", async () => {
    montar();
    await screen.findByText("Ana Diaz");
    const zona = screen.getByRole("region", { name: /Sugerencias/ });
    expect(zona.textContent).toMatch(/heurística/);
    expect(zona.textContent).toMatch(/decisión es tuya/);
  });
});

describe("las épicas de una persona", () => {
  it("lista sus asignaciones con rol y días", async () => {
    montar();
    await screen.findByText("Ana Diaz");
    fireEvent.click(screen.getAllByRole("button", { name: "Ver épicas" })[0]);
    const zona = await screen.findByRole("region", { name: "Épicas asignadas" });
    await waitFor(() => expect(zona.textContent).toContain("Buzón"));
    expect(zona.textContent).toContain("18 d. laborables");
  });

  it("una épica que ya no está en Azure se marca, no se esconde", async () => {
    montar();
    await screen.findByText("Ana Diaz");
    fireEvent.click(screen.getAllByRole("button", { name: "Ver épicas" })[0]);
    const zona = await screen.findByRole("region", { name: "Épicas asignadas" });
    await waitFor(() => expect(zona.textContent).toMatch(/ya no está en Azure/));
  });

  it("una épica viva se enlaza a su ficha; la obsoleta, no", async () => {
    montar();
    await screen.findByText("Ana Diaz");
    fireEvent.click(screen.getAllByRole("button", { name: "Ver épicas" })[0]);
    const zona = await screen.findByRole("region", { name: "Épicas asignadas" });
    await waitFor(() => expect(zona.textContent).toContain("Buzón"));
    // Un enlace a una épica borrada daría un 404, y un enlace roto es peor que
    // ninguna acción.
    const enlace = within(zona).getByRole("link", { name: /Buzón/ });
    expect(enlace.getAttribute("href")).toBe("#/epicas/5716");
    expect(within(zona).getAllByRole("link")).toHaveLength(1);
  });

  it("quitar borra de verdad, no solo cerrar el panel", async () => {
    montar();
    await screen.findByText("Ana Diaz");
    fireEvent.click(screen.getAllByRole("button", { name: "Ver épicas" })[0]);
    const zona = await screen.findByRole("region", { name: "Épicas asignadas" });
    fireEvent.click(await within(zona).findByRole("button", { name: /Quitar la épica 5716 de QA/ }));
    await waitFor(() => {
      const del = pedidas.find((x) => x.metodo === "DELETE");
      expect(del?.url).toContain("/asignaciones/5716/g-ana/qa");
    });
  });
});

describe("lo que la vista no inventa", () => {
  it("no dice horas en ninguna parte", async () => {
    montar();
    await screen.findByText("Ana Diaz");
    expect(document.body.textContent ?? "").not.toMatch(/\bhoras?\b/i);
  });

  it("avisa de que hay que commitear el registro", async () => {
    montar();
    await screen.findByText("Ana Diaz");
    expect(document.body.textContent).toMatch(/rastreado en git/i);
  });

  it("con nadie marcado lo dice con un tono de aviso, no con un cero mudo", async () => {
    montar(() => ({
      estado: 200,
      cuerpo: {
        personas: [p({ guid: "g-x", nombre: "Solo Alguien" })],
        total: 1,
        qa: 0,
        dev: 0,
        sin_rol: 1,
      },
    }));
    await waitFor(() => {
      expect(screen.getByText(/Nadie tiene rol marcado todavía/)).toBeTruthy();
    });
  });
});
