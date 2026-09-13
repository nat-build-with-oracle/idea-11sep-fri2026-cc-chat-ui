function escapeAttribute(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function arraMark() {
  return `<svg class="mark" viewBox="0 0 48 48" aria-hidden="true">
    <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="3.2">
      <path d="M24 4v8M24 36v8M4 24h8M36 24h8" />
      <path d="m9.9 9.9 5.7 5.7M32.4 32.4l5.7 5.7M38.1 9.9l-5.7 5.7M15.6 32.4l-5.7 5.7" />
      <path d="m16.4 5.7 3.1 7.4M28.5 34.9l3.1 7.4M5.7 31.6l7.4-3.1M34.9 19.5l7.4-3.1" />
      <path d="m31.6 5.7-3.1 7.4M19.5 34.9l-3.1 7.4M5.7 16.4l7.4 3.1M34.9 28.5l7.4 3.1" />
    </g>
    <circle cx="24" cy="24" r="6.5" fill="currentColor" />
  </svg>`;
}

function lockIcon() {
  return `<svg viewBox="0 0 32 32" aria-hidden="true">
    <path d="M9.5 14v-3.2a6.5 6.5 0 0 1 13 0V14" />
    <rect x="6.5" y="14" width="19" height="14" rx="4" />
    <path d="M16 19.5v3" />
  </svg>`;
}

function lockedContent() {
  return `<div class="lock-seal" aria-hidden="true">${lockIcon()}</div>
    <div class="copy">
      <h1 id="page-title">This workspace is locked</h1>
      <p class="lead">Open your private unlock link, or paste it below. There is no browser password popup.</p>
    </div>

    <form id="unlock-form" class="unlock-form">
      <label for="unlock-token">Unlock link or token</label>
      <div class="field-row">
        <input
          id="unlock-token"
          name="unlock-token"
          type="password"
          inputmode="text"
          autocomplete="off"
          autocapitalize="none"
          spellcheck="false"
          placeholder="Paste your private unlock link"
          aria-describedby="unlock-help unlock-status"
          required
        />
        <button id="unlock-button" class="primary" type="submit">Unlock workspace</button>
      </div>
      <p id="unlock-status" class="status" role="status" aria-live="polite"></p>
    </form>

    <div class="helper" id="unlock-help">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 10.5v5M12 7.4v.1" />
      </svg>
      <p>Unlock links work for 15 minutes. This browser stays unlocked for up to 12 hours, or until the server restarts. Make a fresh link with <code>just desktop-vpn-copy-unlock</code>.</p>
    </div>`;
}

function authenticatedContent() {
  return `<div class="lock-seal open" aria-hidden="true">${lockIcon()}</div>
    <div class="copy">
      <h1 id="page-title">Your workspace is open</h1>
      <p class="lead">This browser is trusted for private VPN access. Pick up where you left off.</p>
    </div>

    <div class="actions">
      <a class="primary button-link" href="/">Open workspace</a>
      <button id="logout-button" class="secondary" type="button">Lock this browser</button>
    </div>
    <p id="unlock-status" class="status action-status" role="status" aria-live="polite"></p>

    <div class="helper">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 10.5v5M12 7.4v.1" />
      </svg>
      <p>The unlock stays in this browser for up to 12 hours, or until the server restarts. Lock it here when you finish on a shared device.</p>
    </div>`;
}

function noAuthContent() {
  return `<div class="lock-seal open no-auth" aria-hidden="true">${lockIcon()}</div>
    <div class="copy">
      <h1 id="page-title">VPN access is open</h1>
      <p class="lead">This server is running without a login gate. Anyone who can reach this private VPN address can open the workspace.</p>
    </div>

    <div class="actions single-action">
      <a class="primary button-link" href="/">Open workspace</a>
    </div>

    <div class="helper warning">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3.5 21 20H3L12 3.5Z" />
        <path d="M12 9v5M12 17v.1" />
      </svg>
      <p>No unlock link is required in <strong>NO_AUTH</strong> mode. Use authenticated mode when the VPN is shared.</p>
    </div>`;
}

function pageScript({ authenticated, noAuth }) {
  if (noAuth) {
    return `
      const scrubLocation = () => history.replaceState({}, '', '/_vpn/lock');
      scrubLocation();
      window.addEventListener('hashchange', scrubLocation);`;
  }

  if (authenticated) {
    return `
      const scrubLocation = () => history.replaceState({}, '', '/_vpn/lock');
      scrubLocation();
      window.addEventListener('hashchange', scrubLocation);

      const logoutButton = document.getElementById('logout-button');
      const status = document.getElementById('unlock-status');

      logoutButton.addEventListener('click', async () => {
        if (logoutButton.disabled) return;
        logoutButton.disabled = true;
        logoutButton.setAttribute('aria-busy', 'true');
        logoutButton.textContent = 'Locking…';
        status.className = 'status action-status';
        status.textContent = 'Locking this browser…';

        try {
          const response = await fetch('/_vpn/logout', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({}),
          });
          if (!response.ok) throw new Error('logout-failed');
          location.replace('/_vpn/lock');
        } catch {
          status.className = 'status action-status error';
          status.textContent = 'Could not lock this browser. Check the connection and try again.';
          logoutButton.disabled = false;
          logoutButton.removeAttribute('aria-busy');
          logoutButton.textContent = 'Lock this browser';
          logoutButton.focus();
        }
      });`;
  }

  return `
    const form = document.getElementById('unlock-form');
    const input = document.getElementById('unlock-token');
    const button = document.getElementById('unlock-button');
    const status = document.getElementById('unlock-status');

    const tokenFromValue = (value) => {
      const candidate = value.trim();
      if (!candidate) return '';

      try {
        const pastedUrl = new URL(candidate);
        return new URLSearchParams(pastedUrl.hash.slice(1)).get('unlock') || '';
      } catch {
        if (candidate.startsWith('#')) {
          return new URLSearchParams(candidate.slice(1)).get('unlock') || '';
        }
        return candidate;
      }
    };

    const fragmentToken = new URLSearchParams(location.hash.slice(1)).get('unlock') || '';
    history.replaceState({}, '', '/_vpn/lock');

    const setBusy = (busy) => {
      button.disabled = busy;
      input.disabled = busy;
      form.setAttribute('aria-busy', String(busy));
      button.textContent = busy ? 'Unlocking…' : 'Unlock workspace';
    };

    const unlock = async (rawValue) => {
      const token = tokenFromValue(rawValue);
      input.value = '';
      status.className = 'status';

      if (!token) {
        status.className = 'status error';
        status.textContent = 'Paste a valid unlock link or token, then try again.';
        input.focus();
        return;
      }

      setBusy(true);
      status.textContent = 'Checking your private link…';

      try {
        const response = await fetch('/_vpn/unlock', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ token }),
        });

        if (response.status !== 204) {
          if (response.status === 401) {
            throw new Error('invalid-token');
          }
          throw new Error('unlock-failed');
        }

        status.className = 'status success';
        status.textContent = 'Unlocked. Opening your workspace…';
        location.replace('/');
      } catch (error) {
        status.className = 'status error';
        status.textContent = error.message === 'invalid-token'
          ? 'That unlock link is invalid or expired. Run the helper for a fresh link and try again.'
          : 'Could not reach the workspace. Check the VPN connection and try again.';
        setBusy(false);
        input.focus();
      }
    };

    window.addEventListener('hashchange', () => {
      const freshToken = new URLSearchParams(location.hash.slice(1)).get('unlock') || '';
      history.replaceState({}, '', '/_vpn/lock');
      if (freshToken && !button.disabled) unlock(freshToken);
    });

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      unlock(input.value);
    });

    if (fragmentToken) {
      status.textContent = 'Private link found. Unlocking…';
      unlock(fragmentToken);
    } else {
      input.focus();
    }`;
}

export function renderVpnLockPage({ nonce, authenticated = false, noAuth = false }) {
  const safeNonce = escapeAttribute(nonce);
  const content = noAuth
    ? noAuthContent()
    : authenticated
      ? authenticatedContent()
      : lockedContent();
  const script = pageScript({ authenticated, noAuth });

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <meta name="referrer" content="no-referrer" />
    <title>Private access · ARRA Claude Code</title>
    <style nonce="${safeNonce}">
      :root {
        color-scheme: light;
        --canvas: #f5f5fc;
        --surface: #ffffff;
        --surface-raised: #eeeafb;
        --ink: #25243b;
        --muted: #5d6076;
        --divider: #dcddeb;
        --accent: #6842d8;
        --accent-hover: #5430bd;
        --accent-soft: #e7e1fa;
        --success: #198154;
        --error: #a32c39;
        --error-soft: #ffeaed;
        --warning: #965010;
        --warning-soft: #fff0d7;
        --focus: #6842d8;
      }

      @media (prefers-color-scheme: dark) {
        :root {
          color-scheme: dark;
          --canvas: #171923;
          --surface: #202330;
          --surface-raised: #262a39;
          --ink: #f2f3fc;
          --muted: #b9bdd1;
          --divider: #3a3f51;
          --accent: #bba5ff;
          --accent-hover: #cbbcff;
          --accent-soft: #353048;
          --success: #73d5aa;
          --error: #ff9ca8;
          --error-soft: #4b2730;
          --warning: #f2bc72;
          --warning-soft: #403220;
          --focus: #bba5ff;
        }
      }

      * { box-sizing: border-box; }

      html { min-width: 320px; background: var(--canvas); }

      body {
        min-height: 100vh;
        min-height: 100dvh;
        margin: 0;
        overflow-x: hidden;
        background: var(--canvas);
        color: var(--ink);
        font-family: "Avenir Next", Avenir, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 17px;
        line-height: 1.55;
      }

      body::before,
      body::after {
        position: fixed;
        z-index: 0;
        content: "";
        pointer-events: none;
      }

      body::before {
        top: -26vw;
        right: -20vw;
        width: min(74vw, 920px);
        aspect-ratio: 1;
        border-radius: 50%;
        background: var(--accent-soft);
      }

      body::after {
        left: 0;
        right: 0;
        bottom: 0;
        height: 7px;
        background: var(--accent);
      }

      ::selection { background: var(--accent); color: var(--surface); }

      button,
      input,
      a { font: inherit; }

      button,
      a { -webkit-tap-highlight-color: transparent; }

      :focus-visible {
        outline: 3px solid var(--focus);
        outline-offset: 3px;
      }

      .shell {
        position: relative;
        z-index: 1;
        display: grid;
        grid-template-rows: auto 1fr auto;
        width: min(100% - 40px, 1060px);
        min-height: 100vh;
        min-height: 100dvh;
        margin: 0 auto;
        padding: 34px 0 42px;
      }

      .brand {
        display: inline-flex;
        align-items: center;
        width: max-content;
        color: var(--ink);
        font-size: 18px;
        font-weight: 650;
        letter-spacing: -0.02em;
        text-decoration: none;
      }

      .mark {
        width: 34px;
        height: 34px;
        margin-right: 12px;
        color: var(--accent);
      }

      main {
        display: grid;
        align-content: center;
        justify-items: center;
        width: 100%;
        padding: 54px 0;
      }

      .gate {
        width: min(100%, 680px);
        padding: clamp(30px, 5vw, 54px);
        border: 1px solid var(--divider);
        border-radius: 16px;
        background: var(--surface);
      }

      .lock-seal {
        display: grid;
        place-items: center;
        width: 68px;
        height: 68px;
        margin-bottom: 30px;
        border-radius: 16px;
        background: var(--surface-raised);
        color: var(--accent);
        animation: seal-arrive 520ms cubic-bezier(.2, .8, .2, 1) both;
      }

      .lock-seal svg {
        width: 34px;
        height: 34px;
        fill: none;
        stroke: currentColor;
        stroke-linecap: round;
        stroke-linejoin: round;
        stroke-width: 1.8;
      }

      .lock-seal.open svg path:first-child { transform: translateX(5px); }
      .lock-seal.open svg path { transition: transform 240ms ease-out; }
      .lock-seal.no-auth { color: var(--warning); background: var(--warning-soft); }

      @keyframes seal-arrive {
        from { opacity: .45; transform: translateY(10px) scale(.94); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }

      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after {
          scroll-behavior: auto !important;
          animation-duration: .01ms !important;
          animation-iteration-count: 1 !important;
          transition-duration: .01ms !important;
        }
      }

      h1 {
        max-width: 13ch;
        margin: 0 0 14px;
        font-size: clamp(35px, 4vw, 56px);
        font-weight: 750;
        line-height: 1.03;
        letter-spacing: -0.04em;
        text-wrap: balance;
      }

      .lead {
        max-width: 54ch;
        margin: 0;
        color: var(--muted);
        line-height: 1.7;
      }

      .unlock-form { margin-top: 34px; }

      label {
        display: block;
        margin-bottom: 8px;
        font-size: 15px;
        font-weight: 650;
      }

      .field-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 10px;
      }

      input {
        width: 100%;
        min-height: 48px;
        padding: 11px 14px;
        border: 1px solid var(--divider);
        border-radius: 10px;
        background: var(--canvas);
        color: var(--ink);
        caret-color: var(--accent);
      }

      input::placeholder { color: var(--muted); opacity: .9; }
      input:hover { border-color: var(--muted); }
      input:focus { border-color: var(--accent); }

      button,
      .button-link {
        min-height: 48px;
        border-radius: 10px;
        font-size: 15px;
        font-weight: 650;
        line-height: 1.2;
        cursor: pointer;
      }

      .primary {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 12px 18px;
        border: 1px solid var(--accent);
        background: var(--accent);
        color: var(--surface);
        text-decoration: none;
      }

      .primary:hover { border-color: var(--accent-hover); background: var(--accent-hover); }

      .secondary {
        padding: 12px 18px;
        border: 1px solid var(--divider);
        background: transparent;
        color: var(--ink);
      }

      .secondary:hover { background: var(--surface-raised); }

      button:disabled {
        cursor: wait;
        opacity: .64;
      }

      .status {
        min-height: 24px;
        margin: 10px 0 0;
        color: var(--muted);
        font-size: 15px;
      }

      .status.success { color: var(--success); }
      .status.error { color: var(--error); }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 34px;
      }

      .single-action { display: block; }
      .action-status { margin-top: 12px; }

      .helper {
        display: grid;
        grid-template-columns: 22px 1fr;
        gap: 11px;
        margin-top: 28px;
        padding-top: 22px;
        border-top: 1px solid var(--divider);
        color: var(--muted);
        font-size: 15px;
        line-height: 1.65;
      }

      .helper svg {
        width: 20px;
        height: 20px;
        margin-top: 1px;
        fill: none;
        stroke: currentColor;
        stroke-linecap: round;
        stroke-linejoin: round;
        stroke-width: 1.7;
      }

      .helper p { margin: 0; }
      .helper.warning { color: var(--warning); }

      code {
        padding: 2px 5px;
        border-radius: 4px;
        background: var(--surface-raised);
        color: var(--ink);
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: .88em;
        overflow-wrap: anywhere;
      }

      footer {
        color: var(--muted);
        font-size: 15px;
      }

      @media (max-width: 600px) {
        .shell {
          width: min(100% - 24px, 680px);
          padding: 22px 0 28px;
        }

        main { padding: 32px 0; }
        .gate { padding: 26px 22px 28px; }
        .lock-seal { margin-bottom: 24px; }
        .field-row { grid-template-columns: 1fr; }
        .primary, .secondary { width: 100%; }
        .actions { display: grid; }
        footer { text-align: center; }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <header>
        <a class="brand" href="/" aria-label="ARRA Claude Code home">
          ${arraMark()}
          <span>ARRA Claude Code</span>
        </a>
      </header>

      <main>
        <section class="gate" aria-labelledby="page-title">
          ${content}
        </section>
      </main>

      <footer>Private access · This Mac · NetBird VPN</footer>
    </div>
    ${script ? `<script nonce="${safeNonce}">${script}</script>` : ''}
  </body>
</html>`;
}
