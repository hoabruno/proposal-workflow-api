// Typed client for the back-office endpoints of proposal-workflow-api.
// The session lives in an HttpOnly cookie set by the API, so there is no
// token to store or attach here: same-origin requests carry it automatically.

export type Role = 'REVIEWER' | 'ADMIN'
export type Status = 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'SCHEDULED' | 'PUBLISHED' | 'ARCHIVED'
export type Action = 'approve' | 'reject' | 'schedule' | 'unschedule' | 'publishNow' | 'publish' | 'archive'

export type Me = { id: string; displayName: string; role: Role }

export type Proposal = {
  id: string
  word: string
  proposerName: string | null
  status: Status
  version: number
  rejectionReason: string | null
  scheduledFor: string | null
  publishedAt: string | null
  createdAt: string
  actions: Action[]
}

export type HistoryEntry = {
  fromStatus: Status | null
  toStatus: Status
  comment: string | null
  actorName: string | null
  at: string
}

/** Error carrying the API's stable code (CONCURRENT_UPDATE, SELF_REVIEW, ...). */
export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

async function call<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'NETWORK', 'API unreachable')
  }
  if (response.status === 204) return undefined as T
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new ApiError(response.status, payload.code ?? 'UNKNOWN', payload.message ?? response.statusText)
  }
  return payload as T
}

export const api = {
  me: () => call<Me>('GET', '/auth/me'),
  login: (email: string, password: string) => call<Me>('POST', '/auth/login', { email, password }),
  logout: () => call<void>('POST', '/auth/logout'),

  proposals: () => call<Proposal[]>('GET', '/proposals'),
  history: (id: string) => call<HistoryEntry[]>('GET', `/proposals/${id}/history`),

  approve: (p: Proposal, comment?: string) =>
    call<Proposal>('POST', `/proposals/${p.id}/approve`, { version: p.version, comment: comment || undefined }),
  reject: (p: Proposal, reason: string) =>
    call<Proposal>('POST', `/proposals/${p.id}/reject`, { version: p.version, reason }),
  schedule: (p: Proposal, day: string) =>
    call<Proposal>('POST', `/proposals/${p.id}/schedule`, { version: p.version, day }),
  unschedule: (p: Proposal) => call<Proposal>('POST', `/proposals/${p.id}/unschedule`, { version: p.version }),
  publishNow: (p: Proposal) => call<Proposal>('POST', `/proposals/${p.id}/publish-now`, { version: p.version }),
  /** Admin only: deletes every proposal and its history. */
  resetAll: () => call<{ deleted: number }>('DELETE', '/proposals'),
}
