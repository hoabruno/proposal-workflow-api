<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api, ApiError, type Me } from './api'
import LoginView from './components/LoginView.vue'
import ProposalsView from './components/ProposalsView.vue'

// Two screens only, so a ref is all the "routing" this app needs.
const me = ref<Me | null>(null)
const ready = ref(false)

onMounted(async () => {
  try {
    me.value = await api.me()
  } catch (error) {
    // 401 simply means "not signed in yet"; anything else is shown on the login screen.
    if (!(error instanceof ApiError) || error.status !== 401) console.error(error)
  } finally {
    ready.value = true
  }
})

async function logout() {
  await api.logout().catch(() => {})
  me.value = null
}
</script>

<template>
  <template v-if="ready">
    <ProposalsView v-if="me" :me="me" @logout="logout" @expired="me = null" />
    <LoginView v-else @signed-in="me = $event" />
  </template>
</template>
