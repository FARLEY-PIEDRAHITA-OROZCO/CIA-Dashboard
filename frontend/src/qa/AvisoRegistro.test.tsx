/** Pruebas del aviso de almacenamiento del registro.
 *
 * Este componente reemplazó a un texto que decía «haz `git commit`». Ese texto
 * era verdad cuando el registro estaba versionado y dejó de serlo al sacarlo de
 * git, así que mantenerlo habría sido **mentirle al usuario desde su propia
 * pantalla**: leería que su dato está a salvo y no lo comprobaría.
 *
 * Por eso las pruebas van en dos direcciones: que diga la verdad en cada estado
 * del respaldo, y que no vuelva a hablar de git.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AvisoRegistro } from "./AvisoRegistro";

const RUTA = "C:\\Dev\\Projects\\CIA-Dashboard\\backend\\datos\\asignaciones.json";

function estado(over: Partial<typeof BASE> = {}) {
  return { ...BASE, ...over };
}

const BASE = {
  ruta: RUTA,
  copia_configurada: true,
  copia_ruta: "D:\\respaldo\\asignaciones.json",
  copia_activa: true,
  ultima_copia: "2026-09-28T10:00:00Z",
  aviso: "",
};

let pedidas: string[];
let cuerpo: unknown;

const AVISO_SIN_COPIA =
  "No hay copia de seguridad configurada. Si este equipo se reinstala o se " +
  "pierde el disco, las asignaciones se pierden: Azure no las conoce. " +
  "Define REGISTRO_COPIA_RUTA en el .env.";

function montar(over: Partial<typeof BASE> = {}) {
  pedidas = [];
  cuerpo = estado(over);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: RequestInfo | URL) => {
      pedidas.push(String(entrada));
      return new Response(JSON.stringify(cuerpo), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={cliente}>
      <AvisoRegistro />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => cleanup());

describe("sin copia configurada", () => {
  it("avisa de que el dato no tiene respaldo", async () => {
    montar({ copia_configurada: false, copia_activa: false, copia_ruta: "", aviso: AVISO_SIN_COPIA });
    const aviso = await screen.findByRole("status");
    expect(aviso.textContent).toMatch(/no tienen copia de seguridad/i);
  });

  it("nombra la consecuencia, no solo la ausencia", async () => {
    // «No hay copia» no dice nada. Lo que hay que saber es qué pasa si no la hay.
    montar({ copia_configurada: false, copia_activa: false, copia_ruta: "", aviso: AVISO_SIN_COPIA });
    const aviso = await screen.findByRole("status");
    expect(aviso.textContent).toMatch(/se pierde/i);
    expect(aviso.textContent).toMatch(/Azure no las conoce/i);
  });

  it("no es un error: se puede trabajar igual, solo hay que saberlo", async () => {
    montar({ copia_configurada: false, copia_activa: false, copia_ruta: "", aviso: AVISO_SIN_COPIA });
    // `status` y no `alert`: no se ha roto nada, se está avisando de un riesgo.
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("con la copia configurada pero rota", () => {
  it("lo dice como error, con la ruta del origen", async () => {
    montar({
      copia_activa: false,
      aviso: "La copia de seguridad NO se está escribiendo: la carpeta no existe.",
    });
    const alerta = await screen.findByRole("alert");
    expect(alerta.textContent).toMatch(/no está funcionando/i);
    expect(alerta.textContent).toContain(RUTA);
  });

  it("distingue «la copia falló» de «el registro falló»", async () => {
    montar({ copia_activa: false, aviso: "fallo" });
    const alerta = await screen.findByRole("alert");
    // Si alguien leyera «no se pudo guardar» pensaría que la asignación se
    // perdió, y la verdad es que el registro principal sí la tiene.
    expect(alerta.textContent).toMatch(/sí se guardó/i);
  });

  it("dice que sin copia se perderían las asignaciones", async () => {
    montar({ copia_activa: false, aviso: "fallo" });
    const alerta = await screen.findByRole("alert");
    expect(alerta.textContent).toMatch(/pierde las asignaciones/i);
  });
});

describe("con la copia funcionando", () => {
  it("no lanza ningún aviso: es silencioso si funciona", async () => {
    montar();
    await waitFor(() => expect(pedidas).toHaveLength(1));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("aun así dice dónde está el dato", async () => {
    // Una línea discreta no es ruido: «¿dónde está mi información?» es
    // información legítima, y es lo que evita que alguien busque el fichero.
    montar();
    const texto = await waitFor(() => {
      const p = document.querySelector(".nota-actividad");
      expect(p).toBeTruthy();
      return p as HTMLElement;
    });
    expect(texto.textContent).toContain(RUTA);
    expect(texto.textContent).toMatch(/copia de seguridad activa/i);
  });

  it("no hay nada que mostrar antes de saber, y no inventa texto", async () => {
    // Un panel con un texto cualquiera sería peor que esperar la respuesta.
    montar();
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <AvisoRegistro activo={false} />
      </QueryClientProvider>,
    );
    expect(container.textContent).toBe("");
  });
});

describe("la mentira que este componente sustituye", () => {
  it("no vuelve a hablar de git", async () => {
    // El registro ya NO está en git. Decirlo sería un aviso que miente, y quien
    // lo lee dejaría de comprobar la copia por confiar en un texto falso.
    montar({ copia_configurada: false, copia_activa: false, copia_ruta: "", aviso: AVISO_SIN_COPIA });
    await screen.findByRole("status");
    const texto = document.body.textContent ?? "";
    expect(texto).not.toMatch(/git commit/i);
    expect(texto).not.toMatch(/rastreado en git/i);
  });

  it("el texto viene del backend, no está escrito en el componente", async () => {
    // Si el backend dice otra cosa, se muestra otra cosa. Es lo que permite que
    // el mensaje cambie sin que haya que acordarse de cambiarlo aquí.
    montar({ copia_configurada: false, copia_activa: false, aviso: "TEXTO DEL BACKEND" });
    expect((await screen.findByRole("status")).textContent).toContain("TEXTO DEL BACKEND");
  });
});
