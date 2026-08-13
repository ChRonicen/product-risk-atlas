import { TinyFish } from "@tiny-fish/sdk";
import { aggregateRisks, analyzeMarketRisks, normalizeRiskLabels } from "./risk-llm.mjs";

function marketsFor(terms) {
  return [
  { id: "US", name: "United States", authority: "U.S. CPSC", domain: "cpsc.gov", term: terms.en, recallTerm: "recall", detail: /\/Recalls\//i },
  { id: "EU", name: "European Union", authority: "EU Safety Gate", domain: "ec.europa.eu", term: terms.en, recallTerm: "recall", detail: /alertDetail/i },
  { id: "UK", name: "United Kingdom", authority: "UK OPSS", domain: "gov.uk", term: terms.en, recallTerm: "recall", detail: /(product-safety-alerts-reports-recalls|\.pdf)/i },
  { id: "CA", name: "Canada", authority: "Health Canada", domain: "recalls-rappels.canada.ca", term: terms.en, recallTerm: "recall", detail: /\/alert-recall\//i },
  { id: "AU", name: "Australia", authority: "Product Safety Australia", domain: "productsafety.gov.au", term: terms.en, recallTerm: "recall", detail: /(\/recalls?\/|recall.*\.pdf|system\/files\/recall)/i },
  { id: "FR", name: "France", authority: "RappelConso", domain: "rappel.conso.gouv.fr", term: terms.fr, recallTerm: "rappel", detail: /(\/fiche-rappel\/|\/affichettePDF\/)/i },
  { id: "JP", name: "Japan", authority: "Consumer Affairs Agency", domain: "recall.caa.go.jp", term: terms.ja, recallTerm: "recall", detail: /detail\.php/i },
  { id: "KR", name: "South Korea", authority: "Safety Korea", domain: "safetykorea.kr", term: terms.ko, recallTerm: "리콜", detail: /recallUid=/i }
  ];
}

const translationTargets = {
  en: "en",
  fr: "fr",
  ja: "ja",
  ko: "ko"
};

function decodeEntities(text = "") {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

async function translateProduct(product, apiKey) {
  if (!apiKey) {
    throw new Error("GOOGLE_TRANSLATE_API_KEY is required for localized market searches");
  }

  const entries = await Promise.all(Object.entries(translationTargets).map(async ([name, target]) => {
    const response = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ q: product, target, format: "text" })
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error?.message || `Google Translation failed for ${target}`);
    }
    const translated = payload?.data?.translations?.[0]?.translatedText;
    if (!translated) throw new Error(`Google Translation returned no ${target} term`);
    return [name, decodeEntities(translated).trim()];
  }));

  return Object.fromEntries(entries);
}

function cleanTitle(title = "") {
  return title.replace(/\s+/g, " ").trim();
}

function summarizeText(text = "") {
  return text.replace(/\s+/g, " ").trim().slice(0, 420);
}

function likelyDetailUrl(url) {
  return !/(\/search|\/guidance|\/news|\/publications|\/policy|\/standard|\/index\.php?$)/i.test(url);
}

function reviewSearchResult(item, market) {
  if (!item.url) return "Missing result URL";
  if (!item.url.includes(market.domain)) return "Outside the official authority domain";
  if (!likelyDetailUrl(item.url)) return "Index, guidance or non-recall page";
  if (market.detail && !market.detail.test(item.url)) return "Not an individual recall record";
  return null;
}

