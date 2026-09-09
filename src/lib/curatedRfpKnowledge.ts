/**
 * Conocimiento RFP curado para gaps conocidos del Knowledge Assistant.
 *
 * No hace búsquedas web en runtime: son hechos públicos, fechados y con fuentes
 * oficiales, o límites de respuesta aprobados. Las fechas evitan presentar
 * reconocimientos históricos como si fueran una clasificación actual.
 */

export interface CuratedRfpSource {
  title: string;
  uri: string;
}

export interface CuratedRfpHint {
  id: string;
  promptContext: string;
  safeAnswer: string;
  sources: CuratedRfpSource[];
}

const ANALYST_RECOGNITION: CuratedRfpHint = {
  id: "analyst-recognition",
  promptContext: `TRUSTED SUPPLEMENTAL RFP FACTS — analyst recognition:
- In the 2023 Gartner Magic Quadrant for Personalization Engines, Dynamic Yield by Mastercard was named a Leader for the sixth consecutive year and was positioned highest for Ability to Execute and furthest for Completeness of Vision.
- In the companion 2023 Gartner Critical Capabilities for Personalization Engines, Dynamic Yield received the highest score for the Digital Commerce use case.
- Dynamic Yield by Mastercard was named a Leader in The Forrester Wave: Experience Optimization Solutions, Q2 2024.
- These are dated public recognitions. State the report title and year; do not imply that a historical report is a current real-time ranking.
- Cite the official Mastercard newsroom and Dynamic Yield URLs supplied below.`,
  safeAnswer: `Dynamic Yield by Mastercard has received sustained recognition from leading independent analyst firms, helping contextualize its position in personalization and experience optimization.

• Gartner named Dynamic Yield a Leader in the 2023 Gartner Magic Quadrant for Personalization Engines for the sixth consecutive year, positioning it highest for Ability to Execute and furthest for Completeness of Vision.
• In the companion 2023 Gartner Critical Capabilities for Personalization Engines, Dynamic Yield achieved the highest score for the Digital Commerce use case.
• Forrester named Dynamic Yield a Leader in The Forrester Wave: Experience Optimization Solutions, Q2 2024.
• These dated evaluations provide independent validation of Dynamic Yield's execution, product vision, personalization capabilities, and suitability for sophisticated digital-experience programs.

Sources: https://newsroom.mastercard.com/news/press/2023/september/dynamic-yield-positioned-highest-in-execution-and-furthest-in-vision-in-2023-gartner-magic-quadrant-for-personalization-engines/; https://www.dynamicyield.com/blog/2024-gartner-forrester-personalization-engine-leader/`,
  sources: [
    {
      title: "2023 Gartner Magic Quadrant for Personalization Engines",
      uri: "https://newsroom.mastercard.com/news/press/2023/september/dynamic-yield-positioned-highest-in-execution-and-furthest-in-vision-in-2023-gartner-magic-quadrant-for-personalization-engines/",
    },
    {
      title: "Dynamic Yield recognized as a Leader by Gartner and Forrester",
      uri: "https://www.dynamicyield.com/blog/2024-gartner-forrester-personalization-engine-leader/",
    },
  ],
};

const PRODUCT_ENGINEERING_ORG: CuratedRfpHint = {
  id: "product-engineering-organization",
  promptContext: `APPROVED RFP RESPONSE BOUNDARY — product and engineering organization:
- Do not interpret the question as requiring exact employee counts, names, locations, or confidential reporting lines.
- Answer at the supported operating-model level: product management, software engineering, quality assurance, security, and operations collaborate throughout the product lifecycle.
- Product management owns customer requirements, prioritization, and roadmap direction; engineering owns architecture, implementation, and operation; QA validates quality before release; security contributes secure-development, risk-management, and compliance controls throughout the lifecycle.
- State that detailed staffing levels and reporting lines can be shared through formal due diligence under NDA.
- Do not invent headcounts, team names, geographic distribution, reporting ratios, or named development frameworks.`,
  safeAnswer: `Mastercard Dynamic Yield uses a cross-functional product development model that brings together product management, software engineering, quality assurance, security, and operations throughout the product lifecycle.

• Product management translates customer and market requirements into roadmap priorities, product requirements, and release objectives.
• Engineering is responsible for solution architecture, implementation, platform reliability, scalability, and ongoing operation of the service.
• Quality assurance is integrated into the delivery lifecycle to validate functionality, regression behavior, compatibility, and release readiness.
• Security contributes secure-development, risk-management, privacy, and compliance controls throughout design, implementation, testing, and operation rather than acting solely as a final approval step.
• Cross-functional collaboration supports controlled delivery from requirements and design through development, validation, deployment, monitoring, and continuous improvement.

Detailed staffing levels, reporting lines, and team distribution are treated as confidential organizational information and can be provided through the formal RFP due-diligence process under NDA.`,
  sources: [],
};

const SECURITY_CERTIFICATIONS: CuratedRfpHint = {
  id: "security-certifications",
  promptContext: `TRUSTED RFP FACTS — security and privacy certifications:
- Mastercard Dynamic Yield holds ISO 27001, ISO 27017, ISO 27018, ISO 27701, and SOC 2 Type 2.
- Certifications are reviewed and renewed on an ongoing basis.
- Dynamic Yield also complies with GDPR and CCPA.
- Cite the Mastercard Dynamic Yield compliance page and Dynamic Yield privacy page.`,
  safeAnswer: `At Mastercard Dynamic Yield, maintaining the highest standards of security and privacy is a core commitment, and we are pleased to confirm that our organization already holds ISO 27001 certification.

Certifications
• ISO 27001 (Information Security Management)
• ISO 27017 (Cloud Security)
• ISO 27018 (Protection of PII in the Cloud)
• ISO 27701 (Privacy Information Management)
• SOC 2 Type 2

Our certifications are reviewed and renewed on an ongoing basis to remain current. We also comply with GDPR and CCPA.

For more information, please refer to our compliance page (https://www.mastercard.com/us/en/business/consumer-acquisition-and-engagement/personalization/dynamic-yield/compliance.html) and our privacy information (https://www.dynamicyield.com/gdpr-and-privacy/).`,
  sources: [
    {
      title: "Mastercard Dynamic Yield Compliance",
      uri: "https://www.mastercard.com/us/en/business/consumer-acquisition-and-engagement/personalization/dynamic-yield/compliance.html",
    },
    {
      title: "Dynamic Yield GDPR and Privacy",
      uri: "https://www.dynamicyield.com/gdpr-and-privacy/",
    },
  ],
};

/** Devuelve contexto/fallback curado para categorías con gaps conocidos de KA. */
export function findCuratedRfpHint(question: string): CuratedRfpHint | null {
  const q = question.toLowerCase();

  if (
    /iso\s*27001|iso\s*27017|iso\s*27018|iso\s*27701|soc\s*2|internationally recognized standards|security certifications?/.test(
      q,
    )
  ) {
    return SECURITY_CERTIFICATIONS;
  }

  if (
    /analyst recognition|market positioning|gartner|forrester|magic quadrant|forrester wave/.test(
      q
    ) ||
    /third.{0,12}party evaluations?/.test(q)
  ) {
    return ANALYST_RECOGNITION;
  }

  if (
    /product and engineering organi[sz]ation/.test(q) ||
    (/product development/.test(q) && /\bqa\b|quality assurance/.test(q) && /security/.test(q)) ||
    (/staff(?:ed|ing)/.test(q) && /\bengineering\b/.test(q) && /security/.test(q))
  ) {
    return PRODUCT_ENGINEERING_ORG;
  }

  return null;
}
