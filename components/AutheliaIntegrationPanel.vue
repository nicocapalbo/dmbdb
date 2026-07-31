<template>
  <section class="min-w-0 max-w-full rounded-lg border border-violet-500/35 bg-violet-950/15 p-3 sm:p-4">
    <div class="flex flex-col items-start gap-3 sm:flex-row sm:justify-between">
      <div class="min-w-0 w-full sm:flex-1">
        <h2 class="flex min-w-0 items-start gap-2 text-base font-semibold text-violet-100 sm:text-lg">
          <span class="material-symbols-rounded mt-0.5 shrink-0 text-violet-300">shield_lock</span>
          <span class="min-w-0 break-words">
            {{ status?.managed?.configured ? 'Authelia integration' : 'Set up this DUMB-managed Authelia instance' }}
          </span>
        </h2>
        <p class="mt-1 text-sm text-slate-300">
          <template v-if="status?.managed?.configured">
            Bootstrap is complete. The optional DUMB sign-in, TPA sign-in, and
            ForwardAuth tools remain available whenever you reopen this panel.
          </template>
          <template v-else>
            Start with the required Authelia setup, then choose whether to add DUMB
            sign-in, TPA admin sign-in, or protection for other apps. Local DUMB and
            TPA accounts stay available as recovery access by default.
          </template>
        </p>
      </div>
      <div class="flex w-full flex-wrap items-center justify-between gap-3 sm:w-auto sm:shrink-0 sm:justify-start">
        <button
          v-if="!loading && setupExpanded"
          type="button"
          class="text-sm text-slate-300 hover:text-white"
          @click="collapseSetup"
        >
          Collapse setup
        </button>
        <a
          href="https://dumbarr.com/services/optional/authelia/"
          target="_blank"
          rel="noopener noreferrer"
          class="text-sm text-violet-300 hover:text-violet-200"
        >
          Setup guide ↗
        </a>
      </div>
    </div>

    <div v-if="loading" class="mt-4 text-sm text-slate-400">Loading integration status…</div>
    <div
      v-else-if="!setupExpanded"
      class="mt-4 grid gap-3 rounded border p-3"
      :class="status?.managed?.configured
        ? 'border-emerald-500/35 bg-emerald-950/20'
        : 'border-amber-500/35 bg-amber-950/20'"
    >
      <div class="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div class="flex min-w-0 items-start gap-2">
          <span
            class="material-symbols-rounded"
            :class="status?.managed?.configured ? 'text-emerald-300' : 'text-amber-300'"
          >
            {{ status?.managed?.configured ? 'task_alt' : 'pending_actions' }}
          </span>
          <div class="min-w-0">
            <template v-if="status?.managed?.configured">
              <p class="font-semibold text-emerald-100">Authelia bootstrap complete</p>
              <p class="mt-0.5 break-all text-xs text-slate-400">
                {{ status.managed.public_url }} · cookie domain {{ status.managed.cookie_domain }}
              </p>
            </template>
            <template v-else>
              <p class="font-semibold text-amber-100">Authelia setup is not complete</p>
              <p class="mt-0.5 text-xs text-slate-400">
                Authelia is installed but intentionally stopped until Step 1 creates
                its configuration and first user.
              </p>
            </template>
          </div>
        </div>
        <div class="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <a
            v-if="status?.managed?.configured && status?.managed?.public_url"
            :href="status.managed.public_url"
            target="_blank"
            rel="noopener noreferrer"
            class="button-small w-full shrink-0 sm:w-auto"
          >
            <span class="material-symbols-rounded !text-[18px]">open_in_new</span>
            <span>Open Authelia portal</span>
          </a>
          <button
            v-if="status?.managed?.configured && canEnsureAutheliaTpaRoute"
            type="button"
            class="button-small w-full shrink-0 sm:w-auto"
            :disabled="busy"
            @click="ensureAutheliaRoute"
          >
            Create/reuse Authelia route
          </button>
          <button
            v-if="status?.managed?.configured && status?.managed?.authorization_policy === 'two_factor'"
            type="button"
            class="button-small w-full shrink-0 sm:w-auto"
            @click="setupExpanded = true"
          >
            First 2FA enrollment
          </button>
          <button
            type="button"
            class="button-small apply w-full shrink-0 sm:w-auto"
            @click="setupExpanded = true"
          >
            {{ status?.managed?.configured ? 'Open setup & integrations' : 'Open Authelia setup' }}
          </button>
        </div>
      </div>
      <div class="flex flex-wrap gap-2 text-xs">
        <span :class="badge(status?.managed?.configured)">Managed config</span>
        <span :class="badge(status?.managed?.clients?.includes('dumb'))">DUMB OIDC client</span>
        <span :class="badge(status?.managed?.clients?.includes('tpa'))">TPA OIDC client</span>
        <span :class="badge(status?.forward_auth?.configured)">ForwardAuth middleware</span>
      </div>
      <div v-if="message" class="rounded border px-3 py-2 text-sm" :class="messageClass">
        {{ message }}
      </div>
    </div>
    <div v-else class="mt-4 grid gap-4">
      <div class="flex flex-wrap gap-2 text-xs">
        <span :class="badge(status?.managed?.configured)">Managed config</span>
        <span :class="badge(status?.managed?.clients?.includes('dumb'))">DUMB OIDC client</span>
        <span :class="badge(status?.managed?.clients?.includes('tpa'))">TPA OIDC client</span>
        <span :class="badge(status?.forward_auth?.configured)">ForwardAuth middleware</span>
      </div>

      <div class="rounded border border-sky-500/35 bg-sky-950/25 p-3 text-sm text-sky-100 sm:p-4">
        <p class="font-semibold">Only Step 1 is required to run Authelia</p>
        <p class="mt-1 text-slate-300">
          Onboarding installed Authelia but intentionally left it stopped. Complete Step 1
          to create its configuration and first user, then publish its public HTTPS route.
          Steps 2–4 are optional ways to use the running Authelia instance.
        </p>
      </div>

      <div class="rounded border border-slate-700 bg-slate-900/35 p-3 text-sm text-slate-300 sm:p-4">
        <p class="font-semibold text-slate-100">Before you begin</p>
        <ul class="mt-2 list-disc space-y-1 pl-4 sm:pl-5">
          <li>
            Choose a dedicated public hostname, such as
            <code>https://auth.example.com</code>, and point its DNS to the Traefik
            entry point used by DUMB.
          </li>
          <li>
            Know the parent domain for its cookies. For
            <code>auth.example.com</code>, enter <code>example.com</code>.
          </li>
          <li>
            Use browser-facing HTTPS URLs in this wizard. Do not enter
            <code>localhost</code>, a DUMB <code>/ui/...</code> address, or an internal port.
          </li>
          <li>
            DUMB generates client secrets and uses the internal service addresses
            automatically. You do not need to create OIDC clients by hand.
          </li>
        </ul>
      </div>

      <details class="wizard-step" :open="!status?.managed?.configured">
        <summary>
          <strong>1. Required — Configure and start Authelia</strong>
        </summary>
        <div class="mt-3 min-w-0 rounded border border-violet-500/30 bg-violet-950/20 p-3 text-sm text-slate-300">
          This is the post-onboarding bootstrap. Until it succeeds, a Stopped or
          Unhealthy service badge is expected. DUMB will create the managed config,
          hash the first user's password, start Authelia, and preserve the generated
          secrets under <code>/config/authelia</code>.
        </div>
        <form class="mt-4 grid gap-3 lg:grid-cols-2" @submit.prevent="bootstrap">
          <div
            v-if="status?.tpa?.enabled"
            class="lg:col-span-2 rounded border border-sky-500/35 bg-sky-950/20 p-3"
          >
            <div class="flex flex-col items-start gap-2 sm:flex-row sm:justify-between">
              <div class="min-w-0">
                <p class="text-sm font-semibold text-sky-100">Use an existing TPA domain</p>
                <p class="mt-1 text-xs text-slate-400">
                  Select a root FQDN already configured in Traefik Proxy Admin. DUMB
                  will use it as the cookie domain and can create the unprotected
                  Authelia route after bootstrap without changing the domain's TLS settings.
                </p>
              </div>
              <button
                v-if="tpaDomainsError"
                type="button"
                class="text-xs text-sky-300 hover:text-sky-200 sm:shrink-0"
                @click="loadTpaDomains"
              >
                Retry discovery
              </button>
            </div>
            <div v-if="tpaDomainsLoading" class="mt-3 text-sm text-slate-400">
              Loading TPA domains…
            </div>
            <div
              v-else-if="tpaDomainsError"
              class="mt-3 rounded border border-amber-500/30 bg-amber-950/20 p-2 text-xs text-amber-100"
            >
              {{ tpaDomainsError }} You can continue with manual URL and cookie-domain entry.
            </div>
            <div
              v-else-if="!tpaDomains.length"
              class="mt-3 rounded border border-slate-700 bg-slate-950/30 p-2 text-xs text-slate-400"
            >
              TPA has no domains yet. Create one in TPA or continue with manual entry.
            </div>
            <div v-else class="mt-3 grid items-start gap-3 lg:grid-cols-2">
              <label class="field">
                <span>TPA root FQDN</span>
                <select v-model="selectedTpaDomainId" class="input" @change="applySelectedTpaDomain(true)">
                  <option value="">Manual URL and cookie domain</option>
                  <option v-for="domain in tpaDomains" :key="domain.id" :value="domain.id">
                    {{ domain.domain }}{{ domain.is_default ? ' (default)' : '' }}
                  </option>
                </select>
              </label>
              <label class="flex items-start gap-2 pt-1 text-sm text-slate-300">
                <input v-model="configureRouteInTpa" type="checkbox" class="mt-0.5 accent-violet-500" />
                <span>
                  Create or reuse the matching Authelia route in TPA after bootstrap
                  <small class="mt-1 block text-slate-500">
                    Existing domain certificate, resolver, and wildcard settings are preserved.
                  </small>
                </span>
              </label>
            </div>
          </div>
          <label class="field">
            <span>Authelia public HTTPS URL <small>(required)</small></span>
            <input v-model="bootstrapForm.public_url" class="input" placeholder="https://auth.example.com" required />
            <small>
              The address people will open in a browser. Use a dedicated hostname,
              not localhost, port 9091, or a DUMB embedded-UI URL.
            </small>
          </label>
          <label class="field">
            <span>Cookie domain <small>(required)</small></span>
            <input v-model="bootstrapForm.cookie_domain" class="input" placeholder="example.com" required />
            <small>
              Usually the parent domain without <code>https://</code>. For
              <code>auth.example.com</code>, use <code>example.com</code>.
            </small>
          </label>
          <label class="field">
            <span>Initial admin username <small>(required)</small></span>
            <input v-model="bootstrapForm.username" class="input" autocomplete="username" required />
            <small>This is your first Authelia login, not your existing DUMB username.</small>
          </label>
          <div class="field">
            <label for="authelia-initial-admin-password">
              Initial admin password <small>(required, 12+ characters)</small>
            </label>
            <div class="relative">
              <input
                id="authelia-initial-admin-password"
                v-model="bootstrapForm.password"
                :type="showBootstrapPassword ? 'text' : 'password'"
                class="input pr-16"
                autocomplete="new-password"
                minlength="12"
                required
              />
              <button
                type="button"
                class="absolute inset-y-0 right-0 px-3 text-xs font-medium text-slate-400 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-400"
                :aria-label="showBootstrapPassword ? 'Hide initial admin password' : 'Show initial admin password'"
                :aria-pressed="showBootstrapPassword"
                @click="showBootstrapPassword = !showBootstrapPassword"
              >
                {{ showBootstrapPassword ? 'Hide' : 'Show' }}
              </button>
            </div>
            <small>The password is hashed before writing and is never saved in DUMB config.</small>
          </div>
          <label class="field">
            <span>Admin email <small>(required)</small></span>
            <input v-model="bootstrapForm.email" type="email" class="input" placeholder="admin@example.com" required />
            <small>Used as the identity claim for DUMB and TPA OIDC sign-in.</small>
          </label>
          <label class="field">
            <span>Notification delivery</span>
            <select v-model="bootstrapForm.notifier_type" class="input">
              <option value="filesystem">Filesystem (simplest initial setup)</option>
              <option value="smtp">SMTP (recommended for production)</option>
            </select>
            <small>
              Filesystem writes messages under the managed config for initial testing.
              SMTP is needed for email-based production notifications.
            </small>
          </label>
          <template v-if="bootstrapForm.notifier_type === 'smtp'">
            <label class="field">
              <span>SMTP address</span>
              <input v-model="bootstrapForm.smtp_address" class="input" placeholder="submissions://smtp.example.com:465" />
            </label>
            <label class="field">
              <span>SMTP username</span>
              <input v-model="bootstrapForm.smtp_username" class="input" />
            </label>
            <div class="field">
              <label for="authelia-smtp-password">SMTP password</label>
              <div class="relative">
                <input
                  id="authelia-smtp-password"
                  v-model="bootstrapForm.smtp_password"
                  :type="showSmtpPassword ? 'text' : 'password'"
                  class="input pr-16"
                  autocomplete="new-password"
                />
                <button
                  type="button"
                  class="absolute inset-y-0 right-0 px-3 text-xs font-medium text-slate-400 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-400"
                  :aria-label="showSmtpPassword ? 'Hide SMTP password' : 'Show SMTP password'"
                  :aria-pressed="showSmtpPassword"
                  @click="showSmtpPassword = !showSmtpPassword"
                >
                  {{ showSmtpPassword ? 'Hide' : 'Show' }}
                </button>
              </div>
            </div>
            <label class="field">
              <span>SMTP sender</span>
              <input v-model="bootstrapForm.smtp_sender" class="input" placeholder="Authelia <admin@example.com>" />
            </label>
          </template>
          <details class="lg:col-span-2 rounded border border-slate-700 bg-slate-950/30 p-3">
            <summary class="cursor-pointer text-sm font-medium text-slate-200">
              Advanced bootstrap options <span class="font-normal text-slate-500">(optional)</span>
            </summary>
            <div class="mt-3 grid gap-3 lg:grid-cols-2">
              <label class="field">
                <span>Display name</span>
                <input v-model="bootstrapForm.display_name" class="input" placeholder="Example Admin" />
              </label>
              <label class="field">
                <span>Groups</span>
                <input v-model="bootstrapGroups" class="input" placeholder="admins, operators" />
                <small>Keep <code>admins</code> if you plan to restrict DUMB or TPA by group.</small>
              </label>
              <label class="field">
                <span>Default redirect URL</span>
                <input v-model="bootstrapForm.default_redirection_url" class="input" placeholder="https://home.example.com" />
                <small>Safe to leave blank. Used after someone visits Authelia directly.</small>
              </label>
              <label class="field">
                <span>Default protected-route policy</span>
                <select v-model="bootstrapForm.authorization_policy" class="input">
                  <option value="two_factor">Two factor (recommended)</option>
                  <option value="one_factor">One factor</option>
                </select>
                <small>ForwardAuth routes use this default unless Authelia rules override it.</small>
              </label>
            </div>
          </details>
          <div class="lg:col-span-2 rounded border border-slate-600 bg-slate-950/35 p-3 text-sm text-slate-300">
            <p class="font-semibold text-slate-100">
              {{ tpaRouteWillConfigure ? 'TPA route that will be configured' : 'Public route you will need' }}
            </p>
            <div class="mt-2 grid min-w-0 gap-x-3 gap-y-1 sm:grid-cols-[12rem_minmax(0,1fr)]">
              <template v-if="selectedTpaDomain">
                <span>TPA root FQDN</span>
              <code class="break-all">{{ selectedTpaDomain.domain }}</code>
              </template>
              <span>Public hostname</span>
              <code class="break-all">{{ autheliaHost }}</code>
              <span>Target host</span>
              <code>127.0.0.1</code>
              <span>Target port</span>
              <code>{{ autheliaPort }}</code>
              <span>Target scheme</span>
              <code>http</code>
              <span>Route authentication</span>
              <strong class="min-w-0 break-words text-amber-200">None — Authelia is the login service</strong>
            </div>
            <p v-if="tpaRouteWillConfigure && !tpaRouteCompatible" class="mt-2 text-xs text-rose-300">
              The public hostname must equal or be below the selected TPA root FQDN.
            </p>
            <p v-else class="mt-2 text-xs text-slate-400">
              <template v-if="tpaRouteWillConfigure">
                DUMB will safely create this route after Authelia starts, or reuse an
                exact compatible route. A hostname conflict will stop route creation
                without modifying the existing TPA service.
              </template>
              <template v-else>
                Configure this route in TPA or your external reverse proxy after bootstrap.
              </template>
              Public TLS terminates at Traefik; the local target remains HTTP. Do not
              attach ForwardAuth, TPA Service SSO, or another login middleware to this route.
            </p>
          </div>
          <div class="lg:col-span-2 rounded border border-amber-500/30 bg-amber-950/20 p-3 text-xs text-amber-100">
            Back up <code>/config/authelia</code>. Losing its storage encryption key can make
            encrypted database values unrecoverable.
          </div>
          <button
            class="button-small apply w-full justify-self-start sm:w-auto"
            :disabled="busy || (tpaRouteWillConfigure && !tpaRouteCompatible)"
          >
            {{ busy ? 'Bootstrapping…' : 'Bootstrap and start Authelia' }}
          </button>
        </form>
      </details>

      <div
        v-if="status?.managed?.configured && canEnsureAutheliaTpaRoute"
        class="rounded border border-sky-500/35 bg-sky-950/20 p-3 text-sm text-slate-300"
      >
        <p class="font-semibold text-sky-100">Authelia public route</p>
        <p class="mt-1 text-xs text-slate-400">
          Create or repair the unprotected Authelia portal route in TPA. This route
          must work before DUMB or TPA can discover Authelia's OIDC endpoints.
        </p>
        <button
          type="button"
          class="button-small mt-3 w-full sm:w-auto"
          :disabled="busy"
          @click="ensureAutheliaRoute"
        >
          {{ busy ? 'Configuring route…' : 'Create/reuse Authelia route in TPA' }}
        </button>
      </div>

      <div
        v-if="status?.managed?.configured && status?.managed?.authorization_policy === 'two_factor'"
        class="rounded border border-emerald-500/35 bg-emerald-950/20 p-3 text-sm text-slate-300 sm:p-4"
      >
        <div class="flex min-w-0 items-start gap-2">
          <span class="material-symbols-rounded shrink-0 text-emerald-300">phonelink_lock</span>
          <div class="min-w-0">
            <p class="font-semibold text-emerald-100">First login — enroll your authenticator</p>
            <p class="mt-1 text-xs text-slate-400">
              Authelia requires a one-time identity check before it shows the QR code
              for an authenticator app. Keep this signed-in DUMB tab open while you
              complete the login in another tab.
            </p>
          </div>
        </div>
        <ol class="mt-3 list-decimal space-y-1.5 pl-5 text-xs text-slate-300 sm:text-sm">
          <li>
            Complete Step 2 below, then open DUMB in another tab and choose
            <strong>Continue with Authelia</strong>.
          </li>
          <li>Sign in with the Authelia username and password created in Step 1.</li>
          <li>
            In Authelia, open <strong>Settings</strong>. Under
            <strong>One-Time Password</strong>, select <strong>Add</strong>.
            If Authelia shows a <strong>Register device</strong> link during sign-in,
            it opens this same enrollment flow.
          </li>
          <li>
            Return to this DUMB tab and click
            <strong>Reveal latest verification code</strong> below. Enter the code
            DUMB displays into Authelia's <strong>One-Time Code</strong> field.
          </li>
          <li>
            Scan Authelia's QR code with your authenticator app, enter the generated
            TOTP, and finish sign-in. The original browser tab should return to DUMB.
          </li>
        </ol>

        <div
          v-if="status?.managed?.verification_code_helper"
          class="mt-4 rounded border border-slate-600 bg-slate-950/35 p-3"
        >
          <p class="font-semibold text-slate-100">Filesystem verification code</p>
          <p class="mt-1 text-xs text-slate-400">
            DUMB reads only the newest code from its fixed managed notification file.
            The recipient, full message, and revocation link are never returned. The
            code is not logged or saved by this page and clears automatically after 60 seconds.
          </p>
          <div v-if="verificationCode" class="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <code
              class="min-w-0 rounded border border-emerald-500/40 bg-emerald-950/35 px-3 py-2 text-center text-lg font-semibold tracking-[0.2em] text-emerald-100"
              aria-live="polite"
            >{{ verificationCode }}</code>
            <button type="button" class="button-small w-full sm:w-auto" @click="copyVerificationCode">
              Copy code
            </button>
            <button type="button" class="button-small w-full sm:w-auto" @click="clearVerificationCode">
              Hide &amp; clear
            </button>
          </div>
          <button
            v-else
            type="button"
            class="button-small mt-3 w-full sm:w-auto"
            :disabled="verificationCodeLoading || !status?.dumb_auth?.enabled"
            @click="revealVerificationCode"
          >
            {{ verificationCodeLoading ? 'Checking…' : 'Reveal latest verification code' }}
          </button>
          <p
            v-if="!status?.dumb_auth?.enabled"
            class="mt-2 text-xs text-amber-200"
          >
            For safety, the code viewer requires DUMB authentication to be enabled and
            a signed-in DUMB session. Until then, read
            <code>/config/authelia/notification.txt</code> from the container.
          </p>
          <p
            v-if="verificationCodeMessage"
            class="mt-2 text-xs"
            :class="verificationCodeMessageKind === 'error' ? 'text-rose-300' : 'text-sky-200'"
            aria-live="polite"
          >
            {{ verificationCodeMessage }}
          </p>
        </div>
        <div
          v-else-if="status?.managed?.notifier_type === 'smtp'"
          class="mt-4 rounded border border-sky-500/30 bg-sky-950/20 p-3 text-xs text-sky-100"
        >
          This instance uses SMTP. Authelia sends the identity-verification code to
          the email address on the user account, so DUMB does not retrieve or display it.
        </div>
        <div v-else class="mt-4 rounded border border-slate-600 bg-slate-950/35 p-3 text-xs text-slate-300">
          This backend does not advertise the protected verification-code helper.
          If DUMB was already running when this integration was updated, restart the
          DUMB API so it loads the new route. Otherwise update DUMB, or read
          <code>/config/authelia/notification.txt</code> from the container.
        </div>
      </div>

      <details
        v-if="oidcSupported"
        class="wizard-step"
        :open="status?.managed?.configured && !status?.managed?.clients?.includes('dumb')"
      >
        <summary><strong>2. Recommended — Use Authelia for DUMB sign-in</strong></summary>
        <p class="mt-3 text-sm text-slate-300">
          Optional. This creates a dedicated DUMB OIDC client and changes the DUMB
          login page to offer Authelia.
          <template v-if="hybridSupported">
            Keep <strong>SSO + local fallback</strong> until you have successfully
            tested an Authelia login.
          </template>
          <template v-else>
            Test Authelia carefully before enabling SSO-only authentication.
          </template>
        </p>
        <form class="mt-4 grid gap-3 lg:grid-cols-2" @submit.prevent="linkDumb">
          <label class="field">
            <span>DUMB public HTTPS URL</span>
            <input
              v-model="dumbForm.dumb_public_url"
              class="input"
              placeholder="https://dumb.example.com"
              required
            />
            <small>
              The normal browser URL for DUMB, such as <code>https://dumb.example.com</code>.
              Do not use localhost or an embedded service URL.
            </small>
          </label>
          <label class="field">
            <span>DUMB auth mode</span>
            <select v-model="dumbForm.mode" class="input">
              <option v-if="hybridSupported" value="hybrid">SSO + local fallback (recommended)</option>
              <option value="oidc">SSO only</option>
            </select>
          </label>
          <div
            v-if="tpaSupportsApplicationRoute('dumb') && tpaDomains.length"
            class="lg:col-span-2 rounded border border-sky-500/35 bg-sky-950/20 p-3"
          >
            <div class="grid items-start gap-3 lg:grid-cols-2">
              <label class="flex items-start gap-2 text-sm text-slate-300">
                <input v-model="configureDumbRouteInTpa" type="checkbox" class="mt-0.5 accent-violet-500" />
                <span>
                  Ensure the Authelia portal route and create or reuse the DUMB public route in TPA
                  <small class="mt-1 block text-slate-500">
                    <template v-if="status?.dumb_frontend?.enabled">
                      The route targets the DUMB-managed frontend over loopback.
                    </template>
                    <template v-else>
                      This backend is not managing the frontend, so provide the
                      external/dev frontend address Traefik can reach.
                    </template>
                    DUMB's own authentication remains responsible for protecting sign-in.
                  </small>
                </span>
              </label>
              <label class="field">
                <span>TPA root FQDN for DUMB</span>
                <select v-model="selectedTpaDomainId" class="input" @change="applyDumbRouteSuggestion(true)">
                  <option v-for="domain in tpaDomains" :key="domain.id" :value="domain.id">
                    {{ domain.domain }}{{ domain.is_default ? ' (default)' : '' }}
                  </option>
                </select>
              </label>
            </div>
            <div
              v-if="!status?.dumb_frontend?.enabled && configureDumbRouteInTpa"
              class="mt-3 grid gap-3 lg:grid-cols-2"
            >
              <label class="field">
                <span>Frontend target host</span>
                <input
                  v-model="dumbRouteTargetHost"
                  class="input"
                  placeholder="dmbdb_dev or a reachable IP"
                  required
                />
                <small>
                  Enter a hostname, container name, or IP reachable from Traefik.
                  Containers must share a user-defined Docker network for container-name DNS.
                </small>
              </label>
              <label class="field">
                <span>Frontend target port</span>
                <input
                  v-model.number="dumbRouteTargetPort"
                  type="number"
                  min="1"
                  max="65535"
                  class="input"
                  required
                />
                <small>The dmbdb development server normally listens on port 3005.</small>
              </label>
            </div>
            <p
              v-if="dumbTpaRouteWillConfigure && !dumbTpaRouteCompatible"
              class="mt-2 text-xs text-rose-300"
            >
              The DUMB public hostname must equal or be below the selected TPA root FQDN.
            </p>
            <p v-else class="mt-2 text-xs text-slate-400">
              TPA preserves the selected domain's TLS settings and rejects hostname
              conflicts without modifying the existing service.
            </p>
          </div>
          <label class="field lg:col-span-2">
            <span>Allowed Authelia groups <small>(blank allows every authenticated user)</small></span>
            <input v-model="dumbAllowedGroups" class="input" placeholder="admins, operators" />
            <small>Use <code>admins</code> to restrict DUMB to the initial admin group.</small>
          </label>
          <div class="lg:col-span-2 rounded border border-slate-700 bg-slate-950/30 p-3 text-xs text-slate-400">
            DUMB handles the callback URL, client ID, client secret, and Authelia's
            internal token/userinfo addresses automatically.
          </div>
          <label v-if="dumbForm.mode === 'oidc'" class="lg:col-span-2 flex items-start gap-2 text-sm text-amber-100">
            <input v-model="dumbForm.confirm_oidc_only" type="checkbox" class="mt-0.5" />
            <span>I tested SSO and accept the lockout risk of removing local login.</span>
          </label>
          <button
            class="button-small apply w-full justify-self-start sm:w-auto"
            :disabled="busy || !status?.managed?.configured || (dumbTpaRouteWillConfigure && (!dumbTpaRouteCompatible || !dumbRouteTargetReady))"
          >
            Link DUMB authentication
          </button>
        </form>
      </details>
      <div
        v-if="!oidcSupported"
        class="wizard-step text-sm text-amber-100"
      >
        <p class="font-semibold">2. DUMB sign-in linking is unavailable</p>
        <p class="mt-1 text-slate-300">
          This backend does not advertise the <code>auth_oidc</code> capability.
          You can still bootstrap Authelia and use the TPA or ForwardAuth integrations.
        </p>
      </div>

      <details class="wizard-step">
        <summary><strong>3. Optional — Use Authelia for TPA admin sign-in</strong></summary>
        <p class="mt-3 text-sm text-slate-300">
          Skip this if you do not use Traefik Proxy Admin. This creates a separate
          TPA OIDC client for TPA's own admin login; it does not automatically
          protect every service managed by TPA.
        </p>
        <form class="mt-4 grid gap-3 lg:grid-cols-2" @submit.prevent="linkTpa">
          <div
            v-if="!status?.tpa?.enabled"
            class="lg:col-span-2 rounded border border-amber-500/30 bg-amber-950/20 p-3 text-sm text-amber-100"
          >
            Enable and start Traefik Proxy Admin before linking it.
          </div>
          <label class="field">
            <span>TPA public HTTPS URL</span>
            <input v-model="tpaForm.tpa_public_url" class="input" placeholder="https://proxy.example.com" required />
            <small>
              The browser/OAuth URL for TPA. Do not use <code>127.0.0.1:3004</code>
              or DUMB's <code>/ui/traefik_proxy_admin</code> path.
            </small>
          </label>
          <label class="field">
            <span>TPA admin groups</span>
            <input v-model="tpaAdminGroups" class="input" placeholder="admins" />
            <small>Users need one of these Authelia groups to receive TPA admin access.</small>
          </label>
          <div
            v-if="tpaSupportsApplicationRoute('tpa') && tpaDomains.length"
            class="lg:col-span-2 rounded border border-sky-500/35 bg-sky-950/20 p-3"
          >
            <div class="grid items-start gap-3 lg:grid-cols-2">
              <label class="flex items-start gap-2 text-sm text-slate-300">
                <input v-model="configureTpaAdminRouteInTpa" type="checkbox" class="mt-0.5 accent-violet-500" />
                <span>
                  Create or reuse TPA's own public route
                  <small class="mt-1 block text-slate-500">
                    No TPA service-auth middleware is attached. TPA's built-in admin
                    authentication protects its UI and API.
                  </small>
                </span>
              </label>
              <label class="field">
                <span>TPA root FQDN</span>
                <select v-model="selectedTpaDomainId" class="input" @change="applyTpaRouteSuggestion(true)">
                  <option v-for="domain in tpaDomains" :key="domain.id" :value="domain.id">
                    {{ domain.domain }}{{ domain.is_default ? ' (default)' : '' }}
                  </option>
                </select>
              </label>
            </div>
            <p
              v-if="tpaAdminRouteWillConfigure && !tpaAdminRouteCompatible"
              class="mt-2 text-xs text-rose-300"
            >
              The TPA public hostname must equal or be below the selected TPA root FQDN.
            </p>
            <p v-else class="mt-2 text-xs text-slate-400">
              This route targets the DUMB-managed TPA listener over loopback and
              preserves the selected domain's existing TLS settings.
            </p>
          </div>
          <label class="flex items-center gap-2 text-sm text-slate-300">
            <input v-model="tpaForm.configure_admin_sso" type="checkbox" />
            Use Authelia for TPA admin sign-in
          </label>
          <label class="flex items-center gap-2 text-sm text-slate-300">
            <input v-model="tpaForm.allow_local_fallback" type="checkbox" />
            Keep TPA local break-glass login (recommended)
          </label>
          <div class="lg:col-span-2 rounded border border-slate-700 bg-slate-950/30 p-3 text-xs text-slate-400">
            TPA must already have its first local admin account. DUMB registers the
            client and securely transfers its secret; you do not enter internal TPA
            or Authelia service addresses.
          </div>
          <button
            class="button-small apply w-full justify-self-start sm:w-auto"
            :disabled="busy || !status?.managed?.configured || !status?.tpa?.enabled || (tpaAdminRouteWillConfigure && !tpaAdminRouteCompatible)"
          >
            Link and restart TPA
          </button>
        </form>
      </details>

      <details class="wizard-step">
        <summary><strong>4. Optional — Protect other apps with ForwardAuth</strong></summary>
        <div class="mt-4 text-sm text-slate-300">
          <p>
            Use this for an app that does not have its own OIDC login. It creates
            <code>dumb-authelia-forward-auth@file</code>, which you can attach to
            selected TPA services one at a time.
          </p>
          <ul class="mt-2 list-disc space-y-1 pl-5 text-slate-400">
            <li>Do not attach it to the Authelia route itself.</li>
            <li>Do not stack it with TPA Service SSO on the same router.</li>
            <li>Creating the middleware does not protect anything until you attach it to a route.</li>
          </ul>
          <button class="button-small apply mt-3 w-full sm:w-auto" :disabled="busy || !status?.managed?.configured" @click="configureForwardAuth">
            Create/update middleware
          </button>
        </div>
      </details>

      <div v-if="message" class="rounded border px-3 py-2 text-sm" :class="messageClass">
        {{ message }}
      </div>
    </div>
  </section>
