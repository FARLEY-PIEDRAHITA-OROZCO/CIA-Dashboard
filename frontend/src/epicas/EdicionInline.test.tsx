import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ActualizacionQA } from "../api/tipos";
import { EdicionInline, TAGS_QA } from "./EdicionInline";

const base = {
  workItemId: 10,
  titulo: "Error de validación",
  estadoActual: "Active",
  prioridadActual: "1",
  severidadActual: "Critical",
  tagsActuales: "",
  onGuardar: vi.fn(),
};

describe("EdicionInline", () => {
  it("solo emite los campos que el usuario cambió", () => {
    const onGuardar = vi.fn();
    render(<EdicionInline {...base} onGuardar={onGuardar} />);

    fireEvent.change(screen.getByLabelText(/^Estado/), { target: { value: "Closed" } });
    fireEvent.click(screen.getByRole("button", { name: /Guardar en Azure/i }));

    expect(onGuardar).toHaveBeenCalledWith({ estado: "Closed" });
  });

  it("no emite nada si el valor vuelve al original", () => {
    const onGuardar = vi.fn();
    render(<EdicionInline {...base} onGuardar={onGuardar} />);

    fireEvent.change(screen.getByLabelText(/^Estado/), { target: { value: "New" } });
    fireEvent.change(screen.getByLabelText(/^Estado/), { target: { value: "Active" } });
    fireEvent.click(screen.getByRole("button", { name: /Guardar en Azure/i }));

    expect(onGuardar).not.toHaveBeenCalled();
  });

  it("el botón guardar permanece deshabilitado sin cambios", () => {
    render(<EdicionInline {...base} />);
    expect(screen.getByRole("button", { name: /Guardar en Azure/i })).toBeDisabled();
  });

  it("alterna los tags QA sugeridos", () => {
    const onGuardar = vi.fn();
    render(<EdicionInline {...base} onGuardar={onGuardar} />);

    fireEvent.click(screen.getByRole("button", { name: TAGS_QA[0] }));
    fireEvent.click(screen.getByRole("button", { name: TAGS_QA[2] }));
    fireEvent.click(screen.getByRole("button", { name: /Guardar en Azure/i }));

    const [cambios] = onGuardar.mock.calls[0] as [ActualizacionQA];
    expect(cambios.tags).toBe(`${TAGS_QA[0]}, ${TAGS_QA[2]}`);
  });

  it("elimina un tag ya presente al volver a pulsarlo", () => {
    const onGuardar = vi.fn();
    render(
      <EdicionInline
        {...base}
        tagsActuales="bloqueado"
        onGuardar={onGuardar}
      />,
    );

    const chip = screen.getByRole("button", { name: "bloqueado" });
    expect(chip).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(chip);
    fireEvent.click(screen.getByRole("button", { name: /Guardar en Azure/i }));

    const [cambios] = onGuardar.mock.calls[0] as [ActualizacionQA];
    expect(cambios.tags).toBe("");
  });

  it("permite validar sin guardar", () => {
    const onValidar = vi.fn();
    render(<EdicionInline {...base} onValidar={onValidar} />);

    fireEvent.change(screen.getByLabelText(/^Estado/), { target: { value: "Closed" } });
    fireEvent.click(screen.getByRole("button", { name: /Validar sin guardar/i }));

    expect(onValidar).toHaveBeenCalledWith({ estado: "Closed" });
  });

  it("envía las notas QA como campo separado", () => {
    const onGuardar = vi.fn();
    render(<EdicionInline {...base} onGuardar={onGuardar} />);

    fireEvent.change(screen.getByLabelText(/Notas QA/i), {
      target: { value: "Reproducido en Chrome 141" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Guardar en Azure/i }));

    expect(onGuardar).toHaveBeenCalledWith({ notas_qa: "Reproducido en Chrome 141" });
  });

  it("muestra el error de la mutación sin cerrar el formulario", () => {
    render(<EdicionInline {...base} error="TF401321: transición no válida" />);

    expect(screen.getByRole("alert")).toHaveTextContent("TF401321");
    expect(screen.getByRole("form", { name: /Editar Error de validación/i })).toBeInTheDocument();
  });

  it("deshabilita las acciones mientras guarda", () => {
    render(<EdicionInline {...base} guardando />);

    const boton = screen.getByRole("button", { name: "Guardando…" });
    expect(boton).toBeDisabled();
  });

  it("explica el modo solo lectura en lugar de ofrecer guardar", () => {
    render(<EdicionInline {...base} habilitado={false} />);

    expect(screen.getByRole("note")).toHaveTextContent(/ESCRITURA_HABILITADA/);
    expect(screen.queryByRole("form", { name: /Editar/i })).not.toBeInTheDocument();
  });

  it("ofrece el selector de estados cuando se proporcionan", () => {
    render(<EdicionInline {...base} estadosDisponibles={["New", "Active", "Closed"]} />);

    const selector = screen.getByLabelText(/^Estado/);
    expect(selector.tagName).toBe("SELECT");
    expect(within(selector).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "— sin cambios —",
      "New",
      "Active",
      "Closed",
    ]);
  });
});
