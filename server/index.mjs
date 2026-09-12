import { createServer } from './app.mjs';
import { createInterface } from 'node:readline';

const port = Number.parseInt(process.env.PORT || '4318', 10);
const server = await createServer({
  dataDir: process.env.CC_CHAT_DATA_DIR,
  cwd: process.env.CC_CHAT_CWD || process.cwd(),
});
server.listen(port, '127.0.0.1', () => {
  console.log(`[${new Date().toISOString()}] ARRA Claude Code listening on http://127.0.0.1:${port} (PID ${process.pid})`);
});

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  console.log(`[${new Date().toISOString()}] Stopping backend PID ${process.pid}`);
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