</template>

<script setup>
import axios from 'axios'
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'

const props = defineProps({
  oidcSupported: {
    type: Boolean,
    default: false,
  },
  hybridSupported: {
    type: Boolean,
    default: false,
  },
})

const loading = ref(true)
const busy = ref(false)
const status = ref(null)
const message = ref('')
const messageKind = ref('info')
const bootstrapGroups = ref('admins')
const dumbAllowedGroups = ref('')
const tpaAdminGroups = ref('admins')
const tpaDomains = ref([])
const tpaRouteApplications = ref([])
const tpaDomainsLoading = ref(false)
const tpaDomainsError = ref('')
const selectedTpaDomainId = ref('')
const configureRouteInTpa = ref(true)
const configureDumbRouteInTpa = ref(true)
const configureTpaAdminRouteInTpa = ref(true)
const dumbRouteTargetHost = ref('')
const dumbRouteTargetPort = ref(3005)
const setupExpanded = ref(true)
const showBootstrapPassword = ref(false)
const showSmtpPassword = ref(false)
const verificationCode = ref('')
const verificationCodeLoading = ref(false)
const verificationCodeMessage = ref('')
const verificationCodeMessageKind = ref('info')
let verificationCodeClearTimer = null
let setupExpansionInitialized = false

const bootstrapForm = reactive({
  public_url: '',
  cookie_domain: '',
  default_redirection_url: '',
  authorization_policy: 'two_factor',
  username: '',
  password: '',
  display_name: '',
  email: '',
  groups: [],
  notifier_type: 'filesystem',
  smtp_address: '',
  smtp_username: '',
  smtp_password: '',
  smtp_sender: '',
  smtp_startup_check_address: '',
  smtp_disable_require_tls: false,
  start_service: true,
})
const dumbForm = reactive({
  source: 'managed',
  mode: props.hybridSupported ? 'hybrid' : 'oidc',
  provider_name: 'Authelia',
  dumb_public_url: '',
  allowed_groups: [],
  tls_verify: true,
  allow_private_endpoints: false,
  allow_http: false,
  confirm_oidc_only: false,
})
const tpaForm = reactive({
  tpa_public_url: '',
  provider_name: 'DUMB-managed Authelia',
  configure_admin_sso: true,
  allow_local_fallback: true,
  admin_groups: [],
  restart_tpa: true,
})

