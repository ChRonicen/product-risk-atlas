const form = document.querySelector("#scan-form");
const button = document.querySelector("#scan-button");
const statusPanel = document.querySelector("#status");
const resultsPanel = document.querySelector("#results");
const summaryPanel = document.querySelector("#summary");
const matrixPanel = document.querySelector("#risk-matrix");
const marketGrid = document.querySelector("#market-grid");
const amountInput = document.querySelector("#amount");
const amountOutput = document.querySelector("#amount-output");
const amountMarks = [...document.querySelectorAll(".amount-mark")];

const marketDefinitions = [
  { id: "US", name: "United States", authority: "U.S. CPSC" },
  { id: "EU", name: "European Union", authority: "EU Safety Gate" },
  { id: "UK", name: "United Kingdom", authority: "UK OPSS" },
  { id: "CA", name: "Canada", authority: "Health Canada" },
  { id: "AU", name: "Australia", authority: "Product Safety Australia" },
  { id: "CN", name: "Mainland China", authority: "SAMR" },
  { id: "JP", name: "Japan", authority: "Consumer Affairs Agency" },
  { id: "KR", name: "South Korea", authority: "Safety Korea" }
];

const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
})[character]);

function riskScore(value) {
  return (value * 10).toFixed(1);
}

function statusCopy(status) {
  if (status === "ok") return "Page evidence";
  if (status === "partial") return "Search evidence only";
  if (status === "no_candidates") return "No records found";
  return "Source unavailable";
}

function updateAmount(value) {
  const amount = Math.min(30, Math.max(5, Math.round(Number(value) / 5) * 5));
  amountInput.value = String(amount);
  amountInput.style.setProperty("--amount-progress", `${((amount - 5) / 25) * 100}%`);
  amountOutput.value = String(amount);
  amountOutput.textContent = String(amount);
  amountMarks.forEach((mark) => mark.classList.toggle("active", Number(mark.dataset.value) === amount));
}

amountInput.addEventListener("input", () => updateAmount(amountInput.value));
amountInput.addEventListener("keydown", (event) => {
  const keys = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5 };
  if (event.key in keys) {
    event.preventDefault();
    updateAmount(Number(amountInput.value) + keys[event.key]);
  } else if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    updateAmount(event.key === "Home" ? 5 : 30);
  }
});
amountMarks.forEach((mark) => mark.addEventListener("click", () => updateAmount(mark.dataset.value)));
updateAmount(amountInput.value);

function renderLoadingSummary(product) {
  summaryPanel.innerHTML = `
    <div class="summary-copy">
      <p class="kicker">SCAN IN PROGRESS</p>
      <h2>${escapeHtml(product)}</h2>
      <p id="progress-copy">0 of 8 markets complete.</p>
    </div>
    <dl class="summary-stats">
      <div><dt>Markets</dt><dd id="market-progress">0/8</dd></div>
      <div><dt>Records</dt><dd><span class="inline-skeleton" aria-label="Loading"></span></dd></div>
      <div><dt>Sources</dt><dd>8</dd></div>
    </dl>`;
}

function renderSummary(data) {
  const partial = data.markets.filter((market) => market.status === "partial").length;
  const partialCopy = partial
    ? `${partial} ${partial === 1 ? "market has" : "markets have"} partial evidence.`
    : "All markets returned page evidence.";
  summaryPanel.innerHTML = `
    <div class="summary-copy">
      <p class="kicker">SCAN COMPLETE</p>
      <h2>${escapeHtml(data.product)}</h2>
      <p>${partialCopy}</p>
    </div>
    <dl class="summary-stats">
      <div><dt>Markets</dt><dd>${data.summary.marketsWithRecords}/${data.summary.marketsScanned}</dd></div>
      <div><dt>Records</dt><dd>${data.summary.recordsFetched}</dd></div>
      <div><dt>Sources</dt><dd>${data.markets.length}</dd></div>
    </dl>`;
}

