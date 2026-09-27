import { useEffect } from "react";

import { PaginaAnalitica } from "./analitica/PaginaAnalitica";
import { NavegacionGlobal } from "./componentes/NavegacionGlobal";
import { PaginaBugs } from "./epicas/PaginaBugs";
import { PaginaEpica } from "./epicas/PaginaEpica";
import { PaginaTareas } from "./epicas/PaginaTareas";
import { useEstadoAzure, useRefrescar } from "./epicas/hooks";
import { useVista } from "./navegacion";
import Dashboard from "./pages/Dashboard";
import { PaginaPruebas } from "./pruebas/PaginaPruebas";
import { PaginaSprints } from "./sprints/PaginaSprints";

export default function App() {
  const vista = useVista();
  const azureId = "azureId" in vista ? vista.azureId : null;

  // La barra global es el único punto que conecta los hooks de datos:
  // el componente de navegación es presentacional.
  const estadoIntegracion = useEstadoAzure();
  const refrescar = useRefrescar();
  const configurado = Boolean(estadoIntegracion.data?.configurada);
  const errorRefresco = refrescar.isError
    ? refrescar.error instanceof Error
      ? refrescar.error.message
      : String(refrescar.error)
    : "";

  useEffect(() => {
    document.querySelector<HTMLElement>("main h1")?.focus();
  }, [vista.pagina, azureId]);

  return (
    <>
      <NavegacionGlobal
        vista={vista}
        configurado={configurado}
        refrescando={refrescar.isPending}
        errorRefresco={errorRefresco}
        onRefrescar={() => refrescar.mutate()}
      />
      <main className="contenido">
        {vista.pagina === "epica" ? (
          <PaginaEpica key={vista.azureId} azureId={vista.azureId} />
        ) : vista.pagina === "epicaTareas" ? (
          <PaginaTareas key={vista.azureId} azureId={vista.azureId} />
        ) : vista.pagina === "epicaBugs" ? (
          <PaginaBugs key={vista.azureId} azureId={vista.azureId} />
        ) : vista.pagina === "sprints" ? (
          <PaginaSprints
            filtros={vista.filtros}
            hoja={vista.hoja}
            desplegado={vista.desplegado}
          />
        ) : vista.pagina === "pruebas" ? (
          <PaginaPruebas filtro={vista.filtro} hoja={vista.hoja} />
        ) : vista.pagina === "analitica" ? (
          <PaginaAnalitica />
        ) : (
          <Dashboard />
        )}
      </main>
    </>
  );
}