const messageClass = computed(() => ({
  'border-emerald-500/40 bg-emerald-950/30 text-emerald-100': messageKind.value === 'success',
  'border-red-500/40 bg-red-950/30 text-red-100': messageKind.value === 'error',
  'border-sky-500/40 bg-sky-950/30 text-sky-100': messageKind.value === 'info',
}))
const autheliaPort = computed(() => Number(status.value?.managed?.port || 9091))
const autheliaHost = computed(() => {
  try {
    return new URL(bootstrapForm.public_url || 'https://auth.example.com').host
  } catch {
    return 'auth.example.com'
  }
})
const selectedTpaDomain = computed(() =>
  tpaDomains.value.find((domain) => domain.id === selectedTpaDomainId.value) || null
)
const tpaRouteWillConfigure = computed(() =>
  Boolean(
    status.value?.tpa?.enabled
    && selectedTpaDomain.value
    && configureRouteInTpa.value
  )
)
const tpaRouteCompatible = computed(() => {
  if (!selectedTpaDomain.value) return true
  const host = autheliaHost.value.toLowerCase()
  const domain = selectedTpaDomain.value.domain.toLowerCase()
  return host === domain || host.endsWith(`.${domain}`)
})
const tpaSupportsApplicationRoute = (application) =>
  tpaRouteApplications.value.includes(application)