async function scanMarket(client, market, product, reviewLimit, onProgress, llmConfig) {
  const query = `site:${market.domain} ${market.term} ${market.recallTerm}`;
  const pageCount = Math.ceil(reviewLimit / 10);
  onProgress?.({ type: "market_searching", market: market.id, query, amount: reviewLimit, pageCount });
  const searches = await Promise.all(Array.from({ length: pageCount }, (_, index) =>
    client.search.query({
      query,
      page: index + 1,
      language: market.id === "FR" ? "fr" : market.id === "JP" ? "ja" : market.id === "KR" ? "ko" : "en",
      purpose: `Find official ${market.authority} product recall records for ${product}`
    })
  ));

  const rawResults = searches.flatMap((search) => search.results ?? []);
  const reviewed = [...new Map(rawResults.map((item) => [item.url, item])).values()].slice(0, reviewLimit);
  const reviewedResults = reviewed.map((item) => ({
    title: cleanTitle(item.title || "Untitled search result"),
    url: item.url || "",
    excerpt: summarizeText(item.snippet || ""),
    exclusionReason: reviewSearchResult(item, market)
  }));
  const candidates = reviewed.filter((item) => !reviewSearchResult(item, market));

  onProgress?.({ type: "market_candidates", market: market.id, count: candidates.length });

  if (!candidates.length) {
    const emptyResult = {
      ...market,
      query,
      status: "no_candidates",
      records: [],
      excludedRecords: reviewedResults.map((item) => ({ ...item, exclusionReason: item.exclusionReason || "No usable recall evidence" })),
      reviewedCount: reviewedResults.length,
      risks: []
    };
    onProgress?.({ type: "market_complete", market: market.id, result: emptyResult });
    return emptyResult;
  }

  onProgress?.({ type: "market_fetching", market: market.id, count: candidates.length });
  const candidateUrls = candidates.map((item) => item.url);
  const fetchBatches = [];
  for (let index = 0; index < candidateUrls.length; index += 10) {
    fetchBatches.push(candidateUrls.slice(index, index + 10));
  }
  const fetchResponses = await Promise.all(fetchBatches.map((urls) =>
    client.fetch.getContents({
      urls,
      purpose: `Extract official recall evidence for ${product}`
    })
  ));
  const fetched = {
    results: fetchResponses.flatMap((response) => response.results ?? []),
    errors: fetchResponses.flatMap((response) => response.errors ?? [])
  };

  const evidenceRecords = (fetched.results ?? []).map((page) => {
    const searchHit = candidates.find((item) => item.url === page.url || item.url === page.final_url);
    const evidenceText = (page.text ?? "").slice(0, 2500);
    const combined = `${searchHit?.title ?? page.title ?? ""}\n${evidenceText}\n${searchHit?.snippet ?? ""}`;
    const searchOnly = (page.text?.length ?? 0) < 250;
    return {
      title: cleanTitle(searchHit?.title || page.title || "Untitled official record"),
      url: page.final_url || page.url,
      searchUrl: searchHit?.url || page.url,
      excerpt: summarizeText(searchOnly ? searchHit?.snippet : page.text),
      analysisText: combined,
      textLength: page.text?.length ?? 0,
      evidence: searchOnly ? "search_snippet" : "fetched_page"
    };
  });

  const fetchedUrls = new Set(evidenceRecords.map((record) => record.searchUrl));
  const excludedRecords = reviewedResults
    .filter((item) => item.exclusionReason || ![...fetchedUrls].some((url) => url === item.url))
    .map((item) => ({
      ...item,
      exclusionReason: item.exclusionReason || "Official page could not be fetched"
    }));
  const publicEvidenceRecords = evidenceRecords.map(({ analysisText, ...record }) => record);
  if (!evidenceRecords.length) {
    const fetchFailed = {
      id: market.id,
      name: market.name,
      authority: market.authority,
      query,
      status: "fetch_failed",
      records: [],
      excludedRecords,
      reviewedCount: reviewedResults.length,
      risks: [],
      fetchErrors: fetched.errors ?? []
    };
    onProgress?.({ type: "market_complete", market: market.id, result: fetchFailed });
    return fetchFailed;
  }
  onProgress?.({
    type: "market_evidence_ready",
    market: market.id,
    result: {
      ...market,
      query,
      status: "evidence_ready",
      records: publicEvidenceRecords,
      excludedRecords,
      reviewedCount: reviewedResults.length,
      risks: [],
      fetchErrors: fetched.errors ?? []
    }
  });
  onProgress?.({ type: "market_analyzing", market: market.id, count: evidenceRecords.length });
  let analysis;
  try {
    analysis = await analyzeMarketRisks({ product, market, records: evidenceRecords, config: llmConfig });
  } catch (error) {
    const analysisFailed = {
      id: market.id,
      name: market.name,
      authority: market.authority,
      query,
      status: "analysis_failed",
      records: publicEvidenceRecords,
      excludedRecords,
      reviewedCount: reviewedResults.length,
      risks: [],
      analysisError: error instanceof Error ? error.message : "Risk analysis failed",
      fetchErrors: fetched.errors ?? []
    };
    onProgress?.({ type: "market_complete", market: market.id, result: analysisFailed });
    return analysisFailed;
  }
  const records = analysis.records.map(({ analysisText, ...record }) => record);

  const risks = aggregateRisks(records);

  const result = {
    id: market.id,
    name: market.name,
    authority: market.authority,
    query,
    status: records.length
      ? records.every((record) => record.evidence === "search_snippet") ? "partial" : "ok"
      : "fetch_failed",
    records,
    excludedRecords,
    reviewedCount: reviewedResults.length,
    risks,
    llmUsage: analysis.usage,
    fetchErrors: fetched.errors ?? []
  };
  onProgress?.({ type: "market_analysis_ready", market: market.id, count: records.length });
  return result;
}

