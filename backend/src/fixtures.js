// Demo fixtures (contract §9.3): demo/fixtures/<id>.<lang>.json, else demo/fixtures/<id>.json.
// Files are read on every request, so a fixture can be edited during rehearsal without a restart.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { ApiError } from './errors.js';
import { ERROR_STATUS, FIXTURE_ID_RE, LANGS } from './contract.js';

/** @returns {{ status: number, body: object }} */
export function loadFixture(dir, id, lang) {
  if (!FIXTURE_ID_RE.test(id)) throw new ApiError('INVALID_INPUT', 'demo_fixture_id must match /^[a-z0-9_-]{1,64}$/.');
  const candidates = [path.join(dir, `${id}.${lang}.json`), path.join(dir, `${id}.json`)];
  const file = candidates.find((f) => existsSync(f));
  if (!file) throw new ApiError('INVALID_INPUT', `Unknown demo_fixture_id "${id}".`);
  let body;
  try {
    body = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new ApiError('INVALID_INPUT', `Demo fixture "${id}" is not valid JSON.`);
  }
  const status = body && body.error ? ERROR_STATUS[body.error.code] ?? 504 : 200;
  return { status, body };
}

export function listFixtures(dir) {
  if (!existsSync(dir)) return [];
  const byId = new Map();
  for (const name of readdirSync(dir)) {
    const m = name.match(/^([a-z0-9_-]{1,64})(?:\.(ro|en))?\.json$/);
    if (!m) continue;
    const [, id, lang] = m;
    const entry = byId.get(id) ?? { id, langs: [], kind: 'success', style: null, building_name: null, error_code: null };
    if (lang) entry.langs.push(lang);
    else entry.langs = [...new Set([...entry.langs, ...LANGS])];
    try {
      const body = JSON.parse(readFileSync(path.join(dir, name), 'utf8'));
      if (body.error) Object.assign(entry, { kind: 'error', error_code: body.error.code });
      else Object.assign(entry, { style: body.style ?? null, building_name: body.narration?.building_name ?? entry.building_name });
    } catch { /* listed but unreadable; /analyze will report it */ }
    entry.langs = [...new Set(entry.langs)].sort();
    byId.set(id, entry);
  }
  return [...byId.values()].sort((a, b) => a.kind.localeCompare(b.kind) * -1 || a.id.localeCompare(b.id));
}
