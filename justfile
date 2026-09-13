set shell := ["bash", "-euo", "pipefail", "-c"]

# Unmount only a stale image of this product, build/finalize, then inspect the finished DMG.
desktop-build:
    node scripts/verify-dmg.mjs --unmount-existing
    npm run tauri:build
    node scripts/verify-dmg.mjs

# Read-only verification of the finalized installer and its configured icon alignment.
desktop-verify:
    node --test tests/dmg.test.mjs tests/verify-dmg.test.mjs
    node scripts/verify-dmg.mjs

# Never open Tauri's intermediate image; verification resolves and opens the finalized DMG.
desktop-open: desktop-verify
    node scripts/verify-dmg.mjs --open

# Enable NetBird access. WITH_AUTH is the safe default; PROD always enforces authentication.
desktop-vpn mode='WITH_AUTH':
    node scripts/desktop-vpn.mjs enable '{{ mode }}'

# Inspect the localhost backend and VPN listener without changing either.
desktop-vpn-status:
    node scripts/desktop-vpn.mjs status

# Deprecated alias: copy an expiring unlock link, never the signing key.
desktop-vpn-copy-password:
    node scripts/desktop-vpn.mjs copy-password

# Copy a fresh, expiring unlock link without printing its token.
desktop-vpn-copy-unlock:
    node scripts/desktop-vpn.mjs copy-unlock

# Compatibility alias for copying a fresh unlock link; never prints its token.
desktop-vpn-copy-unlock-link:
    node scripts/desktop-vpn.mjs copy-unlock-link

# Regenerate the signing key, revoke old links/sessions on restart, and preserve the configured auth mode.
desktop-vpn-reset-key:
    node scripts/desktop-vpn.mjs reset-key

# Restart the installed Claude-only app using the normal Claude login; no extra key.
desktop-claude:
    node scripts/desktop-claude.mjs

# Check, build with a fresh visible version, back up, and update this account's idle app.
desktop-update-claude:
    npm run check
    node scripts/desktop-claude.mjs --update
