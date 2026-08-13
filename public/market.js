const detail = document.querySelector("#market-detail");
const parameters = new URLSearchParams(window.location.search);
const marketId = parameters.get("market")?.toUpperCase();
const scanId = parameters.get("scan");
const backLink = document.querySelector(".back-link");

const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
})[character]);

function renderAcceptedRecord(record, index) {
  const tags = (record.factors || []).map((factor) => `<li>${escapeHtml(factor.label)}</li>`).join("");
  return `<article class="record-card">
    <header>
      <h3>${index + 1}. ${escapeHtml(record.title)}</h3>
      <a class="record-source" href="${escapeHtml(record.url)}" target="_blank" rel="noreferrer">Open official source ↗</a>
    </header>
    <p>${escapeHtml(record.excerpt || "No page excerpt was returned. Open the official source for full details.")}</p>
    <ul class="record-tags">${tags || "<li>No risk terms extracted</li>"}</ul>
  </article>`;
}

function renderExcludedRecord(record, index) {
  const link = record.url
    ? `<a class="record-source" href="${escapeHtml(record.url)}" target="_blank" rel="noreferrer">Inspect result ↗</a>`
    : "";
  return `<article class="record-card record-excluded">
    <header>
      <h3>${index + 1}. ${escapeHtml(record.title)}</h3>
      ${link}
    </header>
    <p>${escapeHtml(record.excerpt || "No search excerpt was returned.")}</p>
    <span class="exclusion-reason">Excluded: ${escapeHtml(record.exclusionReason)}</span>
  </article>`;
}

async function loadMarket() {
  let market;
  if (scanId) {
    backLink.href = `/?scan=${encodeURIComponent(scanId)}`;
    const response = await fetch(`/api/scans/${encodeURIComponent(scanId)}`, { cache: "no-store" });
    if (response.ok) {
      const job = await response.json();
      const event = [...job.events].reverse().find((item) => item.type === "market_complete" && item.market === marketId);
      market = event?.result;
    }
  }

  if (!market) {
    try {
      market = JSON.parse(sessionStorage.getItem(`risk-atlas-market-${marketId}`) || "null");
    } catch {
      market = null;
    }
  }

  if (!market) {
    detail.innerHTML = `<div class="detail-empty">
      <h1>Results unavailable</h1>
      <p>This market has not completed yet. Return to the atlas to follow its progress.</p>
    </div>`;
    return;
  }

  const excluded = market.excludedRecords || [];
  const reviewedCount = market.reviewedCount || market.records.length + excluded.length;
  document.title = `${market.name} Evidence | Product Risk Atlas`;
  detail.innerHTML = `
    <section class="detail-header">
      <div>
        <p class="eyebrow">${escapeHtml(market.id)} · REGIONAL EVIDENCE</p>
        <h1>${escapeHtml(market.name)}</h1>
        <p class="detail-meta">${escapeHtml(market.authority)} · ${escapeHtml(market.query || "Official recall search")}</p>
      </div>
      <div class="detail-count">${reviewedCount}<span>Reviewed results</span></div>
    </section>
    <section class="record-section" aria-labelledby="accepted-heading">
      <div class="record-section-heading">
        <h2 id="accepted-heading">Accepted evidence</h2>
        <span>${market.records.length} records</span>
      </div>
      <div class="record-grid">${market.records.map(renderAcceptedRecord).join("")}</div>
    </section>
    <section class="record-section excluded-section" aria-labelledby="excluded-heading">
      <div class="record-section-heading">
        <h2 id="excluded-heading">Excluded search results</h2>
        <span>${excluded.length} records</span>
      </div>
      <p class="section-note">These results were returned by search but excluded from the risk score.</p>
      <div class="record-grid">${excluded.map(renderExcludedRecord).join("") || "<p>No results were excluded from this market.</p>"}</div>
    </section>`;
}

loadMarket().catch((error) => {
  detail.innerHTML = `<div class="detail-empty"><h1>Unable to load results</h1><p>${escapeHtml(error.message)}</p></div>`;
});
