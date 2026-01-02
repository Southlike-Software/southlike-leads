# Leads Collection Skill

Orchestrates the full lead collection pipeline for southlike-leads.

## Usage

```
/leads                    # Full pipeline
/leads collect            # Collect only (no export)
/leads enrich             # LinkedIn enrichment via browser
/leads export             # Export to Excel
```

## Full Pipeline Flow

When user runs `/leads`:

1. **Collect from Google Maps + Websites**
   ```bash
   bun run cli collect --skip-linkedin --limit 50
   ```

2. **Start API server for browser enrichment**
   ```bash
   bun run cli serve --port 3000 &
   ```

3. **Guide user through LinkedIn enrichment**
   - Tell user to run `claude --chrome`
   - Provide list of pending companies (no decision makers yet)
   - Instruct Claude browser to:
     - Search LinkedIn for each company
     - Find decision makers (owners, directors, partners)
     - POST extracted data to `http://localhost:3000/api/enrich/decision-maker`

4. **Export results**
   ```bash
   bun run cli export --output leads.xlsx
   ```

## LinkedIn Enrichment Workflow

When enriching via browser extension:

1. Get pending companies:
   ```bash
   curl http://localhost:3000/api/companies/pending
   ```

2. For each company, search LinkedIn: `{company name} Porto Alegre`

3. Find profiles with titles matching:
   - diretor, director
   - sócio, partner
   - owner, proprietário
   - ceo, founder
   - gerente, manager

4. Extract and POST:
   ```json
   {
     "companyId": "uuid-from-pending-list",
     "name": "João Silva",
     "title": "Diretor",
     "linkedinUrl": "https://linkedin.com/in/joaosilva"
   }
   ```

## Commands Reference

```bash
# Individual steps
bun run cli scrape google-maps --limit 100
bun run cli scrape websites --limit 50
bun run cli scrape linkedin --login  # manual login
bun run cli scrape linkedin --limit 20

# Enrichment server
bun run cli serve --port 3000

# Export
bun run cli export --output leads.xlsx
bun run cli export --format csv

# Utilities
bun run cli stats
bun run cli dedupe --dry-run
bun run cli clear-cache --expired
```