const canEnsureAutheliaTpaRoute = computed(() => Boolean(
  status.value?.tpa?.enabled
  && selectedTpaDomain.value
  && tpaSupportsApplicationRoute('authelia')
  && tpaRouteCompatible.value
))
const publicUrlMatchesSelectedDomain = (publicUrl) => {
  if (!selectedTpaDomain.value) return true
  try {
    const host = new URL(publicUrl).hostname.toLowerCase()
    const domain = selectedTpaDomain.value.domain.toLowerCase()
    return host === domain || host.endsWith(`.${domain}`)
  } catch {
    return false
  }
}
const dumbTpaRouteWillConfigure = computed(() => Boolean(
  status.value?.tpa?.enabled
  && selectedTpaDomain.value
  && configureDumbRouteInTpa.value
  && tpaSupportsApplicationRoute('dumb')
))
const tpaAdminRouteWillConfigure = computed(() => Boolean(
  status.value?.tpa?.enabled
  && selectedTpaDomain.value
  && configureTpaAdminRouteInTpa.value
  && tpaSupportsApplicationRoute('tpa')
))
const dumbTpaRouteCompatible = computed(() =>
  publicUrlMatchesSelectedDomain(dumbForm.dumb_public_url)
)
const dumbRouteTargetReady = computed(() => {
  if (status.value?.dumb_frontend?.enabled) return true
  const port = Number(dumbRouteTargetPort.value)
  return Boolean(
    dumbRouteTargetHost.value.trim()
    && Number.isInteger(port)
    && port >= 1
    && port <= 65535
  )
})
const tpaAdminRouteCompatible = computed(() =>
  publicUrlMatchesSelectedDomain(tpaForm.tpa_public_url)
)
const badge = (ready) => [
  'rounded-full border px-2 py-1',
  ready
    ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-200'
    : 'border-slate-600 bg-slate-900/40 text-slate-400',
]
const list = (text) => text.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean)

