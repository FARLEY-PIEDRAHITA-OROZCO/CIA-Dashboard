/** Pruebas del panel de asignación de responsables.
 *
 * Lo que se vigila, por orden de importancia:
 *
 * 1. **Que se pueda asignar y quitar.** Es lo que faltaba: había lectura y
 *    filtros, pero ninguna forma de escribir.
 * 2. **Que el fallo se distinga por código.** 422 es del formulario, 409 es de
 *    otra pestaña, 500 es del fichero del servidor. Decir lo mismo para los tres
 *    manda a la puerta equivocada.
 * 3. **El aviso de git.** El registro es un fichero rastreado: escribir sin
 *    decirlo parece funcionar y no es cierto.
 * 4. **La fecha local.** `toISOString()` desplazaría el día y guardaría la
 *    asignación en la fecha equivocada.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PanelAsignacion } from "./PanelAsignacion";

const PERSONAS = {
  personas: [
    {
      guid: "g-ana",
      nombre: "Ana Diaz",
      es_qa: true,
      es_dev: false,
      forzado: true,
      epicas: 2,
      epicas_qa: 2,
      epicas_dev: 0,
      mas_antigua: "2026-09-01",
      dias_laborables: 18,
      items_backlog: 12,
      bugs: 1,
    },
    {
      guid: "g-luis",
      nombre: "Luis Ruiz",
      es_qa: false,
      es_dev: true,
      forzado: false,
      epicas: 0,
      epicas_qa: 0,
      epicas_dev: 0,
      mas_antigua: "",
      dias_laborables: 0,
      items_backlog: 3,
      bugs: 0,
    },
  ],
  total: 2,
  qa: 1,
  dev: 1,
  sin_rol: 0,
};

const ASIGNACION = {
  epica: 5716,
  titulo: "Buzón de requerimientos",
  titulo_conocido: true,
  persona: "g-ana",
  nombre_persona: "Ana Diaz",
  rol: "qa",
  desde: "2026-09-01",
  dias_laborables: 18,
  nota: "revisó el contrato",
};

const LISTA_VACIA = { asignaciones: [], total: 0, epicas_desconocidas: 0 };

let peticiones: Array<{ metodo: string; url: string; cuerpo: unknown }>;
type Respuesta = { estado: number; cuerpo: unknown };
type Responder = (url: string, metodo: string) => Respuesta;

const POR_DEFECTO: Responder = (url, metodo) => {
  if (url.includes("/api/qa/personas")) return { estado: 200, cuerpo: PERSONAS };
  if (url.includes("/api/qa/asignaciones") && metodo === "PUT")
    return { estado: 200, cuerpo: ASIGNACION };
  if (url.includes("/api/qa/asignaciones") && metodo === "DELETE")
    return { estado: 200, cuerpo: { ok: true, detalle: "Asignación quitada." } };
  if (url.includes("/api/qa/asignaciones"))
    return { estado: 200, cuerpo: { ...LISTA_VACIA, asignaciones: [ASIGNACION], total: 1 } };
  return { estado: 200, cuerpo: {} };
};

/** `responder` se pasa como argumento y no por variable global: si se fijara
 * antes de llamar a `montar`, esta la sobrescribiría y la prueba probaría el
 * camino feliz mientras parecía probar el 409. */
function montar(responder: Responder = POR_DEFECTO) {
  peticiones = [];
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
      peticiones.push({ metodo, url, cuerpo });
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
      <PanelAsignacion epica={5716} titulo="Buzón de requerimientos" />
    </QueryClientProvider>,
  );
}

const guardar = () => fireEvent.click(screen.getByRole("button", { name: /^Asignar$/ }));

/** El panel es una `<section aria-label>`, o sea una `region`, y su etiqueta es
 * única. Consultarlo evita colisionar con el desplegable de rol, que también
 * tiene una opción que se llama «QA». */
const panel = () => screen.getByRole("region", { name: /Responsables de pruebas/ });

/** Elige persona, esperando primero a que el desplegable esté habilitado.
 *
 * Está deshabilitado mientras se cargan las personas, y un `change` sobre un
 * control deshabilitado se ignora en silencio: la prueba pasaría a comprobar
 * otra cosa, o fallaría más tarde por un motivo equivocado. */
async function elegir(guid: string) {
  const select = screen.getByLabelText(/^Persona$/i) as HTMLSelectElement;
  await waitFor(() => expect(select.disabled).toBe(false));
  fireEvent.change(select, { target: { value: guid } });
  await waitFor(() => expect(select.value).toBe(guid));
}

