# Private VPN access

ARRA Claude Code keeps its normal backend on loopback and adds a second listener bound to this Mac's exact NetBird IPv4 address. It does not bind the app to every network interface.

The configured NetBird hostname also works on the server Mac when local DNS or `/etc/hosts` resolves it to loopback. Those requests pass through the same VPN authentication and origin checks; ordinary localhost requests keep their existing behavior. Other hostnames are not implicitly trusted.

Live Timeline uses a bridge on port 47882, bound only to loopback and the configured VPN address, forwarding to the existing localhost:47881 Timeline service. It shares ARRA's authentication mode, browser sessions, and logout revocation. The app does not start or modify Timeline itself. The sidebar preserves the full ARRA URL for return navigation; browser Back works across both origins.

## Enable a mode

```sh
# Recommended default: unlock link and browser session required
just desktop-vpn

# Same authenticated behavior, explicitly selected
just desktop-vpn mode=WITH_AUTH

# Fast trusted-VPN mode: every allowed NetBird peer can use Claude
just desktop-vpn mode=NO_AUTH

# Production mode: authentication is always enforced
just desktop-vpn mode=PROD
```

`NODE_ENV=production` refuses `NO_AUTH`. `PROD` does not add public-internet hardening or TLS: access still relies on the encrypted private VPN and plain HTTP is only intended inside that VPN.

The installer verifies this account's exact installed tray process, its child backend, and idle conversations before restarting. It waits for the old process/socket to exit and checks the restarted backend owns the VPN listener. Runtime or verification failure triggers guarded rollback of the previous server files and VPN configuration; if the new process cannot safely be stopped, restoration is refused rather than overwriting files it may still be using. Claude/tmux writers and conversation data are not replaced by this recipe.

## Operate access

```sh
just desktop-vpn-status
just desktop-vpn-copy-unlock
just desktop-vpn-reset-key
```

An unlock link can be reused until it expires after 15 minutes. A browser session lasts up to 12 hours or until the local server restarts. Open `/_vpn/lock` and choose **Lock this browser** to log out.

`desktop-vpn-reset-key` regenerates the local signing key and restarts the app, revoking all prior links and browser sessions. It preserves the configured mode, so resetting the key does not turn authentication on when the mode is `NO_AUTH`.

The older `desktop-vpn-copy-password` recipe remains as a compatibility alias, but it copies an expiring unlock link and never exposes the signing key.
