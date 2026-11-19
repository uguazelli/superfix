const root = '/api/v1'

export class ApiError extends Error {
  constructor(public status: number, public code: string) { super(code) }
}

async function read<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    const detail = typeof payload?.detail === 'string' && /^[a-zA-Z]+$/.test(payload.detail) ? payload.detail : null
    const fallback: Record<number, string> = {
      400: 'invalidInput', 401: 'unauthorized', 403: 'forbidden', 404: 'notFound',
      409: 'dataConflict', 413: 'photoLimit', 429: 'throttled',
    }
    throw new ApiError(response.status, detail ?? fallback[response.status] ?? 'generic')
  }
  return response.status === 204 ? undefined as T : response.json()
}

export function get<T>(path: string): Promise<T> {
  return fetch(root + path, { cache: 'no-store' }).then(read<T>)
}

export async function send<T>(path: string, method: string, data?: unknown,
                              options?: {idempotencyKey?: string}): Promise<T> {
  const csrf = await get<{header: string; token: string}>('/auth/csrf')
  const encoded = data instanceof FormData || data instanceof URLSearchParams
  const headers = new Headers({ [csrf.header]: csrf.token })
  if (options?.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey)
  if (!encoded && data !== undefined) headers.set('Content-Type', 'application/json')
  const body = encoded ? data : data === undefined ? undefined : JSON.stringify(data)
  return read<T>(await fetch(root + path, { method, headers, body }))
}
