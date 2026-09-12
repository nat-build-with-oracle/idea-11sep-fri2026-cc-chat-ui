import { createServer } from './app.mjs';

const port = Number.parseInt(process.env.PORT || '4318', 10);
const server = await createServer({
  dataDir: process.env.CC_CHAT_DATA_DIR,
  cwd: process.env.CC_CHAT_CWD || process.cwd(),
});
server.listen(port, '127.0.0.1', () => {
  console.log(`Claude Chat UI listening on http://127.0.0.1:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    await server.app.close();
    server.close(() => process.exit(0));
  });
}
