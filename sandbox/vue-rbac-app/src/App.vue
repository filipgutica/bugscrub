<script setup>
import { computed, ref } from 'vue'

const identities = {
  admin: {
    label: 'Admin',
    role: 'Platform Admin',
    scopes: ['rbac:write', 'audit:export', 'reports:view']
  },
  viewer: {
    label: 'Viewer',
    role: 'Read-only Analyst',
    scopes: ['reports:view']
  },
  auditor: {
    label: 'Auditor',
    role: 'Compliance Auditor',
    scopes: ['audit:export', 'reports:view']
  }
}

const currentIdentityKey = ref('admin')
const activityFilter = ref('All activity')
const lastAction = ref('Loaded audit workspace')

const currentIdentity = computed(() => {
  return identities[currentIdentityKey.value]
})

const loginAs = (identityKey) => {
  currentIdentityKey.value = identityKey
  lastAction.value = `Switched session to ${identities[identityKey].label}`
}

const filterOptions = ['All activity', 'Role changes', 'Permission checks']

const filterActivity = (nextFilter) => {
  activityFilter.value = nextFilter
  lastAction.value = `Updated activity filter to ${nextFilter}`
}

const canExport = computed(() => {
  return currentIdentity.value.scopes.includes('audit:export')
})

const canManageRoles = computed(() => {
  return currentIdentity.value.scopes.includes('rbac:write')
})

const canViewReports = computed(() => {
  return currentIdentity.value.scopes.includes('reports:view')
})
</script>

<template>
  <main class="shell">
    <section class="hero">
      <div>
        <p class="eyebrow">Sandbox surface</p>
        <h1 data-testid="rbac-page-title">RBAC Operations Console</h1>
        <p class="lede">
          Small Vue sandbox for identity switching, scope-aware actions, and
          BugScrub workflow validation.
        </p>
      </div>
      <div class="signal-card" data-testid="results-refresh-indicator">
        <span class="signal-label">Last action</span>
        <strong>{{ lastAction }}</strong>
      </div>
    </section>

    <section class="grid">
      <article class="panel">
        <header class="panel-header">
          <div>
            <p class="eyebrow">Identity switcher</p>
            <h2 data-testid="identity-switcher">Login as</h2>
          </div>
        </header>
        <div class="identity-list">
          <button
            v-for="(identity, key) in identities"
            :key="key"
            class="identity-button"
            :class="{ active: currentIdentityKey === key }"
            :data-testid="`login-${key}`"
            @click="loginAs(key)"
          >
            <span>{{ identity.label }}</span>
            <small>{{ identity.role }}</small>
          </button>
        </div>
      </article>

      <article class="panel identity-summary" data-testid="identity-summary">
        <header class="panel-header">
          <div>
            <p class="eyebrow">Current session</p>
            <h2>{{ currentIdentity.label }}</h2>
          </div>
          <span class="role-chip">{{ currentIdentity.role }}</span>
        </header>
        <ul class="scope-list">
          <li
            v-for="scope in currentIdentity.scopes"
            :key="scope"
            class="scope-chip"
          >
            {{ scope }}
          </li>
        </ul>
      </article>
    </section>

    <section class="grid">
      <article class="panel" data-testid="filters-panel">
        <header class="panel-header">
          <div>
            <p class="eyebrow">Audit feed</p>
            <h2>Filter activity</h2>
          </div>
          <span class="pill">{{ activityFilter }}</span>
        </header>
        <div class="filter-row">
          <button
            v-for="option in filterOptions"
            :key="option"
            class="filter-button"
            :class="{ active: activityFilter === option }"
            @click="filterActivity(option)"
          >
            {{ option }}
          </button>
        </div>
      </article>

      <article class="panel" data-testid="rbac-actions-panel">
        <header class="panel-header">
          <div>
            <p class="eyebrow">Role-aware actions</p>
            <h2>Available controls</h2>
          </div>
        </header>
        <div class="action-grid">
          <button
            v-if="canExport"
            class="action-card"
            data-testid="export-audit-button"
          >
            Export audit CSV
          </button>
          <button
            v-if="canManageRoles"
            class="action-card"
            data-testid="manage-roles-button"
          >
            Manage role bindings
          </button>
          <button
            v-if="canViewReports"
            class="action-card"
            data-testid="view-reports-button"
          >
            View access reports
          </button>
          <p v-if="!canExport" data-testid="export-hidden-message" class="hint">
            Export is hidden for identities without the `audit:export` scope.
          </p>
        </div>
      </article>
    </section>
  </main>
</template>

<style scoped>
:global(body) {
  margin: 0;
  font-family: "IBM Plex Sans", "Avenir Next", sans-serif;
  background:
    radial-gradient(circle at top left, rgba(255, 210, 123, 0.35), transparent 28%),
    linear-gradient(180deg, #f7f2e8 0%, #efe7d5 100%);
  color: #182028;
}

:global(*) {
  box-sizing: border-box;
}

.shell {
  min-height: 100vh;
  padding: 40px 20px 64px;
}

.hero,
.grid {
  max-width: 1040px;
  margin: 0 auto 20px;
}

.hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  gap: 20px;
  align-items: end;
}

.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
}

.eyebrow {
  margin: 0 0 8px;
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #9b4d12;
}

h1,
h2,
.lede,
.pill,
.hint,
.role-chip,
.scope-chip,
.signal-label,
.action-card,
.identity-button,
.filter-button {
  margin: 0;
}

h1 {
  font-size: clamp(2.4rem, 5vw, 4.5rem);
  line-height: 0.95;
  letter-spacing: -0.04em;
}

h2 {
  font-size: 1.3rem;
}

.lede {
  max-width: 44rem;
  margin-top: 14px;
  font-size: 1rem;
  line-height: 1.6;
  color: #44515f;
}

.signal-card,
.panel {
  border: 1px solid rgba(24, 32, 40, 0.08);
  border-radius: 24px;
  background: rgba(255, 253, 248, 0.86);
  backdrop-filter: blur(12px);
  box-shadow: 0 24px 60px rgba(92, 67, 20, 0.08);
}

.signal-card {
  padding: 18px 20px;
}

.signal-label {
  display: block;
  margin-bottom: 8px;
  font-size: 0.8rem;
  color: #6f5e47;
  text-transform: uppercase;
}

.panel {
  padding: 22px;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: start;
  margin-bottom: 18px;
}

.identity-list,
.filter-row,
.action-grid,
.scope-list {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.identity-button,
.filter-button,
.action-card {
  border: 0;
  border-radius: 16px;
  cursor: pointer;
}

.identity-button,
.filter-button {
  background: #fff6e9;
  padding: 14px 16px;
  text-align: left;
  color: inherit;
}

.identity-button {
  min-width: 180px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.identity-button.active,
.filter-button.active {
  background: #1f6f5f;
  color: #f8f6f1;
}

.action-grid {
  align-items: center;
}

.action-card {
  padding: 14px 18px;
  background: #182028;
  color: #f8f6f1;
  font-weight: 600;
}

.pill,
.role-chip,
.scope-chip {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
}

.pill,
.role-chip {
  padding: 8px 12px;
  background: #f3ead8;
  color: #5a4632;
  font-size: 0.85rem;
}

.scope-chip {
  padding: 8px 10px;
  background: #e6f0ee;
  color: #155246;
  font-size: 0.82rem;
}

.hint {
  color: #7b4b1d;
  font-size: 0.95rem;
}

@media (max-width: 840px) {
  .hero,
  .grid {
    grid-template-columns: 1fr;
  }
}
</style>
