const API_BASE_URL = '/api'
const ACCESS_TOKEN_KEY = 'lol-manager.access-token'
const sessionInvalidationListeners = new Set<(token: string) => void>()
// Keep compatibility with a backend that was already running before the error code was added.
const LEGACY_SESSION_ERRORS = new Set([
  'Invalid or expired access token',
  'Invalid access token',
  'Bearer access token is required',
])

export function subscribeToSessionInvalidation(listener: (token: string) => void) {
  sessionInvalidationListeners.add(listener)
  return () => { sessionInvalidationListeners.delete(listener) }
}

interface ApiRequestOptions extends Omit<RequestInit, 'body'> {
  token?: string | null
  body?: unknown
}

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export function getStoredAccessToken() {
  return window.localStorage.getItem(ACCESS_TOKEN_KEY)
}

export function storeAccessToken(token: string) {
  window.localStorage.setItem(ACCESS_TOKEN_KEY, token)
}

export function clearStoredAccessToken() {
  window.localStorage.removeItem(ACCESS_TOKEN_KEY)
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const requestToken = options.token
  const headers = new Headers(options.headers)
  headers.set('Accept', 'application/json')

  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json')
  }

  if (requestToken) {
    headers.set('Authorization', `Bearer ${requestToken}`)
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })

  const contentType = response.headers.get('content-type') ?? ''
  const responseBody: unknown = contentType.includes('application/json')
    ? await response.json()
    : await response.text()

  if (!response.ok) {
    let message = `요청을 처리하지 못했습니다. (${response.status})`

    if (typeof responseBody === 'string' && responseBody.trim()) {
      message = responseBody
    } else if (responseBody && typeof responseBody === 'object' && 'message' in responseBody) {
      const apiMessage = responseBody.message
      message = Array.isArray(apiMessage) ? apiMessage.join(', ') : String(apiMessage)
    }

    const invalidSession = responseBody && typeof responseBody === 'object'
      && 'code' in responseBody && responseBody.code === 'AUTH_SESSION_INVALID'
    // Credential errors (e.g. linking Google) can also be 401, without invalidating our JWT.
    if (response.status === 401 && requestToken && (invalidSession || LEGACY_SESSION_ERRORS.has(message))) {
      sessionInvalidationListeners.forEach(listener => listener(requestToken))
    }

    throw new ApiError(response.status, message)
  }

  return responseBody as T
}
