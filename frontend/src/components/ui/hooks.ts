import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { api } from '@/lib/api';

export const useGet = <T = any>(key: QueryKey, path: string, query?: Record<string, unknown>, enabled = true) =>
  useQuery<T>({ queryKey: [...key, query ?? {}], queryFn: () => api<T>('GET', path, undefined, { query }), enabled });

/** Mutation that invalidates everything derived from the ledger afterwards (cheap; server-side cache is versioned too). */
export function useSend<T = any, B = unknown>(method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string | ((b: B) => string), o: { idempotent?: boolean; onSuccess?: (d: T) => void } = {}) {
  const qc = useQueryClient();
  return useMutation<T, Error, B>({
    mutationFn: (b) => api<T>(method, typeof path === 'function' ? path(b) : path, method === 'DELETE' ? undefined : b, { idempotent: o.idempotent }),
    onSuccess: (d) => { void qc.invalidateQueries(); o.onSuccess?.(d); },
  });
}
