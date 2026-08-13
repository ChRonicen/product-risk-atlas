function endpointFor(baseUrl) {
  return `${baseUrl.replace(/\/$/, "")}/chat/completions`;
}

function parseJsonContent(content) {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(cleaned);
}

async function callLlm({ apiKey, baseUrl, model, thinking, messages, maxTokens = 8000 }) {
  if (!apiKey) throw new Error("RISK_LLM_API_KEY is required");
  const body = {
    model,
    messages,
    response_format: { type: "json_object" },
    max_tokens: maxTokens,
    stream: false
  };
  if (thinking) body.thinking = { type: thinking };
  if (thinking === "disabled") body.temperature = 0;

  const response = await fetch(endpointFor(baseUrl), {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || `Risk LLM failed with ${response.status}`);
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Risk LLM returned no content");
  return { data: parseJsonContent(content), usage: payload.usage ?? null };
}

function marketPrompt(product, market, records) {
  const documents = records.map((record, index) => ({
    record_id: `${market.id}-${index + 1}`,
    title: record.title,
    text: record.analysisText
  }));
  return `Analyze official product recall evidence for ${product} in ${market.name}.

For every record, extract only risk factors explicitly supported by its text.
- label must be a short canonical English noun phrase, regardless of source language.
- A risk factor may describe the dangerous condition, product failure, cause, or stated harm, such as Fire, Battery overheating, Loose wiring, Electric shock, or Burns.
- Preserve negation: do not report an injury as actual harm if the text says no injuries occurred. Potential harm may be included only when the source explicitly states it as a risk.
- evidence must be a brief exact quotation from the source text in its original language.
- Do not infer unsupported risks.
- Return every supplied record_id exactly once. Use an empty factors array when no supported factor exists.

Return JSON only in this shape:
{"records":[{"record_id":"US-1","factors":[{"label":"Fire","evidence":"exact source quote","confidence":0.95}]}]}

Documents:
${JSON.stringify(documents)}`;
}

export async function analyzeMarketRisks({ product, market, records, config }) {
  const { data, usage } = await callLlm({
    ...config,
    messages: [
      { role: "system", content: "You extract auditable product-safety facts from official recall evidence. Return valid JSON only." },
      { role: "user", content: marketPrompt(product, market, records) }
    ]
  });

  const byId = new Map((data.records ?? []).map((record) => [record.record_id, record.factors ?? []]));
  return {
    records: records.map((record, index) => ({
      ...record,
      factors: byId.get(`${market.id}-${index + 1}`) ?? []
    })),
    usage
  };
}

export async function normalizeRiskLabels({ markets, config }) {
  const labels = new Map();
  for (const market of markets) {
    for (const record of market.records) {
      for (const factor of record.factors ?? []) {
        const normalized = factor.label.trim().toLowerCase();
        const current = labels.get(normalized) ?? {
          key: `R${labels.size + 1}`,
          label: factor.label.trim(),
          evidence_examples: []
        };
        if (factor.evidence && current.evidence_examples.length < 3) {
          current.evidence_examples.push(factor.evidence);
        }
        labels.set(normalized, current);
      }
    }
  }
  const uniqueLabels = [...labels.values()];
  if (!uniqueLabels.length) return { mappings: [], usage: null };

  const { data, usage } = await callLlm({
    ...config,
    maxTokens: 5000,
    messages: [
      { role: "system", content: "You normalize product-safety risk labels. Return valid JSON only." },
      { role: "user", content: `Map synonymous product-safety labels to one concise canonical English noun phrase. Use the evidence examples only to disambiguate meaning.

Required examples:
- Fire hazard, Fire risk, and Fire -> Fire
- Burn hazard, Burn injury, Burn injuries, and Burns -> Burns
- Explosion hazard and Explosion -> Explosion
- Battery overheating and Overheating -> Overheating only when both describe the battery becoming too hot
- Serious injury and Serious injuries -> Serious injury

Always merge trivial grammatical, singular/plural, capitalization, and wording variants. Preserve meaningful qualifiers such as severity; for example, Personal injury is not automatically Serious injury.

Keep distinct concepts separate: Overheating is not Fire, Fire is not Burns, and a loose wire is not a short circuit. Return every key exactly once as {"mappings":[{"key":"R1","canonical":"Fire"}]}.

Unique labels:
${JSON.stringify(uniqueLabels)}` }
    ]
  });
  const labelByKey = new Map(uniqueLabels.map((item) => [item.key, item.label]));
  return {
    mappings: (data.mappings ?? [])
      .filter((mapping) => labelByKey.has(mapping.key) && typeof mapping.canonical === "string")
      .map((mapping) => ({ source: labelByKey.get(mapping.key), canonical: mapping.canonical.trim() })),
    usage
  };
}

export function aggregateRisks(records) {
  const counts = new Map();
  for (const record of records) {
    const seen = new Set();
    for (const factor of record.factors ?? []) {
      const id = factor.label.toLowerCase();
      if (seen.has(id)) continue;
      seen.add(id);
      const current = counts.get(id) ?? { id, label: factor.label, count: 0 };
      current.count += 1;
      counts.set(id, current);
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .map((risk) => ({ ...risk, share: records.length ? risk.count / records.length : 0 }));
}