const clearVerificationCode = () => {
  if (verificationCodeClearTimer) {
    window.clearTimeout(verificationCodeClearTimer)
    verificationCodeClearTimer = null
  }
  verificationCode.value = ''
}

const collapseSetup = () => {
  clearVerificationCode()
  verificationCodeMessage.value = ''
  setupExpanded.value = false
}

const revealVerificationCode = async () => {
  clearVerificationCode()
  verificationCodeLoading.value = true
  verificationCodeMessage.value = ''
  try {
    const result = (
      await axios.get('/api/integrations/authelia/verification-code', {
        headers: { 'Cache-Control': 'no-store' },
      })
    ).data
    if (!result?.available || !result?.code) {
      verificationCodeMessageKind.value = 'info'
      verificationCodeMessage.value = 'No verification code was found. In Authelia Settings, select Add under One-Time Password, then try again.'
      return
    }
    verificationCode.value = String(result.code)
    verificationCodeMessageKind.value = 'info'
    verificationCodeMessage.value = 'Newest code revealed. It will be cleared from this page in 60 seconds.'
    verificationCodeClearTimer = window.setTimeout(() => {
      clearVerificationCode()
      verificationCodeMessage.value = 'The displayed code was cleared. Reveal it again if it is still valid.'
    }, 60_000)
  } catch (error) {
    verificationCodeMessageKind.value = 'error'
    verificationCodeMessage.value = error.response?.data?.detail || 'Unable to retrieve the verification code.'
  } finally {
    verificationCodeLoading.value = false
  }
}

