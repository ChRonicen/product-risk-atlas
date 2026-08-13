# PRODUCT RISK ATLAS

**Live Demo:** [pra.ironip.link](https://pra.ironip.link)

**Global product recall risk scanner — compare recurring safety risks across eight official markets in one scan, with every score linked back to its recall evidence.**

Enter a product name and choose how many results to review per market. Product Risk Atlas scans official recall sources in the US, EU, UK, Canada, Australia, France, Japan and South Korea, reveals accepted evidence as each market finishes, and builds regional risk rankings that remain traceable to the original records.

## Demo

https://github.com/user-attachments/assets/9e84cb58-158b-467d-a4a6-b3d755088bef

## How to Use It

1. Enter a product category, such as `Battery`, `children's scooter` or `air conditioner`
2. Choose 5, 10 or 15 search results to review for each market
3. Run the scan and watch each regional card move from search to evidence and risk analysis
4. Compare the 0-10 risk rankings, then open any market to inspect accepted and excluded source records

## How It Works

Google Cloud Translation localizes the product query for French, Japanese and Korean sources. TinyFish Search finds candidate records on eight fixed authority domains, and TinyFish Fetch reads the accepted recall pages. An OpenAI-compatible LLM extracts evidence-backed risk labels once per market and aligns synonymous labels across regions. Node.js then deduplicates those labels, calculates every score deterministically and streams progress to the browser through a scan session.

Evidence links appear before the full analysis is complete, so the interface stays useful while slower markets finish. Every reviewed result remains inspectable as either accepted evidence or an excluded search result.

## Architecture

```text
┌──────────────────────────────────────────────────────────────┐
│                       Browser client                         │
│  Product + amount → live market cards → matrix → evidence   │
└────────────────────────────┬─────────────────────────────────┘
                             │ scan ID + event polling
┌────────────────────────────▼─────────────────────────────────┐
│                    Node.js orchestrator                      │
│                                                              │
│  Google Translation ──► EN / FR / JA / KO product terms      │
│  TinyFish Search     ──► 8 official authority domains        │
│  URL review          ──► accepted + excluded records         │
│  TinyFish Fetch      ──► official recall evidence            │
│  Market LLM calls    ──► evidence-backed risk labels         │
│  Global label merge  ──► aligned labels across markets       │
│  Application code   ──► deterministic counts and scores      │
└──────────────────────────────────────────────────────────────┘
```

The server keeps scan sessions and progress events in memory for one hour. There is no external database, and refreshing or returning from a market detail page restores the active scan by ID.

## Official Markets

| Market | Source |
|---|---|
| United States | U.S. CPSC |
| European Union | EU Safety Gate |
| United Kingdom | UK OPSS |
| Canada | Health Canada |
| Australia | Product Safety Australia |
| France | RappelConso |
| Japan | Consumer Affairs Agency |
| South Korea | Safety Korea |

These sources are deliberately fixed. The demo is designed to compare official recall evidence, not roam the open web.

## Features

- Live per-market stages: queued, searching, fetching, analyzing, waiting and normalizing
- Early evidence display while risk analysis is still running
- Regional risk rankings and a cross-market comparison matrix
- Accepted and excluded results shown on separate evidence lists
- Direct links back to every official source
- Navigation-safe scan sessions and browser-back restoration
- Server-side demo credentials with optional Bring Your Own TinyFish Key
- 20 scan requests per Cloudflare client IP every five minutes

## Risk Score

```text
risk score = records mentioning the risk / accepted records × 10
```

A score of `8.0` means that 80% of the accepted records in that market mention the risk. It measures signal frequency in the collected recall evidence—not incident probability, severity, or the overall safety of the product category.

The LLM extracts and normalizes labels only. Deduplication, occurrence counts, percentages and scores are calculated in JavaScript to avoid model-generated arithmetic.

## Setup

### Prerequisites

- Node.js 20+
- TinyFish API key
- Google Cloud Translation API key
- OpenAI-compatible API key for risk analysis

### Environment

Copy `.env.example` to `.env` and keep it server-side:

```env
TINYFISH_API_KEY=your-tinyfish-api-key
GOOGLE_TRANSLATE_API_KEY=your-google-translation-key
RISK_LLM_API_KEY=your-openai-compatible-key
RISK_LLM_BASE_URL=https://api.deepseek.com
RISK_LLM_MODEL=deepseek-v4-flash
RISK_LLM_THINKING=disabled
PORT=4173
```

The demo keys are never returned to the browser. A user-supplied TinyFish key is used for that scan only and is not written to session events, URLs, browser storage or API responses. Use HTTPS in production.

### Install and Run

```bash
npm install
set -a; source .env; set +a
npm start
```

Open [http://localhost:4173](http://localhost:4173).

### CLI Scanner

```bash
set -a; source .env; set +a
npm run scan -- "Battery"
```

The CLI prints the complete structured scan result as JSON.

## Deployment

The included Dockerfile packages the Node.js service for an HTTPS reverse proxy such as Nginx, Caddy or 1Panel OpenResty. Keep the container bound to localhost when the proxy runs on the same host.

```bash
docker build -t product-risk-atlas .
docker run -d --name product-risk-atlas \
  --env-file .env \
  -p 127.0.0.1:4173:4173 \
  product-risk-atlas
```

Keep `.env` outside the image and repository. The live demo uses a server-specific Compose file and reverse-proxy configuration that are intentionally not published.

## Project Structure

```text
product-risk-atlas/
├── public/
│   ├── index.html       # Search form and results layout
│   ├── app.js           # Session polling and progressive UI
│   ├── market.html      # Full regional evidence page
│   ├── market.js        # Accepted and excluded result rendering
│   └── styles.css
├── scripts/
│   ├── risk-scan.mjs    # Translation, TinyFish and scan pipeline
│   └── risk-llm.mjs     # Risk extraction and label alignment
├── research/            # Experiment notes and product scopes
├── server.mjs           # HTTP API, rate limit and scan sessions
├── Dockerfile
└── .env.example
```

## Tech Stack

- **Server:** Node.js HTTP server
- **Frontend:** Vanilla JavaScript and CSS
- **Web data:** TinyFish Search and Fetch SDK
- **Localization:** Google Cloud Translation API
- **Risk analysis:** OpenAI-compatible LLM; DeepSeek V4 Flash by default
- **State:** In-memory scan sessions with one-hour cleanup
- **Deployment:** Docker behind an HTTPS reverse proxy

## Prototype Boundaries

- Search quality depends on how well each authority is indexed
- Markets can return different evidence volumes; the UI preserves those differences
- URL rules favor recall detail pages and may exclude useful but non-standard records
- Risk labels summarize the collected recall evidence and can still require human review
- Sessions are ephemeral and disappear after one hour or a server restart

## Disclaimer

Product Risk Atlas is a research prototype. It summarizes public recall evidence and does not replace legal, regulatory, engineering or product-safety review. Always verify findings against the linked official sources.
