/** Estados de retroalimentación reutilizables (carga, error, vacío). */

export function Cargando({ texto = "Cargando…" }: { texto?: string }) {
  return (
    <div className="aviso aviso-info" role="status">
      <span className="spinner" aria-hidden="true" />
      {texto}
    </div>
  );
}

export function ErrorAlerta({ mensaje }: { mensaje: string }) {
  return (
    <div className="aviso aviso-error" role="alert">
      {mensaje}
    </div>
  );
}

export function CajaVacia({ mensaje }: { mensaje: string }) {
  return (
    <div className="aviso aviso-vacio" role="status">
      {mensaje}
    </div>
  );
}