const copyVerificationCode = async () => {
  if (!verificationCode.value) return
  try {
    await navigator.clipboard.writeText(verificationCode.value)
    verificationCodeMessageKind.value = 'info'
    verificationCodeMessage.value = 'Verification code copied to the clipboard.'
  } catch {
    verificationCodeMessageKind.value = 'error'
    verificationCodeMessage.value = 'The browser could not copy the code. Select it manually instead.'
  }
}

const applySelectedTpaDomain = (force = false) => {
  const domain = selectedTpaDomain.value
  if (!domain) return
  if (force || !bootstrapForm.cookie_domain) {
    bootstrapForm.cookie_domain = domain.domain
  }
  if (force || !bootstrapForm.public_url) {
    bootstrapForm.public_url = `https://auth.${domain.domain}`
  }
}

const applyDumbRouteSuggestion = (force = false) => {
  const domain = selectedTpaDomain.value
  if (domain && (force || !dumbForm.dumb_public_url)) {
    dumbForm.dumb_public_url = `https://dumb.${domain.domain}`
  }
}

const applyTpaRouteSuggestion = (force = false) => {
  const domain = selectedTpaDomain.value
  if (domain && (force || !tpaForm.tpa_public_url)) {
    tpaForm.tpa_public_url = `https://proxy.${domain.domain}`
  }
}