function renderMatrixLoading() {
  const head = marketDefinitions.map((market) => `<th scope="col">${market.id}</th>`).join("");
  const rows = ["Primary risk", "Secondary risk", "Reported harm", "Product defect"].map((label) => `
    <tr><th scope="row"><span class="text-skeleton">${label}</span></th>${marketDefinitions.map(() => `<td><span class="cell-skeleton"></span></td>`).join("")}</tr>`).join("");
  matrixPanel.innerHTML = `<table class="matrix-loading" aria-label="Risk matrix loading"><thead><tr><th scope="col">Risk</th>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

function renderMatrix(markets) {
  const risks = [...new Map(markets.flatMap((market) => market.risks).map((risk) => [risk.id, risk.label])).entries()]
    .map(([id, label]) => ({ id, label }));
  const head = markets.map((market) => `<th scope="col">${escapeHtml(market.id)}</th>`).join("");
  const rows = risks.map((risk) => {
    const cells = markets.map((market) => {
      const match = market.risks.find((item) => item.id === risk.id);
      const value = match?.share || 0;
      const score = riskScore(value);
      return `<td><span class="signal signal-${Math.ceil(value * 4)}" title="${escapeHtml(market.name)}: ${score} out of 10">${value ? score : "-"}</span></td>`;
    }).join("");
    return `<tr><th scope="row">${escapeHtml(risk.label)}</th>${cells}</tr>`;
  }).join("");
  matrixPanel.innerHTML = `<table><thead><tr><th scope="col">Risk</th>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

function loadingCard(market) {
  return `<article class="market-card market-loading" id="market-${market.id}" aria-busy="true">
    <header>
      <div><span class="market-id">${market.id}</span><h3>${escapeHtml(market.name)}</h3></div>
      <span class="quality quality-active">Queued</span>
    </header>
    <p class="authority">${escapeHtml(market.authority)}</p>
    <p class="activity-copy">Waiting for scan slot</p>
    <ol class="risk-list skeleton-list" aria-label="Risk ranking loading">
      <li><span class="row-skeleton wide"></span><span class="row-skeleton count"></span></li>
      <li><span class="row-skeleton medium"></span><span class="row-skeleton count"></span></li>
      <li><span class="row-skeleton wide"></span><span class="row-skeleton count"></span></li>
      <li><span class="row-skeleton short"></span><span class="row-skeleton count"></span></li>
    </ol>
    <ul class="evidence-list evidence-skeleton" aria-label="Evidence loading">
      <li><span class="row-skeleton wide"></span></li>
      <li><span class="row-skeleton medium"></span></li>
      <li><span class="row-skeleton wide"></span></li>
    </ul>
  </article>`;
}

function completedCard(market) {
  sessionStorage.setItem(`risk-atlas-market-${market.id}`, JSON.stringify(market));
  const scanId = sessionStorage.getItem("risk-atlas-active-scan");
  const risks = market.risks.slice(0, 4).map((risk, index) => `
    <li><span>${index + 1}. ${escapeHtml(risk.label)}</span><strong>${risk.count}/${market.records.length}</strong></li>`).join("");
  const records = market.records.slice(0, 3).map((record) => `
    <li><a href="${escapeHtml(record.url)}" target="_blank" rel="noreferrer">${escapeHtml(record.title)}</a><span>${escapeHtml(record.evidence === "fetched_page" ? "Fetched page" : "Search snippet")}</span></li>`).join("");
  return `<article class="market-card market-resolved" id="market-${market.id}" aria-busy="false">
    <header>
      <div><span class="market-id">${escapeHtml(market.id)}</span><h3>${escapeHtml(market.name)}</h3></div>
      <span class="quality quality-${escapeHtml(market.status)}">${statusCopy(market.status)}</span>
    </header>
    <p class="authority">${escapeHtml(market.authority)} · ${market.records.length} accepted from ${market.reviewedCount || market.records.length}</p>
    <ol class="risk-list">${risks || "<li><span>No risk terms extracted</span></li>"}</ol>
    <ul class="evidence-list">${records || "<li><span>No usable evidence returned.</span></li>"}</ul>
    ${market.reviewedCount ? `<a class="view-all" href="/market.html?market=${encodeURIComponent(market.id)}${scanId ? `&scan=${encodeURIComponent(scanId)}` : ""}">View all ${market.reviewedCount} reviewed records</a>` : ""}
  </article>`;
}

function renderLoadingMarkets() {
  marketGrid.innerHTML = marketDefinitions.map(loadingCard).join("");
}

function updateMarketStage(event) {
  const card = document.querySelector(`#market-${event.market}`);
  if (!card) return;
  const quality = card.querySelector(".quality");
  const activity = card.querySelector(".activity-copy");
  if (event.type === "market_searching") {
    quality.textContent = "Searching";
    activity.textContent = `Reviewing up to ${event.amount || amountInput.value} search results`;
  } else if (event.type === "market_candidates") {
    quality.textContent = "Candidates found";
    activity.textContent = `Found ${event.count} candidate ${event.count === 1 ? "page" : "pages"}`;
  } else if (event.type === "market_fetching") {
    quality.textContent = "Fetching";
    activity.textContent = `Reading ${event.count} official ${event.count === 1 ? "page" : "pages"}`;
  }
}

function updateOverallProgress(completed) {
  const marketProgress = document.querySelector("#market-progress");
  const progressCopy = document.querySelector("#progress-copy");
  if (marketProgress) marketProgress.textContent = `${completed}/8`;
  if (progressCopy) progressCopy.textContent = `${completed} of 8 markets complete.`;
  statusPanel.innerHTML = `<p>TinyFish is scanning official sources. ${completed} of 8 markets complete.</p>`;
}

function beginLoading(product) {
  button.disabled = true;
  button.textContent = "Scanning 8 markets...";
  form.setAttribute("aria-busy", "true");
  statusPanel.className = "status-panel loading";
  statusPanel.innerHTML = "<p>TinyFish is preparing eight regional searches.</p>";
  renderLoadingSummary(product);
  renderMatrixLoading();
  renderLoadingMarkets();
  resultsPanel.hidden = false;
  resultsPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function endLoading() {
  button.disabled = false;
  button.textContent = "Run scan";
  form.setAttribute("aria-busy", "false");
}

async function getJob(jobId) {
  const response = await fetch(`/api/scans/${encodeURIComponent(jobId)}`, { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Scan task could not be restored");
  return data;
}

async function followJob(jobId, initialSnapshot) {
  let completed = 0;
  let finalResult;
  let streamError;
  let lastSequence = -1;

  while (true) {
    const snapshot = initialSnapshot || await getJob(jobId);
    initialSnapshot = null;
    for (const scanEvent of snapshot.events.filter((item) => item.sequence > lastSequence)) {
      lastSequence = scanEvent.sequence;
      if (["market_searching", "market_candidates", "market_fetching"].includes(scanEvent.type)) {
        updateMarketStage(scanEvent);
      } else if (scanEvent.type === "market_complete") {
        const card = document.querySelector(`#market-${scanEvent.market}`);
        if (card) card.outerHTML = completedCard(scanEvent.result);
        completed += 1;
        updateOverallProgress(completed);
      } else if (scanEvent.type === "scan_complete") {
        finalResult = scanEvent.result;
      } else if (scanEvent.type === "scan_error") {
        streamError = scanEvent.error;
      }
    }

    if (snapshot.status !== "running") break;
    await new Promise((resolve) => setTimeout(resolve, 600));
  }

  if (streamError) throw new Error(streamError);
  if (!finalResult) throw new Error("The scan ended before a final result was returned");
  renderSummary(finalResult);
  renderMatrix(finalResult.markets);
  statusPanel.className = "status-panel complete";
  statusPanel.innerHTML = `<p>Scan finished from ${finalResult.summary.marketsScanned} official market sources.</p>`;
}

async function runNewScan(product, reviewLimit, apiKey) {
  beginLoading(product);
  const response = await fetch("/api/scans", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ product, reviewLimit, apiKey })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Scan could not be started");
  sessionStorage.setItem("risk-atlas-active-scan", data.id);
  history.replaceState(null, "", `/?scan=${encodeURIComponent(data.id)}`);
  await followJob(data.id);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = new FormData(form);
  const product = String(values.get("product") || "power bank").trim();

  try {
    await runNewScan(product, values.get("reviewLimit"), values.get("apiKey"));
  } catch (error) {
    statusPanel.className = "status-panel error";
    statusPanel.innerHTML = `<p><strong>Scan failed.</strong> ${escapeHtml(error.message)}</p>`;
  } finally {
    endLoading();
  }
});

async function restoreActiveScan() {
  const jobId = new URLSearchParams(location.search).get("scan") || sessionStorage.getItem("risk-atlas-active-scan");
  if (!jobId) return;
  try {
    sessionStorage.setItem("risk-atlas-active-scan", jobId);
    const snapshot = await getJob(jobId);
    const started = snapshot.events.find((event) => event.type === "scan_started");
    if (!started) return;
    form.elements.product.value = started.product;
    updateAmount(started.reviewLimit || 10);
    beginLoading(started.product);
    await followJob(jobId, snapshot);
  } catch (error) {
    sessionStorage.removeItem("risk-atlas-active-scan");
    statusPanel.className = "status-panel error";
    statusPanel.innerHTML = `<p><strong>Previous scan unavailable.</strong> ${escapeHtml(error.message)}</p>`;
  } finally {
    endLoading();
  }
}

restoreActiveScan();
