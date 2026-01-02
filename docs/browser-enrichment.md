# LinkedIn Enrichment via Claude Code Browser Extension

Use Claude Code's browser control to enrich leads with LinkedIn data.

## Prerequisites

1. Claude Code installed
2. Claude in Chrome extension installed
3. Logged into LinkedIn in Chrome

## Setup

### 1. Start the API Server

```bash
cd ~/projects/dev/southlike-leads
bun run cli serve --port 3000
```

Server endpoints:
- `GET /api/companies/pending` - companies without decision makers
- `POST /api/enrich/decision-maker` - add decision maker
- `POST /api/enrich/company` - update company socials

### 2. Connect Claude Code to Chrome

```bash
claude --chrome
```

## Enrichment Workflow

### Option A: Guided Enrichment

Tell Claude:

```
I need to enrich leads with LinkedIn data. Here's what to do:

1. Fetch pending companies from http://localhost:3000/api/companies/pending
2. For each company, search LinkedIn for "{company name} Porto Alegre"
3. Find decision makers with titles: diretor, sócio, owner, ceo, gerente
4. Extract: name, title, LinkedIn URL
5. POST to http://localhost:3000/api/enrich/decision-maker with:
   {
     "companyId": "<id from pending list>",
     "name": "<person name>",
     "title": "<their title>",
     "linkedinUrl": "<profile URL>"
   }
```

### Option B: Workflow Recording

1. Start recording: record yourself enriching one lead
2. Claude learns the pattern
3. Run on remaining leads

### Option C: Manual with API

Browse LinkedIn manually, then POST data:

```bash
curl -X POST http://localhost:3000/api/enrich/decision-maker \
  -H "Content-Type: application/json" \
  -d '{
    "companyId": "abc-123",
    "name": "João Silva",
    "title": "Diretor",
    "linkedinUrl": "https://linkedin.com/in/joaosilva"
  }'
```

## Title Keywords to Look For

Portuguese:
- diretor, diretora
- sócio, sócia
- proprietário, proprietária
- gerente
- fundador, fundadora

English:
- director
- partner
- owner
- ceo
- founder
- manager

## Rate Limiting

LinkedIn is sensitive to automation. Recommendations:

- 10-15 seconds between profile views
- Max 100 profiles per day
- Vary timing (don't be robotic)
- Use your real browsing session

The existing Playwright scraper has these limits built in. Browser extension gives you more natural browsing patterns.

## Data Flow

```
Chrome (LinkedIn)
      ↓
Claude Code Browser Extension
      ↓
POST to localhost:3000
      ↓
SQLite database (data/leads.db)
      ↓
bun run cli export → leads.xlsx
```

## Troubleshooting

### Server not responding

Check if running:
```bash
curl http://localhost:3000/health
```

### CORS errors

The server includes CORS headers for browser extension. If issues persist, check Chrome dev console.

### LinkedIn blocking

Signs of detection:
- Captcha challenges
- "Unusual activity" warnings
- Profile pages not loading

Solutions:
- Slow down
- Take breaks
- Use incognito with fresh session
- Wait 24 hours if blocked

## Alternative: Playwright Scraper

If browser extension isn't working, use built-in Playwright:

```bash
# First time: log in manually
bun run cli scrape linkedin --login

# Then scrape (uses saved session)
bun run cli scrape linkedin --limit 20
```
