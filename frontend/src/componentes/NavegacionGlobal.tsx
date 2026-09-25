import type { Destino } from "../navegacion";
import { enlaceA } from "../navegacion";

/** Enlace de la barra global: etiqueta + destino de hash. */
interface EnlaceGlobal {
  etiqueta: string;
  destino: Destino;
  activo: boolean;
  /** Marca de grupo para separar secciones con un divisor visual. */
  divider?: boolean;
}

function idDeVista(vista: Destino): number | null {
  return "azureId" in vista ? vista.azureId : null;
}

/**
 * Barra de navegación global de la aplicación.
 *
 * Es un componente **presentacional**: recibe la vista activa y el callback de
 * refresco desde `App`, que es quien conecta los hooks de React Query. Así el
 * acceso a épica/historias/tareas/bugs está siempre visible sin duplicar
 * redirecciones "atrás" en cada página.
 */
export function NavegacionGlobal({
  vista,
  configurado,
  refrescando,
  errorRefresco = "",
  onRefrescar,
}: {
  vista: Destino;
  configurado: boolean;
  refrescando: boolean;
  errorRefresco?: string;
  onRefrescar: () => void;
}) {
  const azureId = idDeVista(vista);
  const enlaces: EnlaceGlobal[] = [
    {
      etiqueta: "Épicas",
      destino: { pagina: "dashboard" },
      activo: vista.pagina === "dashboard",
    },
  ];

  if (azureId !== null) {
    enlaces.push(
      {
        etiqueta: "Historias",
        destino: { pagina: "epica", azureId },
        activo: vista.pagina === "epica",
        divider: true,
      },
      {
        etiqueta: "Tareas",
        destino: { pagina: "epicaTareas", azureId },
        activo: vista.pagina === "epicaTareas",
      },
      {
        etiqueta: "Bugs",
        destino: { pagina: "epicaBugs", azureId },
        activo: vista.pagina === "epicaBugs",
      },
    );
  }

  return (
    <header className="barra-superior">
      <div className="barra-superior-fila">
        <a className="marca" href={enlaceA({ pagina: "dashboard" })}>
          <span aria-hidden="true">▶</span> CIA · Dashboard de Épicas
        </a>

        <nav className="navegacion-principal" aria-label="Navegación principal">
          {enlaces.map(({ etiqueta, destino, activo, divider }) => (
            <span className="navegacion-item" key={etiqueta}>
              {divider && (
                <span className="navegacion-separador" aria-hidden="true" />
              )}
              <a
                className="enlace-barra"
                href={enlaceA(destino)}
                aria-current={activo ? "page" : undefined}
              >
                {etiqueta}
              </a>
            </span>
          ))}
        </nav>

        <div className="barra-acciones">
          <button
            type="button"
            className="btn-barra"
            onClick={onRefrescar}
            disabled={!configurado || refrescando}
            aria-busy={refrescando}
            title={
              configurado
                ? "Invalida la caché del backend y vuelve a leer Azure DevOps"
                : "Configura AZURE_ORG_URL, AZURE_PROYECTO y AZURE_PAT para habilitar"
            }
          >
            {refrescando ? "Actualizando…" : "Actualizar"}
          </button>
          <a
            className="enlace-barra"
            href="/api/health"
            title="Estado del proceso backend (JSON)"
          >
            Salud
          </a>
          <a
            className="enlace-barra"
            href="/docs"
            target="_blank"
            rel="noreferrer"
            title="Documentación interactiva de la API"
          >
            API
          </a>
        </div>
      </div>

      {errorRefresco && (
        <p className="barra-error" role="alert">
          No se pudo actualizar: {errorRefresco}
        </p>
      )}
    </header>
  );
}
