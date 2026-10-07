import type { Action, Status } from './api'

/** Tabs, in the order a word travels through the workflow. */
export const STATUSES: { status: Status; label: string }[] = [
  { status: 'SUBMITTED', label: 'À relire' },
  { status: 'APPROVED', label: 'Approuvés' },
  { status: 'SCHEDULED', label: 'Programmés' },
  { status: 'PUBLISHED', label: 'En ligne' },
  { status: 'REJECTED', label: 'Refusés' },
  { status: 'ARCHIVED', label: 'Archivés' },
]

export const STATUS_LABEL: Record<Status, string> = {
  SUBMITTED: 'Soumis',
  APPROVED: 'Approuvé',
  REJECTED: 'Refusé',
  SCHEDULED: 'Programmé',
  PUBLISHED: 'Publié',
  ARCHIVED: 'Archivé',
}

export const ACTION_LABEL: Partial<Record<Action, string>> = {
  approve: 'Approuver',
  reject: 'Refuser',
  schedule: 'Programmer',
  unschedule: 'Déprogrammer',
  publishNow: 'Publier maintenant',
}

/** API error codes translated for reviewers. */
const ERRORS: Record<string, string> = {
  INVALID_CREDENTIALS: 'E-mail ou mot de passe incorrect.',
  UNAUTHENTICATED: 'Votre session a expiré, reconnectez-vous.',
  TOO_MANY_REQUESTS: 'Trop de tentatives. Patientez une minute.',
  CONCURRENT_UPDATE: "Quelqu'un vient de modifier ce mot. La liste a été rafraîchie.",
  INVALID_TRANSITION: "Ce mot a changé d'état entre-temps. La liste a été rafraîchie.",
  SELF_REVIEW: 'Vous ne pouvez pas relire un mot que vous avez proposé.',
  FORBIDDEN_TRANSITION: "Votre rôle ne permet pas cette action.",
  DATE_ALREADY_TAKEN: 'Un autre mot est déjà programmé ce jour-là.',
  INVALID_SCHEDULE_DATE: 'Choisissez une date à partir de demain.',
  REJECTION_REASON_REQUIRED: 'Indiquez le motif du refus.',
  VALIDATION_FAILED: 'Certaines informations sont invalides.',
  NETWORK: "L'API ne répond pas. Vérifiez votre connexion.",
}

export const errorMessage = (code: string): string => ERRORS[code] ?? 'Une erreur inattendue est survenue.'

/** Codes after which the list on screen is stale and must be reloaded. */
export const STALE_CODES = new Set(['CONCURRENT_UPDATE', 'INVALID_TRANSITION'])

const dateTime = new Intl.DateTimeFormat('fr-CH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Zurich' })
const longDay = new Intl.DateTimeFormat('fr-CH', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })

export const formatDateTime = (iso: string): string => dateTime.format(new Date(iso))
/** `YYYY-MM-DD` calendar day, e.g. "jeudi 8 octobre". */
export const formatDay = (day: string): string => longDay.format(new Date(`${day}T00:00:00Z`))

/** Tomorrow in Geneva, the first day a word can be scheduled on. */
export function tomorrowInGeneva(): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(new Date())
  const next = new Date(`${today}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  return next.toISOString().slice(0, 10)
}
