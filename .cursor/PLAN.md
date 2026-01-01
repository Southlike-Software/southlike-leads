# Real Estate Lead Collection System

Build a CLI-based lead collection system that scrapes Google Maps, agency websites, and LinkedIn for real estate agents in Porto Alegre, stores data in SQLite with caching, and exports to Excel for CRM usage.

## Todos

- [ ] Add dependencies (playwright, ai-sdk, xlsx, commander) and project structure
- [ ] Create SQLite schema with all tables and cache layer
- [ ] Define Zod schemas for companies, decision_makers, cache entries
- [ ] Implement Google Maps scraper with rate limiting and caching
- [ ] Implement website scraper with AI analysis for contact extraction
- [ ] Implement LinkedIn scraper with session auth and strict rate limits
- [ ] Implement CRECI-RS validation (or mark optional if infeasible)
- [ ] Build deduplication logic for companies and decision-makers
- [ ] Create Excel export with Leads, Interactions, Dashboard tabs
- [ ] Wire up CLI commands (collect, scrape, export, stats, clear-cache)

## Architecture Overview

```
src/
├── cli.ts                 # CLI entry point with commander
├── db/
│   ├── schema.ts          # SQLite schema + migrations
│   ├── queries.ts         # Database operations
│   └── cache.ts           # Cache layer logic
├── scrapers/
│   ├── google-maps.ts     # Google Maps scraper
│   ├── website.ts         # Agency website scraper + AI analysis
│   ├── linkedin.ts        # LinkedIn scraper
│   └── creci.ts           # CRECI-RS validation
├── services/
│   ├── ai-analyzer.ts     # AI SDK + Anthropic for content extraction
│   ├── deduplication.ts   # Matching and merge logic
│   └── rate-limiter.ts    # Request throttling
├── export/
│   └── excel.ts           # XLSX export with multiple tabs
├── schemas/
│   └── index.ts           # Zod schemas for all data types
└── utils/
    ├── logger.ts          # Pino logger config
    └── normalize.ts       # Text normalization helpers
```

## Key Dependencies to Add

- `playwright` - browser automation
- `@ai-sdk/anthropic` + `ai` - AI analysis of websites
- `xlsx` - Excel export
- `commander` - CLI framework

## Database Schema

**Core tables:** `companies`, `decision_makers`, `interactions`, `pipeline_status`

**Cache tables:** `scrape_cache` (with `source`, `lookup_key`, `data`, `expires_at`), `scrape_jobs` (with `status`, `retry_count`, `checkpoint`)

All operations use `bun:sqlite` with prepared statements for performance.

## Scraper Implementation

**Google Maps** ([src/scrapers/google-maps.ts](src/scrapers/google-maps.ts)):

- Use Google Places API (Text Search + Place Details endpoints)
- Search queries: "imobiliária Porto Alegre", "corretor de imóveis Porto Alegre"
- Extract: name, address, phone, website, rating, reviews from structured API response
- Uses `place_id` for deduplication
- Requires `GOOGLE_MAPS_API_KEY` in `.env`

**Website Analysis** ([src/scrapers/website.ts](src/scrapers/website.ts)):

- Fetch homepage + contact page
- Pass HTML to AI for structured extraction (emails, names, social media)
- AI prompt designed to find decision-maker info and contact details

**LinkedIn** ([src/scrapers/linkedin.ts](src/scrapers/linkedin.ts)):

- Manual login: opens browser, waits for user to log in, saves session cookies
- Reuses saved session for subsequent runs
- Search company name, filter employees by title keywords (Director, Partner, Owner, CEO, Founder)
- Extract: name, title, profile URL
- Aggressive rate limiting (10-15s delays, 100/day cap)

**CRECI-RS** ([src/scrapers/creci.ts](src/scrapers/creci.ts)):

- Optional validation if CRECI-RS has searchable registry
- Mark as skipped if not feasible

## CLI Commands

```bash
bun run cli.ts collect --limit 50 --headless
bun run cli.ts scrape google-maps --force-refresh
bun run cli.ts scrape websites
bun run cli.ts scrape linkedin
bun run cli.ts export --output leads.xlsx
bun run cli.ts stats
bun run cli.ts clear-cache
```

## Cache Strategy

Before each scrape operation:

1. Check `scrape_cache` for valid entry (not expired)
2. If hit, return cached data
3. If miss, create job in `scrape_jobs` (status: in_progress)
4. Execute scrape
5. Store result in cache, mark job completed

Jobs enable resumability - on restart, query pending/in_progress jobs and continue.

## Excel Export Structure

**Tab 1 - Leads:** Company + decision-maker data joined, with CRM columns (status, last_contact, next_step, notes)

**Tab 2 - Interactions:** Full interaction log with timestamps

**Tab 3 - Dashboard:** Summary stats (lead counts by status, collection dates)

## Rate Limiting Implementation

Simple token bucket per source in [src/services/rate-limiter.ts](src/services/rate-limiter.ts):

- Google Maps: 2-3s between requests
- Websites: 1-2s
- LinkedIn: 10-15s + daily cap tracking

## Implementation Notes

- All functions are pure where possible, state managed via database
- Zod schemas define all data structures with validation
- Pino logger with pretty printing for development
- LinkedIn uses manual login with persistent session storage in `data/linkedin-session/`

## Environment Variables

```env
GOOGLE_MAPS_API_KEY=your_api_key
ANTHROPIC_API_KEY=your_api_key
```