export async function scanProduct({
  product = "Battery",
  apiKey = process.env.TINYFISH_API_KEY,
  translationApiKey = process.env.GOOGLE_TRANSLATE_API_KEY,
  riskLlmApiKey = process.env.RISK_LLM_API_KEY,
  riskLlmBaseUrl = process.env.RISK_LLM_BASE_URL || "https://api.deepseek.com",
  riskLlmModel = process.env.RISK_LLM_MODEL || "deepseek-v4-flash",
  riskLlmThinking = process.env.RISK_LLM_THINKING || "disabled",
  reviewLimit = 10,
  onProgress
} = {}) {
  product = product.trim() || "Battery";
  reviewLimit = Math.min(15, Math.max(5, Math.round(Number(reviewLimit) / 5) * 5 || 10));
  if (!apiKey) {
    throw new Error("TINYFISH_API_KEY is required");
  }

  const client = new TinyFish({ apiKey });
  const llmConfig = {
    apiKey: riskLlmApiKey,
    baseUrl: riskLlmBaseUrl,
    model: riskLlmModel,
    thinking: riskLlmThinking
  };
  const localizedTerms = await translateProduct(product, translationApiKey);
  const markets = marketsFor(localizedTerms);
  const results = [];
  onProgress?.({
    type: "scan_started",
    product,
    reviewLimit,
    markets: markets.map(({ id, name, authority }) => ({ id, name, authority }))
  });

  // Four at a time stays below the observed Search burst limit while keeping the demo fast.
  for (let index = 0; index < markets.length; index += 4) {
    const batch = markets.slice(index, index + 4);
    results.push(...await Promise.all(batch.map((market) =>
      scanMarket(client, market, product, reviewLimit, onProgress, llmConfig).catch((error) => {
        const failed = {
          id: market.id,
          name: market.name,
          authority: market.authority,
          status: "fetch_failed",
          records: [],
          risks: [],
          error: error instanceof Error ? error.message : "Market scan failed"
        };
        onProgress?.({ type: "market_complete", market: market.id, result: failed });
        return failed;
      })
    )));
  }

  onProgress?.({
    type: "scan_normalizing",
    marketCount: results.filter((market) => market.records.length && market.status !== "analysis_failed").length
  });

  let normalization;
  try {
    normalization = await normalizeRiskLabels({ markets: results, config: llmConfig });
  } catch (error) {
    normalization = {
      mappings: [],
      usage: null,
      error: error instanceof Error ? error.message : "Risk label normalization failed"
    };
  }
  const canonicalByLabel = new Map(normalization.mappings.map((mapping) => [mapping.source.toLowerCase(), mapping.canonical]));
  for (const market of results) {
    for (const record of market.records) {
      for (const factor of record.factors ?? []) {
        factor.label = canonicalByLabel.get(factor.label.toLowerCase()) || factor.label;
      }
    }
    market.risks = aggregateRisks(market.records);
    if (market.records.length && market.status !== "analysis_failed") {
      onProgress?.({ type: "market_complete", market: market.id, result: market });
    }
  }

  const output = {
    product,
    generatedAt: new Date().toISOString(),
    markets: results,
    llmUsage: { normalization: normalization.usage, normalizationError: normalization.error ?? null },
    summary: {
      marketsScanned: results.length,
      marketsWithRecords: results.filter((item) => item.records.length).length,
      recordsFetched: results.reduce((sum, item) => sum + item.records.length, 0)
    }
  };

  onProgress?.({ type: "scan_complete", result: output });
  return output;
}

if (process.argv[1]?.endsWith("risk-scan.mjs")) {
  const product = process.argv.slice(2).join(" ").trim() || "Battery";
  scanProduct({ product })
    .then((output) => process.stdout.write(`${JSON.stringify(output, null, 2)}\n`))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
