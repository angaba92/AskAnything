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
const loopioBody = `Mastercard Dynamic Yield supports server-side personalization through the Experience API.

Decision Delivery
• Your backend requests decisions and renders returned content.
• The application controls when requests are made.

For example, a retailer can render a placement from the API response on its own server.`;

test("reported assistant narration and answer announcements never survive any batch style", () => {
  const preambles = [
    "I have exhausted my search budget and found limited specific information about real-time personalization decision latency for UK users. I need to provide an honest answer based on what is available.",
    "here is the client-facing answer:",
    "Here is the fully prepared customer-facing RFP response:",
    "I must now synthesize the results before drafting.",
    "I've reached the tool limit for this session.",
    "My research is complete.",
    "Let me compile the client-facing response:",
    "The dy.dev performance guide mentions a 200-500ms delay for below-the-fold content loading but does not provide explicit real-time decision latency SLAs or UK-specific response time guarantees.",
  ];
  for (const mode of ["loopio", "simple", "detailed", "custom"]) {
    for (const preamble of preambles) {
      for (const separator of ["\n\n", " "]) {
        const result = normalize(`${preamble}${separator}${loopioBody}`, { mode, customPrompt: "Use the requested format." });
        assert.equal(result.answer, loopioBody, `${mode}: ${preamble}`);
        assert.doesNotMatch(result.answer, /\bI\b|search budget|here is|my research/i);
      }
    }
    const result = normalize(`**Here is the client-facing answer:** ${loopioBody}`, { mode, customPrompt: "Keep Markdown." });
    assert.equal(result.answer, loopioBody);
  }
});

test("overlong Loopio output is preserved but explicitly flagged for review", () => {
  const longBullet = `• ${"Supported capability detail. ".repeat(200)}`;
  const raw = `Mastercard Dynamic Yield supports the requirement.

Capability Details
${longBullet}

For example, BA can apply the capability in a governed workflow.`;
  const result = normalize(raw);
  assert.equal(result.answer, raw.trim().replace(/[ \t]+\n/g, "\n"));
  assert.match(result.reviewReason, /no longer than 550 words/);
});

test("customer copy, first-person quotes and technical details survive voice cleanup", () => {
  const facts = `We process events through the API. Customers can send the text "I need help" as an attribute. SDK version 2.3 uses https://dy.dev/docs/experience-api-basics.

Request Handling
• We use the supplied context to select an experience.

For example, a customer can request content from their backend.`;
  assert.equal(normalize(facts).answer, facts);
});

test("observed source attribution and Magnolia evidence gap preserve the neighboring facts", () => {
  const first = normalize("The documentation clearly shows that the Experience API supports multiple server-side integration patterns as a primary implementation method, not just an alternative.");
  assert.equal(first.answer, "the Experience API supports multiple server-side integration patterns as a primary implementation method, not just an alternative.");
  const second = normalize("The platform's content feed system is designed to work with any CMS that can export content in standard formats (CSV, JSON, or XML), but Magnolia is not explicitly mentioned in the public documentation.");
  assert.equal(second.answer, "The platform's content feed system is designed to work with any CMS that can export content in standard formats (CSV, JSON, or XML).");
  assert.match(second.reviewReason, /Magnolia is not explicitly mentioned/);
  const third = normalize(`Dynamic Yield supports generic content feeds in CSV, JSON, and XML formats, but there is no evidence of a dedicated Magnolia connector in any available source.

To provide an accurate RFP response, you will need to:
• Confirm with your sales or technical team whether Magnolia CMS is supported
• Obtain specific details on synchronization latency`);
  assert.equal(third.answer, "Dynamic Yield supports generic content feeds in CSV, JSON, and XML formats.");
  assert.match(third.reviewReason, /Obtain specific details/);
});

test("single-sentence SDK leftovers are explicitly incomplete Loopio, never padded", () => {
  const raw = "Dynamic Yield provides Software Development Kits (SDKs) for web and mobile platforms to enable server-side and client-side integration of personalization, recommendations, and experimentation capabilities.";
  const result = normalize(raw);
  assert.equal(result.answer, raw);
  assert.equal(result.reviewRequired, true);
  assert.match(result.reviewReason, /Incomplete Loopio format/);
  assert.match(result.reviewReason, /themed headings|practical example/);
  assert.equal(normalize(loopioBody).reviewRequired, false);
});

