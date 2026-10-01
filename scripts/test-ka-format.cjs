const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
};

const { normalizeKaSourceFormat, parseKaSources, isKaNoAnswer, isKaErrorPage } = require("../src/lib/kaClient.ts");
const { checkGrounding } = require("../src/lib/responsePolicy.ts");
const { normalizeBridgedKaResponse } = require("../src/lib/providers/ka.ts");
const { restoreRows, resumeStartRow } = require("../src/lib/batchPersistence.ts");

const body = "Dynamic Yield supports server-side personalization through the Experience API, which returns decisions to your backend.";

test("new inline Source line is adapted to the canonical Sources line", () => {
  const cases = [
    `${body}\n\nSource: [Experience API](https://dy.dev/docs/experience-api)`,
    `${body}\n\nSource: Experience API (https://dy.dev/docs/experience-api)`,
    `${body}\nSource: [Experience API](https://dy.dev/docs/experience-api), [Help Center](https://support.dynamicyield.com/hc/en-us/articles/1)`,
  ];
  for (const text of cases) {
    const adapted = normalizeKaSourceFormat(text);
    assert.match(adapted, /\n\nSources: https:\/\/dy\.dev\/docs\/experience-api(?:; https:\/\/support\.dynamicyield\.com\/hc\/en-us\/articles\/1)?$/);
    assert.ok(!/^Source:/m.test(adapted), adapted);
    assert.equal(parseKaSources(text)[0].title, "Experience API");
    assert.ok(adapted.startsWith(body));
    assert.equal(parseKaSources(text)[0].uri, "https://dy.dev/docs/experience-api");
  }
  assert.equal(parseKaSources(cases[2]).length, 2);
});

test("legacy ## Sources format and answers without sources are untouched", () => {
  const legacy = `${body}\n\n## Sources\n- [Experience API](https://dy.dev/docs/experience-api) — reason`;
  assert.equal(normalizeKaSourceFormat(legacy), legacy);
  assert.equal(parseKaSources(legacy)[0].reasoning, "reason");
  assert.equal(normalizeKaSourceFormat(body), body);
  // A "Source:" mention without URL mid-answer is content, not a citation.
  const prose = `Source: customer data stays in the EU.\n\n${body}`;
  assert.equal(normalizeKaSourceFormat(prose), prose);
});

test("bridged answers with the new format keep sources and do not duplicate the Source line", () => {
  const r = normalizeBridgedKaResponse(
    `${body}\n\nSource: [Experience API](https://dy.dev/docs/experience-api)`,
    { question: "Server-side?", mode: "simple", confidenceReview: true },
  );
  assert.equal(r.sourcesText, "https://dy.dev/docs/experience-api");
  assert.equal((r.answer.match(/dy\.dev\/docs\/experience-api/g) ?? []).length, 1, r.answer);
  assert.equal(r.reviewRequired, false, r.reviewReason);
});

test("NO_ANSWER token is never exported as an answer", () => {
  assert.ok(isKaNoAnswer("NO_ANSWER"));
  assert.ok(isKaNoAnswer("  **NO_ANSWER** "));
  assert.ok(!isKaNoAnswer("We return NO_ANSWER in some cases."));
  const r = normalizeBridgedKaResponse("NO_ANSWER", { question: "x", mode: "loopio", confidenceReview: true });
  assert.equal(r.answer, "");
  assert.ok(r.reviewRequired);
});

test("grounding: unsourced answers are NOT sent to review; verifiable claims get official references", () => {
  const plain = checkGrounding("Dynamic Yield supports audience segmentation for web and apps.", []);
  assert.deepEqual(plain.reviewReasons, []);
  assert.deepEqual(plain.fallbackReferences, []);

  const cert = checkGrounding("Dynamic Yield is ISO 27001 and SOC 2 Type II certified and GDPR compliant.", []);
  assert.deepEqual(cert.reviewReasons, []);
  assert.deepEqual(cert.fallbackReferences, ["https://www.dynamicyield.com/security/", "https://www.dynamicyield.com/dpa/"]);

  const sla = checkGrounding("The platform targets 99.9% uptime under the SLA.", ["https://dy.dev/docs/x"]);
  assert.deepEqual(sla.fallbackReferences, ["https://www.dynamicyield.com/sla/"]);

  const already = checkGrounding("Dynamic Yield is ISO 27001 certified.", ["https://www.dynamicyield.com/security"]);
  assert.deepEqual(already.fallbackReferences, []);

  // Performance percentages or "general availability" are not SLA claims.
  assert.deepEqual(checkGrounding("Customers saw a 12% lift. The feature reached general availability.", []).fallbackReferences, []);

  const external = checkGrounding("Dynamic Yield supports segmentation.", ["https://dy.dev/x", "https://medium.com/post"]);
  assert.equal(external.reviewReasons.length, 1);
  assert.match(external.reviewReasons[0], /outside official/);
  assert.deepEqual(checkGrounding("", []).reviewReasons, []);
});

