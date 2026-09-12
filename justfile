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