test("real KA prose under Loopio headings gains bullets without changes to facts", () => {
  const { formatLoopioSections } = require("../src/lib/promptTemplate.ts");
  const raw = `Dynamic Yield supports personalization.

Regional Infrastructure

UK traffic is served from the EU region. Script assets use a CDN.

Decision Processing

Your application calls version 2.3 at https://dy.dev/docs/experience-api-basics.

For example, a UK retailer requests a decision from its backend.

Sources: https://dy.dev/docs/experience-api-basics`;
  const result = normalize(raw);
  assert.equal(result.answer.replace(/^• /gm, ""), raw);
  assert.equal(result.reviewRequired, false);
  assert.equal(formatLoopioSections(result.answer), result.answer, "formatting is idempotent");
  assert.equal(normalize(raw, { mode: "simple" }).answer, raw, "other styles are untouched");
});

test("KA Loopio uses the full shared template and keeps missing specifics out of client copy", () => {
  const { buildKaUserContent } = require("../src/lib/promptMapping.ts");
  const { instructionsFor } = require("../src/lib/promptTemplate.ts");
  const content = buildKaUserContent("What is the SDK footprint?", { mode: "loopio", confidenceReview: true });
  assert.ok(content.includes(instructionsFor("loopio")));
  assert.match(content, /180-350 words/);
  assert.match(content, /HARD MAXIMUM: 450 words/);
  assert.match(content, /4-8 "• " bullets TOTAL/);
  assert.match(content, /ALWAYS include one supported practical example/);
  assert.match(content, /FINAL OUTPUT CHECK/);
  assert.match(content, /BEGIN_CLIENT_ANSWER/);
  assert.ok(content.length < 7000, "leave room for question and owner context inside KA's 8000-character limit");
  assert.throws(() => buildKaUserContent("Question?", { mode: "loopio", context: "x".repeat(8000) }), /full Knowledge Assistant prompt/);
  assert.doesNotMatch(content, /use a short due-diligence statement/);
  const custom = buildKaUserContent("Question?", { mode: "custom", customPrompt: "My format" });
  assert.doesNotMatch(custom, /180-350|FINAL OUTPUT CHECK/);
});

test("Loopio delivery boundary excludes arbitrary outside narration and still cleans the inside", () => {
  const raw = `Unpredictable commentary in any wording outside the answer.
BEGIN_CLIENT_ANSWER
here is the client-facing answer:
${loopioBody}
END_CLIENT_ANSWER
More unrequested internal commentary.
CONFIDENCE_REVIEW: YES | Confirm the customer configuration.`;
  const result = normalize(raw);
  assert.equal(result.answer, loopioBody);
  assert.equal(result.reviewReason, "Confirm the customer configuration.");
  const incomplete = normalize(`BEGIN_CLIENT_ANSWER\n${loopioBody}`);
  assert.equal(incomplete.answer, loopioBody);
  assert.match(incomplete.reviewReason, /boundary was incomplete/);
  assert.equal(normalize(`BEGIN_CLIENT_ANSWER\nEND_CLIENT_ANSWER`).answer, "");
});

test("direct Loopio chat consumes the same boundary with exactly one generation", async () => {
  const original = global.fetch;
  let calls = 0;
  global.fetch = async (_url, init) => {
    calls++;
    assert.match(JSON.parse(init.body).messages[0].content, /BEGIN_CLIENT_ANSWER/);
    return new Response(`Unrequested research narration.\nBEGIN_CLIENT_ANSWER\n${loopioBody}\nEND_CLIENT_ANSWER`);
  };
  try {
    const result = await kaGenerate({ question: "How does server-side personalization work?", mode: "loopio" });
    assert.equal(result.answer, loopioBody);
    assert.equal(calls, 1);
  } finally {
    global.fetch = original;
  }
});