const loadTpaDomains = async () => {
  if (!status.value?.tpa?.enabled) {
    tpaDomains.value = []
    tpaRouteApplications.value = []
    selectedTpaDomainId.value = ''
    return
  }
  tpaDomainsLoading.value = true
  tpaDomainsError.value = ''
  try {
    const result = (await axios.get('/api/integrations/authelia/tpa-domains')).data
    tpaDomains.value = Array.isArray(result?.domains) ? result.domains : []
    tpaRouteApplications.value = Array.isArray(result?.route_applications)
      ? result.route_applications
      : []
    const currentSelection = tpaDomains.value.find(
      (domain) => domain.id === selectedTpaDomainId.value
    )
    const configuredDomain = tpaDomains.value.find(
      (domain) => domain.domain === bootstrapForm.cookie_domain
    )
    const preferred = currentSelection
      || configuredDomain
      || tpaDomains.value.find((domain) => domain.is_default)
      || tpaDomains.value[0]
    selectedTpaDomainId.value = preferred?.id || ''
    applySelectedTpaDomain(false)
    applyDumbRouteSuggestion(false)
    applyTpaRouteSuggestion(false)
  } catch (error) {
    tpaDomains.value = []
    tpaRouteApplications.value = []
    selectedTpaDomainId.value = ''
    tpaDomainsError.value = error.response?.data?.detail || 'Unable to discover TPA domains.'
  } finally {
    tpaDomainsLoading.value = false
  }
}

const load = async () => {
  loading.value = true
  try {
    status.value = (await axios.get('/api/integrations/authelia/status')).data
    if (!status.value?.managed?.verification_code_helper) {
      clearVerificationCode()
    }
    if (!setupExpansionInitialized) {
      setupExpanded.value = !status.value?.managed?.configured
      setupExpansionInitialized = true
    }
    if (status.value?.managed?.public_url) {
      bootstrapForm.public_url = status.value.managed.public_url
      bootstrapForm.cookie_domain = status.value.managed.cookie_domain
      bootstrapForm.authorization_policy = status.value.managed.authorization_policy
    }
    if (status.value?.dumb_frontend?.enabled) {
      dumbRouteTargetHost.value = '127.0.0.1'
      dumbRouteTargetPort.value = Number(status.value.dumb_frontend.port || 3005)
    } else if (!dumbRouteTargetPort.value) {
      dumbRouteTargetPort.value = 3005
    }
    if (import.meta.client && !dumbForm.dumb_public_url) {
      const currentUrl = new URL(window.location.origin)
      const localHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
      if (currentUrl.protocol === 'https:' && !localHosts.has(currentUrl.hostname)) {
        dumbForm.dumb_public_url = currentUrl.origin
      }
    }
    await loadTpaDomains()
  } catch (error) {
    messageKind.value = 'error'
    message.value = error.response?.data?.detail || 'Unable to load Authelia integration status.'
  } finally {
    loading.value = false
  }
}