test("bridged answers: no source is not a review; certifications/SLAs end with official references", () => {
  const plain = normalizeBridgedKaResponse(body, { question: "Server-side?", mode: "simple", confidenceReview: true });
  assert.equal(plain.reviewRequired, false, plain.reviewReason);
  assert.equal(plain.sourcesText, "");

  const claim = "Mastercard Dynamic Yield holds ISO 27001 certification and commits to 99.9% uptime in its SLA.";
  const r = normalizeBridgedKaResponse(`${claim}\n\nSource: [Experience API](https://dy.dev/docs/experience-api)`, { question: "Certs?", mode: "simple", confidenceReview: true });
  assert.equal(r.reviewRequired, false, r.reviewReason);
  assert.match(r.answer, /Sources: https:\/\/dy\.dev\/docs\/experience-api; https:\/\/www\.dynamicyield\.com\/security\/; https:\/\/www\.dynamicyield\.com\/sla\/$/);
  assert.equal(r.sourcesText, "https://dy.dev/docs/experience-api; https://www.dynamicyield.com/security/; https://www.dynamicyield.com/sla/");
  assert.ok(r.answer.startsWith(claim));
});

test("persistence: in-flight row is reset and resume starts at first pending row", () => {
  const rows = [
    { status: "done" }, { status: "running" }, { status: "pending" }, { status: "skipped" },
  ].map((r, i) => ({ question: `q${i}`, answer: "", review: "", reviewApproved: false, expert: "", sources: "", sourceRow: i + 1, ...r }));
  const restored = restoreRows(rows);
  assert.deepEqual(restored.map((r) => r.status), ["done", "pending", "pending", "skipped"]);
  assert.equal(resumeStartRow(restored, 1), 2);
  assert.equal(resumeStartRow(restored, 3), 3);
  assert.equal(resumeStartRow(restored.map((r) => ({ ...r, status: "done" })), 2), 2);
});

test("gateway HTML error pages are transport errors, never answers", () => {
  const page = "<html>\n<head><title>503 Service Temporarily Unavailable</title></head>\n<body></body>\n</html>";
  assert.ok(isKaErrorPage(page));
  assert.ok(!isKaErrorPage(body));
  assert.throws(() => normalizeBridgedKaResponse(page, { question: "x", mode: "simple" }), (e) => e.status === 502);
});

test("search-process narration seen live on the updated KA never reaches the client answer", () => {
  const leaks = [
    "The searches have not returned specific information about ISO 27001 certification or uptime SLA.",
    "My searches did not return details on uptime.",
    "No results were found for ISO 27001 in the knowledge base.",
    "The available results did not surface specific certification details.",
  ];
  for (const leak of leaks) {
    const r = normalizeBridgedKaResponse(`${leak}\n\nMastercard Dynamic Yield maintains a comprehensive security and compliance posture.`, { question: "q", mode: "simple", confidenceReview: true });
    assert.ok(!r.answer.includes(leak.slice(0, 25)), r.answer);
    assert.match(r.answer, /comprehensive security/);
  }
});

test("Source line inside the Loopio frame (before END_CLIENT_ANSWER / CONFIDENCE_REVIEW) is converted", () => {
  const raw = `BEGIN_CLIENT_ANSWER\n${body}\n\nSource: Implement Mobile SDK (https://dy.dev/docs/implement-mobile-sdk)\n\nEND_CLIENT_ANSWER\n\nCONFIDENCE_REVIEW: YES | Latency figures are not published.`;
  const adapted = normalizeKaSourceFormat(raw);
  assert.match(adapted, /Sources: https:\/\/dy\.dev\/docs\/implement-mobile-sdk\n\nEND_CLIENT_ANSWER\n\nCONFIDENCE_REVIEW: YES/);
  assert.equal(parseKaSources(raw)[0].title, "Implement Mobile SDK");
  const r = normalizeBridgedKaResponse(raw, { question: "Render time?", mode: "loopio", confidenceReview: true });
  assert.ok(!/^Source:/m.test(r.answer), r.answer);
  assert.match(r.answer, /Sources: https:\/\/dy\.dev\/docs\/implement-mobile-sdk$/);
  assert.equal(r.sourcesText, "https://dy.dev/docs/implement-mobile-sdk");
  assert.match(r.reviewReason, /Latency figures are not published/);
});

