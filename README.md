# Southlike Leads

CLI-based lead collection system for real estate agents in Porto Alegre. Scrapes Google Maps, agency websites, and LinkedIn to build a CRM-ready contact database.

## Setup

```bash
bun install
```

Create `.env` with your API keys:

```env
GOOGLE_MAPS_API_KEY=your_key
ANTHROPIC_API_KEY=your_key
```

## Usage

### Full Pipeline

```bash
bun run cli collect --limit 50
```

### Individual Scrapers

```bash
# Google Maps (requires GOOGLE_MAPS_API_KEY)
bun run cli scrape google-maps --limit 100

# Website scraping with AI analysis (requires ANTHROPIC_API_KEY)
bun run cli scrape websites --limit 50

# LinkedIn (requires manual login first)
bun run cli scrape linkedin --login    # Opens browser for login
bun run cli scrape linkedin --limit 20  # Scrapes with saved session
```

### Export & Stats

```bash
# Export to Excel
bun run cli export --output leads.xlsx

# View statistics
bun run cli stats

# Find/merge duplicates
bun run cli dedupe --dry-run
bun run cli dedupe

# Clear cache
bun run cli clear-cache
bun run cli clear-cache --source google_maps
bun run cli clear-cache --expired
```

## Data Flow

1. **Google Maps** → Companies (name, address, phone, website, rating)
2. **Websites** → Enrichment (emails, social media, CRECI, decision-makers)
3. **LinkedIn** → Decision-makers (name, title, profile URL)
4. **Deduplication** → Merge duplicate entries
5. **Export** → Excel with Leads, Interactions, Dashboard tabs

## Database

SQLite database stored at `data/leads.db`:

- `companies` - real estate agencies
- `decision_makers` - owners, directors, partners
- `interactions` - contact log
- `pipeline_status` - CRM status tracking
- `scrape_cache` - cached API responses
- `scrape_jobs` - resumable job queue

## Rate Limits

- Google Maps: 2-3s between requests
- Websites: 1-2s between requests
- LinkedIn: 10-15s delays, 100/day cap