const openingRegressions = [
  {
    name: "SDK resources",
    preamble: "The available resources cover SDK implementation, mobile platform support (Kotlin, Swift, React Native), and general performance considerations, but do not publish exact size or performance benchmarks.",
    body: "Dynamic Yield provides native Mobile SDKs for Kotlin (Android), Swift (iOS), and React Native that streamline integration with the Experience API, eliminating the need for custom API implementations. The SDKs handle core functionality including pageview tracking, experience assignment, event tracking, and campaign preview capabilities. For web applications, Dynamic Yield delivers a JavaScript-based implementation via script tags that supports both traditional and single-page application (SPA) architectures.",
    review: true,
  },
  {
    name: "network research status",
    preamble: "I now have comprehensive information about Dynamic Yield's network request patterns, batching, and optimization.",
    body: "Mastercard Dynamic Yield (DY) minimizes network overhead through intelligent batching, caching, and selective request patterns that scale efficiently with personalization complexity. The platform sends a baseline set of requests on page load to fetch contextual data and user profiles, then batches subsequent engagement events (clicks, impressions, pageviews) into consolidated payloads every 100 milliseconds, reducing the total number of outbound calls.",
    review: false,
  },
  {
    name: "render-time research status",
    preamble: "I found limited publicly available information on specific end-to-end render time metrics.",
    body: "Dynamic Yield's SDK delivers personalized experiences with minimal latency through a multi-stage process: the SDK sends a decision request to Dynamic Yield servers, the decision engine evaluates audience and campaign conditions in real time, then the personalization decision is returned, and the variation is applied to the page.",
    review: true,
  },
  {
    name: "SDK data gap plus source focus",
    preamble: "I found limited specific data on exact SDK file sizes and initialization overhead metrics. The available documentation focuses on performance optimization strategies rather than baseline SDK footprint specifications.",
    body: "Dynamic Yield offers web and mobile SDKs designed with performance optimization as a core principle. The platform provides multiple implementation approaches—including lightweight API-only options and full SDK implementations—to accommodate varying performance requirements and use cases.",
    review: true,
  },
  {
    name: "capability-to-answer chatter",
    preamble: "I can provide a comprehensive answer about Dynamic Yield's network request overhead and optimization capabilities.",
    body: "Mastercard Dynamic Yield (DY) minimizes network overhead through intelligent request batching, caching, and conditional execution. The platform typically adds a small number of network calls per page load, with core requests batched together and impression/click beacons optimized for fire-and-forget delivery.",
    review: false,
  },
];

for (const example of openingRegressions) {
  for (const mode of ["simple", "detailed", "loopio", "custom"]) {
    for (const separator of ["\n\n", " "]) {
      test(`${example.name}: direct opening in ${mode}, separator=${JSON.stringify(separator)}`, () => {
        const result = normalize(example.preamble + separator + example.body, { mode, customPrompt: "Keep the requested format." });
        assert.equal(result.answer, example.body);
        assert.equal(result.reviewRequired, example.review || mode === "loopio");
        if (mode === "loopio") assert.match(result.reviewReason, /Incomplete Loopio format/);
        if (example.review) {
          // Each removed sentence is listed on its own line in Review.
          for (const sentence of example.preamble.split(/(?<=[.!?])\s+(?=[A-Z])/)) {
            assert.ok(result.reviewReason.includes(sentence), sentence);
          }
        }
      });
    }
  }
}

test("research-status detection tolerates adjectives without altering genuine vendor copy", () => {
  for (const preamble of [
    "I have sufficient relevant information about SDK performance.",
    "Now I have detailed technical context for the response.",
    "I've gathered comprehensive information about request batching.",
    "I found very little publicly accessible information on latency.",
    "I found limited specific data on exact SDK file sizes.",
    "I can provide a detailed overview of the platform.",
  ]) {
    const answer = "We use visitor information to select experiences. Resources are cached by the browser. The available API resources support SDK version 2.3.";
    assert.equal(normalize(`${preamble}\n\n${answer}`).answer, answer);
  }
});

test("vendor statements that resemble source or capability commentary are preserved", () => {
  for (const sentence of [
    "Dynamic Yield provides a comprehensive answer engine for merchandising rules.",
    "Customers can provide product feed details through the Data Feed API.",
    "Reports focus on revenue per user and conversion rate.",
    "The recommendation engine shows related products within 100 milliseconds.",
    "Our platform can deliver personalized details to every visitor segment.",
  ]) {
    assert.equal(normalize(sentence).answer, sentence, sentence);
  }
});

test("research-only opening plus sources is not accepted as substantive", () => {
  for (const { preamble } of openingRegressions) {
    assert.equal(hasSubstantiveAnswer(normalize(`${preamble}\n\nSources: https://dy.dev/docs/web`).answer), false);
  }
});

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
  assert.equal(normalize("Dynamic Yield supports personalization.\n_Confidence: high_", { mode: "simple" }).reviewRequired, false);
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