/** Espera a que el panel haya pintado las asignaciones que se le pidieron. */
async function esperarAsignaciones(texto: string) {
  await waitFor(() => expect(panel().textContent).toContain(texto));
}

beforeEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

afterEach(() => cleanup());

describe("panel de asignación", () => {
  it("carga las asignaciones de esa épica, no las de todas", async () => {
    montar();
    await esperarAsignaciones("Ana Diaz");
    const lectura = peticiones.find((p) => p.url.includes("/api/qa/asignaciones"));
    // Filtrar por épica en el servidor: son ~264 filas y aquí solo hacen falta
    // las de una. Mandarlas todas para descartar 260 en el navegador sería
    // gastar red para nada.
    expect(lectura?.url).toContain("epica=5716");
  });

  it("muestra quién está asignado con su rol y sus días", async () => {
    montar();
    await esperarAsignaciones("Ana Diaz");
    const p = panel();
    expect(p.textContent).toContain("QA");
    expect(p.textContent).toContain("desde 2026-09-01");
    expect(p.textContent).toContain("18 d. laborables");
    expect(p.textContent).toContain("revisó el contrato");
  });

  it("un enlace lleva al filtro del dashboard de esa persona", async () => {
    montar();
    const enlace = await screen.findByRole("button", { name: "Ana Diaz" });
    fireEvent.click(enlace);
    await waitFor(() => {
      expect(window.location.hash).toBe("#/dashboard?qa=g-ana");
    });
  });

  it("sin nadie asignado lo dice, en vez de dejar la lista vacía", async () => {
    montar((url) =>
      url.includes("/api/qa/asignaciones")
        ? { estado: 200, cuerpo: LISTA_VACIA }
        : { estado: 200, cuerpo: PERSONAS },
    );
    await esperarAsignaciones("nadie asignado");
  });
});

describe("asignar", () => {
  it("envía la épica, la persona y el rol", async () => {
    montar();
    await esperarAsignaciones("Ana Diaz");
    await elegir("g-luis");
    guardar();
    await waitFor(() => {
      const put = peticiones.find((p) => p.metodo === "PUT");
      expect(put?.cuerpo).toMatchObject({ epica: 5716, persona: "g-luis", rol: "qa" });
    });
  });

  it("el desplegable ordena alfabéticamente y marca el rol", async () => {
    montar();
    await esperarAsignaciones("Ana Diaz");
    const opciones = screen.getAllByRole("option").map((o) => o.textContent);
    // Alfabético, no por volumen: aquí se busca a alguien concreto, no se
    // compara carga. El volumen era la decisión correcta en el filtro.
    expect(opciones[1]).toContain("Ana Diaz · QA");
    expect(opciones[2]).toContain("Luis Ruiz · dev");
  });

  it("ofrece a quienes no tienen ninguna épica", async () => {
    montar();
    await esperarAsignaciones("Ana Diaz");
    // Luis tiene 0 épicas y sigue saliendo: es justo a quien hay que poder
    // asignarle la primera.
    expect(screen.getByRole("option", { name: /Luis Ruiz/ })).toBeTruthy();
  });

  it("no permite guardar sin elegir persona", async () => {
    montar();
    await esperarAsignaciones("Ana Diaz");
    expect(screen.getByRole("button", { name: /^Asignar$/ })).toHaveProperty("disabled", true);
    const antes = peticiones.length;
    guardar();
    expect(peticiones).toHaveLength(antes);
  });

  it("la fecha por defecto es hoy en local, no en UTC", async () => {
    montar();
    await esperarAsignaciones("Ana Diaz");
    await elegir("g-luis");
    guardar();
    await waitFor(() => {
      const put = peticiones.find((p) => p.metodo === "PUT");
      // `toISOString()` daría el día siguiente en una zona negativa: la
      // asignación se guardaría un día desplazada y nadie lo notaría hasta
      // contar los días laborables más tarde.
      const esperado = new Date();
      const mes = String(esperado.getMonth() + 1).padStart(2, "0");
      const dia = String(esperado.getDate()).padStart(2, "0");
      expect(put?.cuerpo).toMatchObject({ desde: `${esperado.getFullYear()}-${mes}-${dia}` });
    });
  });

  it("limpia el formulario tras guardar", async () => {
    montar();
    await esperarAsignaciones("Ana Diaz");
    await elegir("g-luis");
    guardar();
    await waitFor(() => {
      expect((screen.getByLabelText(/^Persona$/) as HTMLSelectElement).value).toBe("");
    });
  });
});

