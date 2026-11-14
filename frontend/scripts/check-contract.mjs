// Validates every mock in src/mocks against the contract shape checks.
// Run: npm run check:contract
import { MOCK_SCENARIOS, CONTRACT_ANALYZE_EXAMPLE, mockNarrate } from '../src/mocks/contractExamples.js';
import { checkAnalyzeResponse, checkNarrateResponse, checkErrorResponse, STYLES } from '../src/services/contractShape.js';

let failed = 0;
const report = (name, problems, extra = '') => {
  if (problems.length) {
    failed++;
    console.log(`✗ ${name}\n   - ${problems.join('\n   - ')}`);
  } else console.log(`✓ ${name}${extra}`);
};
const words = (s) => s.trim().split(/\s+/).length;

report('contract §6 example', checkAnalyzeResponse(CONTRACT_ANALYZE_EXAMPLE));

for (const [id, sc] of Object.entries(MOCK_SCENARIOS)) {
  if (sc.hang) {
    console.log(`· ${id} (hangs, exercises client timeout)`);
    continue;
  }
  for (const lang of ['en', 'ro']) {
    const { status, body } = sc.respond(lang);
    const problems = status === 200 ? checkAnalyzeResponse(body) : checkErrorResponse(body);
    if (status === 200 && id !== 'contract_example') {
      const w = words(body.narration.text);
      if (w < 35 || w > 40) problems.push(`narration.text has ${w} words (35–40 expected)`);
    }
    report(`${id}.${lang} → ${status}`, problems, status === 200 ? ` (${words(body.narration.text)} words)` : '');
  }
}

for (const style of ['Secession', 'Baroque']) {
  for (const lang of ['en', 'ro']) report(`narrate ${style}.${lang}`, checkNarrateResponse(mockNarrate(style, lang)));
}
if (STYLES.length !== 5) failed++;

console.log(failed ? `\n${failed} check(s) failed` : '\nAll contract checks passed');
process.exit(failed ? 1 : 0);
