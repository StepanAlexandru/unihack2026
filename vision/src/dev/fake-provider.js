/**
 * Scripted provider for tests. Each step is a string (model text), an Error (thrown), "hang"
 * (never settles, ignores the abort signal), or a function (args) => text | Promise<text>.
 */
export function scriptedProvider(steps, { name = "fake", model = "fake-1" } = {}) {
  const calls = [];
  let i = 0;
  return {
    name,
    model,
    calls,
    async generate(args) {
      calls.push(args);
      const step = steps[Math.min(i++, steps.length - 1)];
      if (step === "hang") return new Promise(() => {});
      if (step instanceof Error) throw step;
      if (typeof step === "function") return { text: await step(args) };
      return { text: step };
    },
  };
}

/** Raw model JSON (box_2d format), with overrides. */
export function rawOutput(overrides = {}) {
  return JSON.stringify({
    image_assessment: "facade",
    evidence: ["whiplash curves"],
    style: "Secession",
    confidence: 0.9,
    details: [{ label: "Maiden mascaron", type: "mask", box_2d: [100, 200, 300, 400], raw_text: null }],
    ...overrides,
  });
}
