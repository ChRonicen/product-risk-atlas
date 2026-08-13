# Product Risk Atlas — Source Feasibility Experiment

## Objective

Use three consumer-product categories to determine, from real TinyFish runs, which official safety sources are accessible, which fields are comparable, and which product/query controls the final application needs.

## Benchmark products

1. Consumer power bank / portable charger
2. Children's non-powered kick scooter
3. Residential air conditioner

## Markets

- United States
- European Union
- United Kingdom
- Canada
- Australia
- France
- Japan
- South Korea

## Search modes

### Exact

Only the canonical product term in the market's primary language. Highest precision.

### Expanded

Canonical term plus reviewed synonyms and common product variants. Default candidate.

### Exploratory

LLM-proposed adjacent terms, accepted only after scope validation. Used to measure additional recall against added noise.

## Time-window candidates

- Last 3 years
- Last 5 years
- Last 10 years
- All available records

No default is selected before measuring record density and field quality.

## Result-limit candidates

- 10 records per market
- 25 records per market
- 50 records per market
- Exhaustive, when the official source exposes a stable finite result set

## Tool escalation

1. TinyFish Search restricted to official domains
2. TinyFish Fetch for known result/detail URLs
3. TinyFish Agent only for dynamic search, filters, pagination, or incomplete Fetch output
4. Browser/CDP only for high-value sources that remain inaccessible

## Measurements

- Relevant official records discovered
- Unique records added by query expansion
- False-positive rate
- Duplicate rate
- Detail-page fetch success
- Core-field coverage
- Market-specific-field coverage
- Search/fetch/agent latency
- Agent steps and credit cost
- Blocked, CAPTCHA, login, or translation failures

## Guardrails

- `no result` is not equivalent to `no risk`
- Counts and percentages are computed in code, never by an LLM
- Failure mechanisms require explicit source evidence
- One record may have multiple hazard tags
- Cross-market views compare published evidence, not real-world failure probability
