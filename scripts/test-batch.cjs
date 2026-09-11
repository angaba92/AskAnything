const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const ts = require("typescript");

// Use the project's compiler and Node's built-in runner; no test dependencies.
require.extensions[".ts"] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
};

const { normalizeBridgedKaResponse, kaGenerate } = require("../src/lib/providers/ka.ts");
const { hasSubstantiveAnswer } = require("../src/lib/responsePolicy.ts");
const { readBatchAnswer } = require("../src/lib/batchResponse.ts");
const opts = { question: "What is the SDK footprint?", mode: "loopio", confidenceReview: true };
const normalize = (text, overrides = {}) => normalizeBridgedKaResponse(text, { ...opts, ...overrides });

test("mixed prose preserves SDK facts, decimals, caveats and citations", () => {
  const raw = "Based on the available documentation, Dynamic Yield loads asynchronously. The SDK uses version 2.3 and requests https://dy.dev/docs/experience-api-basics. Exact bundle sizes are not documented.\n\nSources: https://support.dynamicyield.com/hc/en-us/articles/123\nCONFIDENCE_REVIEW: YES | Verify bundle size.";
  const result = normalize(raw);
  assert.match(result.answer, /loads asynchronously/);
  assert.match(result.answer, /version 2\.3/);
  assert.match(result.answer, /https:\/\/dy\.dev\/docs\/experience-api-basics/);
  assert.doesNotMatch(result.answer, /bundle sizes are not documented/);
  assert.doesNotMatch(result.answer, /Based on|CONFIDENCE_REVIEW/);
  assert.match(result.reviewReason, /Verify bundle size/);
  assert.match(result.reviewReason, /bundle sizes are not documented/);
});

const sdkRegression = `The available documentation covers SDK implementation guides for mobile platforms (Kotlin, React Native) and web script integration, but does not include quantified performance metrics such as:
• Typical production SDK size (in kilobytes or megabytes)
• Required dependencies and their sizes
• Initialization overhead or time-to-interactive measurements
• Specific optimization techniques or feature flags to reduce footprint

Dynamic Yield provides SDKs for web and mobile applications designed to integrate personalization and data collection capabilities. However, specific production SDK size metrics, initialization overhead measurements, and documented footprint-reduction options are not detailed in the publicly available developer documentation.

For detailed technical specifications regarding SDK performance characteristics, bundle sizes, and optimization strategies, please contact your Dynamic Yield account representative or technical support team, as this information may be available through direct technical consultation or in implementation guides tailored to your specific platform and use case.`;

for (const mode of ["simple", "detailed", "loopio", "custom"]) {
  test(`exact reported SDK answer is client-facing in ${mode}`, () => {
    const result = normalize(sdkRegression, { mode, customPrompt: "Write three paragraphs and an example." });
    assert.equal(result.answer, "Dynamic Yield provides SDKs for web and mobile applications designed to integrate personalization and data collection capabilities.");
    assert.doesNotMatch(result.answer, /documentation|contact|quantified|Typical production|Required dependencies|Initialization overhead|Specific optimization/i);
    assert.equal(result.reviewRequired, true);
    for (const detail of ["Typical production SDK size", "Required dependencies", "Initialization overhead", "Specific optimization techniques", "not detailed", "please contact"]) {
      assert.ok(result.reviewReason.includes(detail), detail);
    }
  });
}

test("a research-led list across a blank line does not leak orphaned bullets", () => {
  const result = normalize("The available documentation does not include these figures:\n\n- SDK size\n- Memory footprint\n\nMastercard Dynamic Yield supports personalization.\n\n- API calls can be batched.\n- Payloads can be reduced.");
  assert.doesNotMatch(result.answer, /SDK size|Memory footprint/);
  assert.match(result.answer, /API calls can be batched/);
  assert.match(result.answer, /Payloads can be reduced/);
});

test("only a documentation caveat is moved from a mixed sentence", () => {
  const result = normalize("Dynamic Yield supports SDK version 2.3 and asynchronous loading; however, exact bundle sizes are not documented.\n\nA UK-only database is not supported, but UK traffic can be served from Germany.");
  assert.match(result.answer, /SDK version 2\.3 and asynchronous loading\./);
  assert.match(result.answer, /UK-only database is not supported, but UK traffic can be served from Germany/);
  assert.doesNotMatch(result.answer, /not documented/);
  assert.match(result.reviewReason, /exact bundle sizes/);
});

test("one caveat cannot delete a bullet list or turn a real negative into Yes", () => {
  const result = normalize("We support server-side personalization.\n\n- Requests can be batched.\n- A UK-only database is not supported.\n- Response time depends on network latency.");
  assert.match(result.answer, /Requests can be batched/);
  assert.match(result.answer, /UK-only database is not supported/);
  assert.match(result.answer, /network latency/);
  assert.equal(result.reviewRequired, true);
});

