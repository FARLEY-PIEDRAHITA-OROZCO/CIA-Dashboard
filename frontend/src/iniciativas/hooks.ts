/** Hook para obtener la carpeta de una iniciativa. */

import { useQuery } from "@tanstack/react-query";

import { api } from "../api/cliente";

export function useIniciativaCarpeta(epicaId: number) {
  return useQuery({
    queryKey: ["iniciativa", "carpeta", epicaId],
    queryFn: async () => {
      const data = await api.listarIniciativas();
      return (
        data.iniciativas.find((i) => i.epica_id === epicaId) ?? null
      );
    },
    staleTime: 60000, // 1 minuto
  });
}
