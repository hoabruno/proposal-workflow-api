<script setup lang="ts">
import { ref } from 'vue'
import { api, type HistoryEntry, type Proposal } from '../api'
import { ACTION_LABEL, formatDateTime, formatDay, STATUS_LABEL, tomorrowInGeneva } from '../messages'

const props = defineProps<{ proposal: Proposal }>()
const emit = defineEmits<{
  run: [action: () => Promise<Proposal>, success: string]
  error: [error: unknown]
}>()

// Inline forms for the two actions that need input.
const mode = ref<'reject' | 'schedule' | null>(null)
const reason = ref('')
const day = ref(tomorrowInGeneva())
const history = ref<HistoryEntry[] | null>(null)

const can = (action: string) => props.proposal.actions.includes(action as Proposal['actions'][number])
const word = () => `« ${props.proposal.word} »`

function approve() {
  emit('run', () => api.approve(props.proposal), `${word()} est approuvé.`)
}
function reject() {
  emit('run', () => api.reject(props.proposal, reason.value), `${word()} est refusé.`)
  mode.value = null
}
function schedule() {
  emit('run', () => api.schedule(props.proposal, day.value), `${word()} est programmé le ${formatDay(day.value)}.`)
  mode.value = null
}
function unschedule() {
  emit('run', () => api.unschedule(props.proposal), `${word()} est retiré du calendrier.`)
}
function publishNow() {
  if (!confirm(`Publier ${word()} tout de suite ? Il remplacera le mot actuellement en ligne.`)) return
  emit('run', () => api.publishNow(props.proposal), `${word()} est en ligne : la tornade le forme déjà.`)
}

async function toggleHistory() {
  if (history.value) {
    history.value = null
    return
  }
  try {
    history.value = await api.history(props.proposal.id)
  } catch (e) {
    emit('error', e)
  }
}
</script>

<template>
  <article class="card proposal">
    <div class="proposal-head">
      <h2 class="word">{{ proposal.word }}</h2>
      <span class="badge" :data-status="proposal.status">{{ STATUS_LABEL[proposal.status] }}</span>
    </div>

    <p class="meta">
      Proposé {{ proposal.proposerName ? `par ${proposal.proposerName}` : 'anonymement' }} le
      {{ formatDateTime(proposal.createdAt) }}
      <template v-if="proposal.scheduledFor"> · prévu le {{ formatDay(proposal.scheduledFor) }}</template>
      <template v-if="proposal.publishedAt"> · publié le {{ formatDateTime(proposal.publishedAt) }}</template>
    </p>
    <p v-if="proposal.rejectionReason" class="reason">Motif : {{ proposal.rejectionReason }}</p>

    <div v-if="mode === 'reject'" class="inline-form">
      <label class="field">
        <span>Motif du refus</span>
        <input v-model="reason" maxlength="280" placeholder="Ex. hors sujet, déjà proche d'un autre mot…" />
      </label>
      <button class="btn danger" type="button" :disabled="!reason.trim()" @click="reject">Confirmer le refus</button>
      <button class="btn ghost" type="button" @click="mode = null">Annuler</button>
    </div>

    <div v-else-if="mode === 'schedule'" class="inline-form">
      <label class="field">
        <span>Jour de publication</span>
        <input v-model="day" type="date" :min="tomorrowInGeneva()" />
      </label>
      <button class="btn" type="button" :disabled="!day" @click="schedule">Programmer</button>
      <button class="btn ghost" type="button" @click="mode = null">Annuler</button>
    </div>

    <div v-else class="actions">
      <!-- Buttons come from the API's `actions`: the workflow decides, the UI only reflects it. -->
      <button v-if="can('approve')" class="btn" type="button" @click="approve">{{ ACTION_LABEL.approve }}</button>
      <button v-if="can('reject')" class="btn ghost" type="button" @click="mode = 'reject'">{{ ACTION_LABEL.reject }}</button>
      <button v-if="can('schedule')" class="btn" type="button" @click="mode = 'schedule'">{{ ACTION_LABEL.schedule }}</button>
      <button v-if="can('publishNow')" class="btn ghost" type="button" @click="publishNow">{{ ACTION_LABEL.publishNow }}</button>
      <button v-if="can('unschedule')" class="btn ghost" type="button" @click="unschedule">{{ ACTION_LABEL.unschedule }}</button>
      <button class="link" type="button" :aria-expanded="history !== null" @click="toggleHistory">
        {{ history ? "Masquer l'historique" : 'Historique' }}
      </button>
    </div>

    <ol v-if="history" class="history">
      <li v-for="(entry, i) in history" :key="i">
        <time>{{ formatDateTime(entry.at) }}</time>
        <span>
          <b>{{ STATUS_LABEL[entry.toStatus] }}</b>
          {{ entry.actorName ? `par ${entry.actorName}` : entry.fromStatus ? 'automatiquement' : 'par un visiteur' }}
          <em v-if="entry.comment"> · {{ entry.comment }}</em>
        </span>
      </li>
    </ol>
  </article>
</template>