const run = async (action, successMessage) => {
  busy.value = true
  message.value = ''
  try {
    const result = await action()
    messageKind.value = 'success'
    message.value = typeof successMessage === 'function'
      ? successMessage(result)
      : successMessage
    await load()
  } catch (error) {
    messageKind.value = 'error'
    message.value = error.response?.data?.detail || error.message || 'The integration action failed.'
  } finally {
    busy.value = false
  }
}

const bootstrap = () => run(async () => {
  await axios.post('/api/integrations/authelia/bootstrap', {
    ...bootstrapForm,
    groups: list(bootstrapGroups.value),
  })
  bootstrapForm.password = ''
  bootstrapForm.smtp_password = ''
  showBootstrapPassword.value = false
  showSmtpPassword.value = false
  let routeResult = null
  if (tpaRouteWillConfigure.value) {
    try {
      routeResult = (
        await axios.post('/api/integrations/authelia/tpa-route', {
          domain_id: selectedTpaDomainId.value,
        })
      ).data
    } catch (error) {
      const detail = error.response?.data?.detail || 'TPA route configuration failed.'
      await load()
      setupExpanded.value = false
      throw new Error(`Authelia is configured and started, but TPA route setup failed: ${detail}`)
    }
  }
  setupExpanded.value = false
  return { routeResult }
}, (result) => {
  if (result?.routeResult?.created) {
    return 'Authelia is configured and started, and its public route was created in TPA.'
  }
  if (result?.routeResult?.reused) {
    return 'Authelia is configured and started, and its existing compatible TPA route was reused.'
  }
  return 'Authelia is configured and started. Publish its public HTTPS route before testing sign-in.'
})

const ensureAutheliaRoute = () => run(
  async () => (
    await axios.post('/api/integrations/authelia/tpa-route', {
      domain_id: selectedTpaDomainId.value,
      application: 'authelia',
    })
  ).data,
  (result) => result?.reused
    ? 'The existing compatible Authelia portal route was reused in TPA.'
    : 'The Authelia portal route was created in TPA.',
)

const linkDumb = () => run(
  async () => {
    let autheliaRouteResult = null
    let routeResult = null
    if (dumbTpaRouteWillConfigure.value) {
      autheliaRouteResult = (
        await axios.post('/api/integrations/authelia/tpa-route', {
          domain_id: selectedTpaDomainId.value,
          application: 'authelia',
        })
      ).data
      routeResult = (
        await axios.post('/api/integrations/authelia/tpa-route', {
          domain_id: selectedTpaDomainId.value,
          application: 'dumb',
          public_url: dumbForm.dumb_public_url,
          target_host: dumbRouteTargetHost.value,
          target_port: Number(dumbRouteTargetPort.value || 3005),
        })
      ).data
    }
    try {
      const linkResult = (
        await axios.post('/api/integrations/authelia/link-dumb', {
          ...dumbForm,
          allowed_groups: list(dumbAllowedGroups.value),
        })
      ).data
      return { linkResult, routeResult, autheliaRouteResult }
    } catch (error) {
      if (routeResult) {
        const detail = error.response?.data?.detail || 'DUMB authentication linking failed.'
        throw new Error(`The DUMB route was configured in TPA, but authentication linking failed: ${detail}`)
      }
      throw error
    }
  },
  (result) => {
    const autheliaRouteMessage = result?.autheliaRouteResult?.created
      ? ' The prerequisite Authelia portal route was created in TPA.'
      : result?.autheliaRouteResult?.reused
        ? ' The existing Authelia portal route was verified in TPA.'
        : ''
    const routeMessage = result?.routeResult?.created
      ? ' Its public route was created in TPA.'
      : result?.routeResult?.reused
        ? ' Its existing compatible TPA route was reused.'
        : ''
    const authMessage = props.hybridSupported
      ? 'DUMB sign-in is linked. Test SSO before switching away from hybrid mode.'
      : 'DUMB sign-in is linked in SSO-only mode. Test sign-in before ending the current session.'
    return `${authMessage}${autheliaRouteMessage}${routeMessage}`
  },
)

const linkTpa = () => run(
  async () => {
    let routeResult = null
    if (tpaAdminRouteWillConfigure.value) {
      routeResult = (
        await axios.post('/api/integrations/authelia/tpa-route', {
          domain_id: selectedTpaDomainId.value,
          application: 'tpa',
          public_url: tpaForm.tpa_public_url,
        })
      ).data
    }
    try {
      const linkResult = (
        await axios.post('/api/integrations/authelia/link-tpa', {
          ...tpaForm,
          admin_groups: list(tpaAdminGroups.value),
        })
      ).data
      return { linkResult, routeResult }
    } catch (error) {
      if (routeResult) {
        const detail = error.response?.data?.detail || 'TPA authentication linking failed.'
        throw new Error(`The TPA public route was configured, but authentication linking failed: ${detail}`)
      }
      throw error
    }
  },
  (result) => {
    const routeMessage = result?.routeResult?.created
      ? ' Its public route was created in TPA.'
      : result?.routeResult?.reused
        ? ' Its existing compatible public route was reused.'
        : ''
    const linkMessage = result?.linkResult?.restartRequired
      ? 'TPA is linked. Restart TPA before testing Authelia sign-in.'
      : 'TPA is linked and restarted. Its local fallback remains available.'
    return `${linkMessage}${routeMessage}`
  },
)

const configureForwardAuth = () => run(
  () => axios.post('/api/integrations/authelia/forward-auth', { source: 'managed' }),
  'ForwardAuth middleware is ready for selected TPA routes.',
)

onMounted(load)
onBeforeUnmount(clearVerificationCode)
</script>

<style scoped>
.wizard-step {
  @apply min-w-0 rounded border border-slate-700 bg-slate-900/35 p-3 sm:p-4;
}

.wizard-step summary {
  @apply cursor-pointer break-words text-sm text-slate-100 sm:text-base;
}

.field {
  @apply grid min-w-0 content-start gap-1 text-sm text-slate-300;
}

.field small {
  @apply text-slate-500;
}

.input {
  @apply block w-full min-w-0 max-w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 text-white outline-none;
}

.input:focus {
  border-color: rgb(139 92 246);
}
</style>