test("framed NO_ANSWER with research narration is recognised and keeps the KA reason", () => {
  const raw = "Based on my search of available sources, I have not found latency figures.\n\nBEGIN_CLIENT_ANSWER\nNO_ANSWER\nEND_CLIENT_ANSWER\n\nCONFIDENCE_REVIEW: YES | UK latency benchmarks are not published.";
  assert.ok(isKaNoAnswer(raw));
  assert.ok(!isKaNoAnswer(`BEGIN_CLIENT_ANSWER\n${body}\nEND_CLIENT_ANSWER`));
  const r = normalizeBridgedKaResponse(raw, { question: "Latency?", mode: "loopio", confidenceReview: true });
  assert.equal(r.answer, "");
  assert.match(r.reviewReason, /^NO_ANSWER:/);
  assert.match(r.reviewReason, /UK latency benchmarks are not published/);
  assert.ok(!/Based on my search/.test(r.reviewReason));
});

test("live prod leak (Magnolia): documentation gap and account-rep referral move to review, facts stay", () => {
  const raw = "Dynamic Yield supports content synchronization through product feeds, content feeds, and variation feeds from various sources, but specific integration details for Magnolia CMS are not available in our current documentation.\n\nIf you require integration with Magnolia CMS, we recommend contacting your account representative to discuss custom implementation options using Dynamic Yield's APIs and data feed capabilities.";
  const r = normalizeBridgedKaResponse(raw, { question: "Magnolia sync?", mode: "simple", confidenceReview: true });
  assert.match(r.answer, /^Dynamic Yield supports content synchronization through product feeds/);
  assert.ok(!/current documentation|account representative/i.test(r.answer), r.answer);
  assert.ok(r.reviewRequired);
  assert.match(r.reviewReason, /Magnolia CMS are not available|account representative/);
});

test("multilingual: German Loopio answer passes structure checks and keeps umlaut headings", () => {
  const raw = `BEGIN_CLIENT_ANSWER
Mastercard Dynamic Yield personalisiert Produktlisten bereits während der laufenden Session in Echtzeit.

Echtzeit-Signale und Ranking
• Klicks, Warenkorb- und Kaufereignisse fließen sofort in das Nutzerprofil ein.
• Das Ranking der Produktlistenseite wird beim nächsten Seitenaufruf aktualisiert.

Steuerung durch Fachbereiche
• Merchandising-Regeln können Produkte nach Kategorie, Land und Zeitraum priorisieren.
• Regeln lassen sich auf Segmente oder Kanäle beschränken.

Zum Beispiel kann ein Modehändler Artikel in der wahrscheinlichen Kundengröße bevorzugt ausspielen.

Quelle: [Experience API Basics](https://dy.dev/docs/experience-api-basics)
END_CLIENT_ANSWER
CONFIDENCE_REVIEW: NO | Confident and sufficiently supported`;
  const r = normalizeBridgedKaResponse(raw, { question: "Wird bereits während einer laufenden Session auf das Kundenverhalten eingegangen?", mode: "loopio", confidenceReview: true });
  assert.equal(r.reviewRequired, false, r.reviewReason);
  assert.match(r.answer, /^Mastercard Dynamic Yield personalisiert/);
  assert.match(r.answer, /Echtzeit-Signale und Ranking\n• Klicks/);
  assert.match(r.answer, /Sources: https:\/\/dy\.dev\/docs\/experience-api-basics$/);
  assert.ok(!/Quelle:/.test(r.answer));
});

test("multilingual: German, Spanish and French research narration never reaches the client answer", () => {
  const cases = [
    ["Basierend auf meiner Suche habe ich keine spezifischen Informationen zu Snowplow gefunden.", "Dynamic Yield kann Ereignisdaten über die Export-API an externe Systeme übergeben."],
    ["Die verfügbaren Quellen enthalten keine Angaben zur Speicherdauer.", "Daten werden in Rechenzentren der EU verarbeitet."],
    ["Bitte wenden Sie sich an Ihren Account Manager für weitere Details.", "Rollen und Berechtigungen können pro Shop vergeben werden."],
    ["No he encontrado información específica sobre Magnolia.", "Dynamic Yield sincroniza contenido mediante feeds de datos."],
    ["Je n'ai pas trouvé d'informations précises sur la latence.", "Dynamic Yield sert les décisions depuis le centre de données de l'UE."],
  ];
  for (const [narration, fact] of cases) {
    const r = normalizeBridgedKaResponse(`${narration}\n\n${fact}`, { question: "Frage?", mode: "simple", confidenceReview: true });
    assert.ok(!r.answer.includes(narration.slice(0, 20)), `${narration} -> ${r.answer}`);
    assert.ok(r.answer.includes(fact.slice(0, 20)), r.answer);
    assert.ok(r.reviewRequired);
  }
});

test("multilingual: DSGVO and German SLA wording receive official references", () => {
  const g = checkGrounding("Die Verarbeitung erfolgt DSGVO-konform mit einem Verfügbarkeitsziel von 99,9 %.", []);
  assert.deepEqual(g.fallbackReferences, ["https://www.dynamicyield.com/dpa/", "https://www.dynamicyield.com/sla/"]);
});
