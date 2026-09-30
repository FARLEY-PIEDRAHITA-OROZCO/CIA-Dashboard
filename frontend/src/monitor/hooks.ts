/** Hook del monitor de llamadas a Azure.
 *
 * Sin `refetchInterval` a propósito: con él, `isPending` permanece true incluso
 * cuando ya hay datos, porque React Query considera que sigue "cargando" en
 * segundo plano. La página decide cuándo refrescar.
 *
 * `null` cuando el monitor está apagado, y no un estado con ceros: un contador a
 * cero apagado parece «todo va bien», que es justo lo que no está pasando.
 */
import { useQuery } from "@tanstack/react-query";

import { api } from "../api/cliente";

export const CLAVES_MONITOR = {
  azure: ["monitor", "azure"] as const,
};

export function useMonitorAzure() {
  return useQuery({
    queryKey: CLAVES_MONITOR.azure,
    queryFn: ({ signal }) => api.monitorAzure(signal),
    // Sin staleTime: el monitor cambia con cada llamada a Azure, así que no
    // tiene sentido considerar el estado fresco. Lo que importa es que la
    // página lo pida cuando quiera verlo.
    staleTime: 0,
  });
}
