import { TinyFish } from "@tiny-fish/sdk";

function marketsFor(product) {
  return [
  { id: "US", name: "United States", authority: "U.S. CPSC", domain: "cpsc.gov", term: product, recallTerm: "recall", detail: /\/Recalls\//i },
  { id: "EU", name: "European Union", authority: "EU Safety Gate", domain: "ec.europa.eu", term: product, recallTerm: "recall", detail: /alertDetail/i },
  { id: "UK", name: "United Kingdom", authority: "UK OPSS", domain: "gov.uk", term: product, recallTerm: "recall", detail: /(product-safety-alerts-reports-recalls|\.pdf)/i },
  { id: "CA", name: "Canada", authority: "Health Canada", domain: "recalls-rappels.canada.ca", term: product, recallTerm: "recall", detail: /\/alert-recall\//i },
  { id: "AU", name: "Australia", authority: "Product Safety Australia", domain: "productsafety.gov.au", term: product, recallTerm: "recall", detail: /(\/recalls?\/|recall.*\.pdf|system\/files\/recall)/i },
  { id: "CN", name: "Mainland China", authority: "SAMR", domain: "samr.gov.cn", term: product === "power bank" ? "移动电源" : product, recallTerm: "召回" },
  { id: "JP", name: "Japan", authority: "Consumer Affairs Agency", domain: "recall.caa.go.jp", term: product === "power bank" ? "モバイルバッテリー" : product, recallTerm: "recall", detail: /detail\.php/i },
  { id: "KR", name: "South Korea", authority: "Safety Korea", domain: "safetykorea.kr", term: product === "power bank" ? "보조배터리" : product, recallTerm: "리콜", detail: /recallUid=/i }
  ];
}

const riskTerms = [
  { id: "fire", label: "Fire / ignition", terms: ["fire", "ignite", "catch fire", "発火", "火災", "着火", "화재", "발화"] },
  { id: "overheating", label: "Overheating", terms: ["overheat", "overheating", "overheated", "過熱", "発熱", "过热", "发热", "과열", "발열"] },
  { id: "burn", label: "Burn injury", terms: ["burn hazard", "burn injury", "burns", "火傷", "やけど", "烧伤", "烫伤", "화상"] },
  { id: "explosion", label: "Explosion", terms: ["explode", "explosion", "破裂", "爆発", "爆炸", "폭발"] },
  { id: "short_circuit", label: "Short circuit", terms: ["short circuit", "short-circuit", "内部短絡", "短路", "内部短路", "단락", "쇼트"] },
  { id: "swelling", label: "Battery swelling", terms: ["swell", "swelling", "膨張", "膨胀", "부풀", "팽창"] },
  { id: "chemical", label: "Chemical exposure", terms: ["chemical hazard", "toxic", "cadmium", "化学危害", "有害物质", "유해물질"] },
  { id: "injury", label: "Other injury", terms: ["injury", "injuries", "負傷", "けが", "受伤", "부상"] }
];

function tagsFor(text) {
  const haystack = text.toLowerCase();
  return riskTerms
    .filter((risk) => risk.terms.some((term) => haystack.includes(term.toLowerCase())))
    .map(({ id, label }) => ({ id, label }));
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

async function scanMarket(client, market, product, reviewLimit, onProgress) {
  const query = `site:${market.domain} ${market.term} ${market.recallTerm}`;
  const pageCount = Math.ceil(reviewLimit / 10);
  onProgress?.({ type: "market_searching", market: market.id, query, amount: reviewLimit, pageCount });
  const searches = await Promise.all(Array.from({ length: pageCount }, (_, index) =>
    client.search.query({
      query,
      page: index + 1,
      language: market.id === "CN" ? "zh" : market.id === "JP" ? "ja" : market.id === "KR" ? "ko" : "en",
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
  const fetched = await client.fetch.getContents({
    urls: candidates.map((item) => item.url),
    purpose: `Extract official recall evidence for ${product}`
  });

  const records = (fetched.results ?? []).map((page) => {
    const searchHit = candidates.find((item) => item.url === page.url || item.url === page.final_url);
    const evidenceText = (page.text ?? "").slice(0, 2500);
    const combined = `${searchHit?.title ?? page.title ?? ""}\n${evidenceText}\n${searchHit?.snippet ?? ""}`;
    const searchOnly = (page.text?.length ?? 0) < 250;
    return {
      title: cleanTitle(searchHit?.title || page.title || "Untitled official record"),
      url: page.final_url || page.url,
      searchUrl: searchHit?.url || page.url,
      excerpt: summarizeText(searchOnly ? searchHit?.snippet : page.text),
      tags: tagsFor(combined),
      textLength: page.text?.length ?? 0,
      evidence: searchOnly ? "search_snippet" : "fetched_page"
    };
  });

  const fetchedUrls = new Set(records.map((record) => record.searchUrl));
  const excludedRecords = reviewedResults
    .filter((item) => item.exclusionReason || ![...fetchedUrls].some((url) => url === item.url))
    .map((item) => ({
      ...item,
      exclusionReason: item.exclusionReason || "Official page could not be fetched"
    }));

  const riskCounts = new Map();
  for (const record of records) {
    for (const tag of record.tags) {
      const current = riskCounts.get(tag.id) ?? { ...tag, count: 0 };
      current.count += 1;
      riskCounts.set(tag.id, current);
    }
  }

  const risks = [...riskCounts.values()]
    .sort((a, b) => b.count - a.count)
    .map((risk) => ({ ...risk, share: records.length ? risk.count / records.length : 0 }));

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
    fetchErrors: fetched.errors ?? []
  };
  onProgress?.({ type: "market_complete", market: market.id, result });
  return result;
}

export async function scanProduct({
  product = "power bank",
  apiKey = process.env.TINYFISH_API_KEY,
  reviewLimit = 10,
  onProgress
} = {}) {
  product = product.trim() || "power bank";
  reviewLimit = Math.min(30, Math.max(5, Math.round(Number(reviewLimit) / 5) * 5 || 10));
  if (!apiKey) {
    throw new Error("TINYFISH_API_KEY is required");
  }

  const client = new TinyFish({ apiKey });
  const markets = marketsFor(product);
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
      scanMarket(client, market, product, reviewLimit, onProgress).catch((error) => {
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

  const output = {
    product,
    generatedAt: new Date().toISOString(),
    markets: results,
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
  const product = process.argv.slice(2).join(" ").trim() || "power bank";
  scanProduct({ product })
    .then((output) => process.stdout.write(`${JSON.stringify(output, null, 2)}\n`))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
