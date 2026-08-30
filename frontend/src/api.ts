const API_BASE_URL = '/api'
const ACCESS_TOKEN_KEY = 'lol-manager.access-token'

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
  const headers = new Headers(options.headers)
  headers.set('Accept', 'application/json')

  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json')
  }

  if (options.token) {
    headers.set('Authorization', `Bearer ${options.token}`)
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

    throw new ApiError(response.status, message)
  }

  return responseBody as T
}
