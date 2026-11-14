// Stub -> real integration switch.
// Contract §10: /vision and /content are imported ONLY when VISION_MODE / CONTENT_MODE = live.
// In live mode, if the file is missing or the export is not a function (module not merged yet),
// we fall back to the stub, log a loud warning, and report it in GET /health (`*_active`).
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT } from './config.js';
import { stubAnalyzeImage, stubGenerateNarration } from './stubs.js';

async function tryImport(folder, exportName, log) {
  const file = path.join(REPO_ROOT, folder, 'index.js');
  if (!existsSync(file)) {
    log.warn({ msg: `live mode requested but ${folder}/index.js does not exist; using built-in stub` });
    return null;
  }
  try {
    const mod = await import(pathToFileURL(file).href);
    if (typeof mod[exportName] !== 'function') {
      log.warn({ msg: `${folder}/index.js has no exported function ${exportName}(); using built-in stub` });
      return null;
    }
    return mod[exportName];
  } catch (err) {
    log.warn({ msg: `failed to import ${folder}/index.js; using built-in stub`, error: err.message });
    return null;
  }
}

/**
 * @returns {{ analyzeImage, generateNarration, visionActive: 'live'|'stub', contentActive: 'live'|'stub' }}
 * Stub functions are tagged with `.isStub = true` so the app knows it may pass `x-mock-scenario`.
 */
export async function loadModules(config, log) {
  const wantVision = config.visionMode === 'live' && !config.useStubs;
  const wantContent = config.contentMode === 'live' && !config.useStubs;
  const liveVision = wantVision ? await tryImport('vision', 'analyzeImage', log) : null;
  const liveContent = wantContent ? await tryImport('content', 'generateNarration', log) : null;
  return {
    analyzeImage: liveVision ?? tagStub(stubAnalyzeImage),
    generateNarration: liveContent ?? tagStub(stubGenerateNarration),
    visionActive: liveVision ? 'live' : 'stub',
    contentActive: liveContent ? 'live' : 'stub',
  };
}

export function tagStub(fn) {
  const wrapped = (...args) => fn(...args);
  wrapped.isStub = true;
  return wrapped;
}
