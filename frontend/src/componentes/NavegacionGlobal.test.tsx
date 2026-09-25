import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { NavegacionGlobal } from "./NavegacionGlobal";

function renderizar(props: Partial<Parameters<typeof NavegacionGlobal>[0]> = {}) {
  const onRefrescar = vi.fn();
  render(
    <NavegacionGlobal
      vista={{ pagina: "dashboard" }}
      configurado
      refrescando={false}
      onRefrescar={onRefrescar}
      {...props}
    />,
  );
  return { onRefrescar };
}

describe("NavegacionGlobal", () => {
  it("muestra solo el acceso global en el dashboard", () => {
    renderizar();

    expect(screen.getByRole("link", { name: /dashboard de épicas/i })).toHaveAttribute(
      "href",
      "#/dashboard",
    );
    expect(screen.getByRole("link", { name: "Épicas" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.queryByRole("link", { name: "Tareas" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Bugs" })).not.toBeInTheDocument();
  });

  it("añade el contexto de la épica en las vistas de detalle", () => {
    renderizar({ vista: { pagina: "epicaBugs", azureId: 5586 } });

    const historias = screen.getByRole("link", { name: "Historias" });
    const tareas = screen.getByRole("link", { name: "Tareas" });
    const bugs = screen.getByRole("link", { name: "Bugs" });

    expect(historias).toHaveAttribute("href", "#/epicas/5586");
    expect(tareas).toHaveAttribute("href", "#/epicas/5586/tareas");
    expect(bugs).toHaveAttribute("href", "#/epicas/5586/bugs");
    expect(bugs).toHaveAttribute("aria-current", "page");
    expect(historias).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Épicas" })).not.toHaveAttribute("aria-current");
  });

  it("dispara el refresco", () => {
    const { onRefrescar } = renderizar();

    fireEvent.click(screen.getByRole("button", { name: "Actualizar" }));

    expect(onRefrescar).toHaveBeenCalledTimes(1);
  });

  it("refleja el estado pendiente y bloquea el doble clic", () => {
    const { onRefrescar } = renderizar({ refrescando: true });

    const boton = screen.getByRole("button", { name: "Actualizando…" });
    expect(boton).toBeDisabled();
    expect(boton).toHaveAttribute("aria-busy", "true");
    fireEvent.click(boton);
    expect(onRefrescar).not.toHaveBeenCalled();
  });

  it("deshabilita el refresco sin Azure configurado", () => {
    renderizar({ configurado: false });

    const boton = screen.getByRole("button", { name: "Actualizar" });
    expect(boton).toBeDisabled();
  });

  it("muestra el error de refresco sin romper la navegación", () => {
    renderizar({ errorRefresco: "Error de red" });

    expect(screen.getByRole("alert")).toHaveTextContent("No se pudo actualizar: Error de red");
    expect(screen.getByRole("link", { name: "Épicas" })).toBeInTheDocument();
  });
});