test("process sentences on the same line do not consume the actual answer", () => {
  const result = normalize("Perfect. Now I have sufficient information. Let me compose the answer. Dynamic Yield supports asynchronous loading.\n\n## Sources\n- [Developer guide](https://dy.dev/docs/web)");
  assert.match(result.answer, /^Dynamic Yield supports/);
  assert.match(result.answer, /https:\/\/dy\.dev\/docs\/web/);
  assert.doesNotMatch(result.answer, /Perfect|Let me|sufficient information/);
});

test("observed render-time research preamble is removed without deleting capabilities", () => {
  const result = normalize("I found information about script performance optimization and general best practices, but specific end-to-end render time metrics are not explicitly documented in the publicly available sources. The documentation references script loading times and performance optimization strategies, but does not provide a definitive statement about timing.\n\nMastercard Dynamic Yield delivers personalized experiences with minimal impact on page load performance.\n\n- Preconnect tags reduce connection setup time.\n- Campaign archiving reduces script payload.");
  assert.match(result.answer, /^Mastercard Dynamic Yield delivers/);
  assert.match(result.answer, /Campaign archiving/);
  assert.doesNotMatch(result.answer, /I found|The documentation/);
});

test("formatted confidence markers and high-confidence notes stay out of answers", () => {
  const result = normalize("Dynamic Yield supports personalization.\n**CONFIDENCE_REVIEW:** YES | Check SLA.\n_Confidence: high_");
  assert.doesNotMatch(result.answer, /CONFIDENCE|Confidence|Check SLA/);
  assert.match(result.reviewReason, /Check SLA/);
  assert.equal(normalize("Dynamic Yield supports personalization.\n_Confidence: high_").reviewRequired, false);
});

test("source-only, header-only and metadata-only drafts never count as answers", () => {
  for (const raw of [
    "Sources: https://dy.dev/docs/web",
    "## Sources\n- [A guide about the Experience API](https://dy.dev/docs/web)",
    "**SDK Performance**",
    "CONFIDENCE_REVIEW: YES | Cannot verify latency.",
    "I cannot find this information.\n\nSources: https://dy.dev/docs/web",
    "I was unable to locate specific published response time or latency commitments.\n\nThe only latency-related reference I found was in internal troubleshooting guidance, not a formal SLA commitment.",
  ]) assert.equal(hasSubstantiveAnswer(normalize(raw).answer), false, raw);
});

test("custom instructions keep formatting and content while removing protocol metadata", () => {
  const result = normalize("## Custom heading\n\nA useful custom response.\nCONFIDENCE_REVIEW: NO | Confident", {
    mode: "custom", customPrompt: "Keep Markdown.",
  });
  assert.match(result.answer, /^## Custom heading/);
  assert.match(result.answer, /A useful custom response/);
  assert.doesNotMatch(result.answer, /CONFIDENCE_REVIEW/);
});

test("internal source links are excluded in standard profiles", () => {
  const result = normalize("Dynamic Yield supports audience targeting.\n\n## Sources\n- [Guru card](https://app.getguru.com/card/abc)\n- [Guide](https://dy.dev/docs/web)");
  assert.doesNotMatch(result.answer, /getguru|Guru/);
  assert.doesNotMatch(result.sourcesText, /getguru/);
  assert.equal(result.sources.some((s) => /getguru/.test(s.uri)), false);
});

test("HTTP authentication and source-only API errors are actionable", async () => {
  await assert.rejects(readBatchAnswer(new Response("Login", { status: 401 })), /authentication/);
  await assert.rejects(readBatchAnswer(new Response("<html>Error</html>", { status: 502 })), /without JSON/);
  await assert.rejects(readBatchAnswer(Response.json({ answer: "Sources: https://dy.dev/docs/web" })), (e) => e.status === 422);
});

test("direct batch and Redo generate once, preserve owner context, and match bridge normalization", async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  const raw = "Dynamic Yield supports personalized experiences. Exact timings are not documented.\nCONFIDENCE_REVIEW: YES | Verify timings.";
  global.fetch = async (_url, init) => {
    calls++;
    assert.match(JSON.parse(init.body).messages[0].content, /OWNER NOTES/);
    return new Response(raw);
  };
  try {
    const request = { ...opts, question: "List ISO certifications", context: "OWNER NOTES: verify the latest certificates." };
    assert.deepEqual(await kaGenerate(request), normalizeBridgedKaResponse(raw, request));
    assert.equal(calls, 1);
  } finally {
    global.fetch = originalFetch;
  }
});