describe("quitar", () => {
  it("envía épica, persona y rol de esa fila", async () => {
    montar();
    fireEvent.click(await screen.findByRole("button", { name: /Quitar a Ana Diaz/ }));
    await waitFor(() => {
      const del = peticiones.find((p) => p.metodo === "DELETE");
      expect(del?.url).toContain("/api/qa/asignaciones/5716/g-ana/qa");
    });
  });

  it("el botón de quitar dice a quién quita y de qué", async () => {
    // «Quitar» a secas en una lista de varias filas es ambiguo para un lector
    // de pantalla, que oye el mismo nombre en todos los botones.
    montar();
    const boton = await screen.findByRole("button", { name: /Quitar a Ana Diaz como QA/ });
    expect(boton).toBeTruthy();
  });
});

describe("fallos, uno por código", () => {
  /** Responder que solo falla en el PUT, para que la carga inicial siga bien. */
  const fallaEnPut = (estado: number, detalle: string): Responder =>
    (url, metodo) => {
      if (metodo === "PUT") return { estado, cuerpo: { detail: detalle } };
      if (url.includes("/api/qa/asignaciones")) return { estado: 200, cuerpo: LISTA_VACIA };
      return { estado: 200, cuerpo: PERSONAS };
    };

  it("409 dice que no se perdió nada", async () => {
    montar(fallaEnPut(409, "El registro cambió en disco."));
    await esperarAsignaciones("nadie asignado");
    await elegir("g-luis");
    guardar();
    const alerta = await screen.findByRole("alert");
    expect(alerta.textContent).toMatch(/no se perdió nada/i);
    expect(alerta.textContent).toMatch(/recarga/i);
  });

  it("422 muestra el detalle, que es lo que hay que corregir", async () => {
    montar(fallaEnPut(422, "Ese GUID no existe en el proyecto."));
    await esperarAsignaciones("nadie asignado");
    await elegir("g-luis");
    guardar();
    expect((await screen.findByRole("alert")).textContent).toMatch(/ese GUID no existe/i);
  });

  it("500 dice que es del servidor, no del formulario", async () => {
    montar(fallaEnPut(500, "El JSON del registro está corrupto."));
    await esperarAsignaciones("nadie asignado");
    await elegir("g-luis");
    guardar();
    const alerta = await screen.findByRole("alert");
    expect(alerta.textContent).toMatch(/servidor/i);
    // El consejo del 409 («recarga y repite») sería inútil aquí: recargar no
    // arregla un fichero corrupto.
    expect(alerta.textContent).not.toMatch(/recarga.*repite/i);
  });

  it("un fallo al quitar también se explica", async () => {
    montar((url, metodo) => {
      if (metodo === "DELETE") return { estado: 409, cuerpo: { detail: "cambió" } };
      if (url.includes("/api/qa/asignaciones"))
        return { estado: 200, cuerpo: { ...LISTA_VACIA, asignaciones: [ASIGNACION], total: 1 } };
      return { estado: 200, cuerpo: PERSONAS };
    });
    fireEvent.click(await screen.findByRole("button", { name: /Quitar a Ana Diaz/ }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/no se perdió nada/i);
  });
});

describe("el aviso que no es opcional", () => {
  it("dice que el registro está en git y hay que commitear", async () => {
    montar();
    await esperarAsignaciones("Ana Diaz");
    const texto = panel().textContent ?? "";
    expect(texto).toMatch(/rastreado en git/i);
    expect(texto).toMatch(/git commit/);
  });

  it("un alta hoy se dice «hoy», no «hace 0 días»", async () => {
    montar((url) => {
      if (url.includes("/api/qa/asignaciones"))
        return {
          estado: 200,
          cuerpo: {
            ...LISTA_VACIA,
            total: 1,
            asignaciones: [{ ...ASIGNACION, desde: "2026-09-27", dias_laborables: 0 }],
          },
        };
      return { estado: 200, cuerpo: PERSONAS };
    });
    await esperarAsignaciones("Ana Diaz");
    // Un 0 al lado de una fecha se lee como «falta el dato», no como «hoy».
    expect(panel().textContent).toContain("(hoy)");
  });
});


describe("depurga", () => {
  it("que elemento devuelve getByLabelText", async () => {
    montar();
    await esperarAsignaciones("Ana Diaz");
    const el = screen.getByLabelText(/^Persona$/);
    console.log("tagname>>>", el.tagName, "id>>>", el.getAttribute("id"));
    console.log("selects>>>", document.querySelectorAll("select").length);
    console.log("labels>>>", document.querySelectorAll("label").length);
    fireEvent.change(el, { target: { value: "g-luis" } });
    console.log("tras change, value>>>", (el as HTMLSelectElement).value);
    console.log("boton disabled>>>", (screen.getByRole("button", { name: /^Asignar$/ }) as HTMLButtonElement).disabled);
  });
});