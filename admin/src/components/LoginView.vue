<script setup lang="ts">
import { ref } from 'vue'
import { api, ApiError, type Me } from '../api'
import { errorMessage } from '../messages'

const emit = defineEmits<{ 'signed-in': [me: Me] }>()

const email = ref('')
const password = ref('')
const error = ref('')
const busy = ref(false)

async function submit() {
  busy.value = true
  error.value = ''
  try {
    emit('signed-in', await api.login(email.value, password.value))
  } catch (e) {
    error.value = errorMessage(e instanceof ApiError ? e.code : 'UNKNOWN')
    password.value = ''
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="login">
    <form class="card login-card" @submit.prevent="submit">
      <p class="brand"><i aria-hidden="true"></i>Relecture des mots</p>
      <h1>Connexion</h1>

      <label class="field">
        <span>E-mail</span>
        <input v-model="email" type="email" autocomplete="username" required />
      </label>
      <label class="field">
        <span>Mot de passe</span>
        <input v-model="password" type="password" autocomplete="current-password" required />
      </label>

      <p class="error" role="alert">{{ error }}</p>
      <button class="btn" type="submit" :disabled="busy">{{ busy ? 'Connexion…' : 'Se connecter' }}</button>
    </form>
  </main>
</template>
