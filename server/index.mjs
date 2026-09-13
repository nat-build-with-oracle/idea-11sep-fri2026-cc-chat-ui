import { createServer } from './app.mjs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { readVpnConfig, createVpnProxy } from './vpn-access.mjs';

const port = Number.parseInt(process.env.PORT || '4318', 10);
const server = await createServer({
  dataDir: process.env.CC_CHAT_DATA_DIR,
  cwd: process.env.CC_CHAT_CWD || process.cwd(),
});
server.listen(port, '127.0.0.1', () => {
  console.log(`[${new Date().toISOString()}] ARRA Claude Code listening on http://127.0.0.1:${port} (PID ${process.pid})`);
});

let vpnServer;
const timelineServers = [];
try {
  const vpn = await readVpnConfig(process.env.CC_CHAT_DATA_DIR || path.join(process.cwd(), '.local'));
  if (vpn) {
    const sessions = new Map();
    vpnServer = createVpnProxy({ ...vpn, port, loopbackServer: server, sessions });
    vpnServer.on('error', error => console.error(`VPN listener unavailable: ${error.message}`));
    vpnServer.listen(port, vpn.address, () => console.log(`ARRA VPN access: http://${vpn.hostname}:${port} (${vpn.authMode === 'NO_AUTH' ? 'NO_AUTH — VPN peers have full access' : vpn.authMode + ' — unlock link required'})`));
    // The existing Timeline remains on localhost. Both entry points share the
    // app's auth sessions; no second login or cookie collision across ports.
    for (const address of ['127.0.0.1', vpn.address]) {
      const timeline = createVpnProxy({ ...vpn, port: 47882, upstreamPort: 47881, sessions });
      timeline.on('error', error => console.error(`Timeline bridge unavailable on ${address}: ${error.message}`));
      timeline.listen(47882, address, () => console.log(`ARRA Timeline bridge: ${address}:47882 → localhost:47881`));
      timelineServers.push(timeline);
    }
  }
} catch (error) {
  console.error(`VPN access disabled: ${error.message}`);
}

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  console.log(`[${new Date().toISOString()}] Stopping backend PID ${process.pid}`);
  vpnServer?.close();
  vpnServer?.closeAllConnections();
  for (const timeline of timelineServers) {
    timeline.close();
    timeline.closeAllConnections();
  }
  await server.app.close();
  server.close(() => process.exit(0));
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => { void shutdown(); });
}

// Private parent pipe, not an unauthenticated HTTP control endpoint. Closing
// the tray also closes this pipe, so an orphan backend can finish gracefully.
if (process.env.CC_CHAT_DESKTOP === '1') {
  const input = createInterface({ input: process.stdin });
  input.on('line', (line) => { if (line === 'shutdown') void shutdown(); });
  input.once('close', () => { void shutdown(); });
}
