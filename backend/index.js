// M4 backend entry point.  npm start  |  npm run mock (forces built-in stubs)
import path from 'node:path';
import { REPO_ROOT, loadConfig } from './src/config.js';
import { loadModules } from './src/modules.js';
import { createApp, createLogger } from './src/app.js';

// Load the repo-root .env if present (does not override variables already set in the shell).
try {
  process.loadEnvFile(path.join(REPO_ROOT, '.env'));
} catch {
  /* no .env: fine, defaults + shell env apply */
}

const config = loadConfig(process.env, process.argv.includes('--mock') ? { useStubs: true } : {});
const log = createLogger(config.logRequests);
const modules = await loadModules(config, log);
const { app, state } = createApp({ config, modules, log });

const server = app.listen(config.port, () => {
  log.info({
    msg: `backend listening on http://localhost:${config.port}`,
    vision: `${config.visionMode} -> ${modules.visionActive}`,
    content: `${config.contentMode} -> ${modules.contentActive}`,
    offline_demo_mode: state.offline,
    offline_cache_entries: state.cache.entries.length,
    min_confidence: config.minConfidence,
  });
});
server.requestTimeout = Math.max(config.visionTimeoutMs + config.contentTimeoutMs + 5000, 30000);

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));
