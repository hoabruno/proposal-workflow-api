<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api, ApiError, type Me, type Proposal, type Status } from '../api'
import { errorMessage, STALE_CODES, STATUSES } from '../messages'
import ProposalCard from './ProposalCard.vue'

const props = defineProps<{ me: Me }>()
const emit = defineEmits<{ logout: []; expired: [] }>()

const proposals = ref<Proposal[]>([])
const active = ref<Status>('SUBMITTED')
const notice = ref<{ kind: 'ok' | 'error'; text: string } | null>(null)
const loading = ref(true)

const counts = computed(() =>
  Object.fromEntries(STATUSES.map(({ status }) => [status, proposals.value.filter((p) => p.status === status).length])),
)
const visible = computed(() => proposals.value.filter((p) => p.status === active.value))

async function reload() {
  try {
    proposals.value = await api.proposals()
  } catch (e) {
    handle(e)
  } finally {
    loading.value = false
  }
}

function handle(e: unknown) {
  const code = e instanceof ApiError ? e.code : 'UNKNOWN'
  if (code === 'UNAUTHENTICATED') return emit('expired')
  notice.value = { kind: 'error', text: errorMessage(code) }
  // Someone else acted first: show the current state rather than a stale card.
  if (STALE_CODES.has(code)) void reload()
}

/** Runs a workflow action from a card, then refreshes the whole list. */
async function run(action: () => Promise<Proposal>, success: string) {
  notice.value = null
  try {
    await action()
    notice.value = { kind: 'ok', text: success }
    await reload()
  } catch (e) {
    handle(e)
  }
}

/** Admin only: wipes every word after an explicit confirmation. */
async function resetAll() {
  const total = proposals.value.length
  const question =
    total === 0
      ? 'Aucun mot à supprimer. Réinitialiser quand même ?'
      : `Supprimer définitivement les ${total} mots et tout leur historique ? La tornade reviendra à « atipik ». Cette action est irréversible.`
  if (!confirm(question)) return
  notice.value = null
  try {
    const { deleted } = await api.resetAll()
    notice.value = { kind: 'ok', text: deleted > 1 ? `${deleted} mots supprimés. Tout est remis à zéro.` : 'Tout est remis à zéro.' }
    active.value = 'SUBMITTED'
    await reload()
  } catch (e) {
    handle(e)
  }
}

onMounted(reload)
</script>

<template>
  <div class="layout">
    <header class="topbar">
      <p class="brand"><i aria-hidden="true"></i>Relecture des mots</p>
      <div class="who">
        <span>{{ props.me.displayName }} · {{ props.me.role === 'ADMIN' ? 'admin' : 'relecteur' }}</span>
        <button class="btn ghost small" type="button" @click="emit('logout')">Se déconnecter</button>
        <!-- Shown to admins only; the API refuses the reset to anyone else anyway. -->
        <button v-if="props.me.role === 'ADMIN'" class="btn small" type="button" @click="resetAll">
          Réinitialiser les mots
        </button>
      </div>
    </header>

    <nav class="tabs" aria-label="Statuts">
      <button
        v-for="{ status, label } in STATUSES"
        :key="status"
        type="button"
        class="tab"
        :aria-current="active === status"
        @click="active = status"
      >
        {{ label }} <span class="count">{{ counts[status] }}</span>
      </button>
    </nav>

    <p v-if="notice" class="notice" :class="notice.kind" role="status">{{ notice.text }}</p>

    <main class="list">
      <p v-if="loading" class="empty">Chargement…</p>
      <p v-else-if="visible.length === 0" class="empty">Aucun mot ici pour le moment.</p>
      <ProposalCard v-for="proposal in visible" :key="proposal.id" :proposal="proposal" @run="run" @error="handle" />
    </main>
  </div>
</template>
