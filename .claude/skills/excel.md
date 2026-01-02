# Excel Analysis Skill

Analyze, filter, and work with lead spreadsheets for southlike-leads.

## Usage

```
/excel <file>                    # Analyze spreadsheet
/excel filter <criteria>         # Filter leads
/excel priority                  # Suggest contact priority
/excel merge-prep                # Prep for mail merge
```

## Commands

### Analyze Spreadsheet

Read and summarize spreadsheet contents:

```bash
# Read the file
cat leads.xlsx | head  # won't work, use xlsx library

# Better: export stats from DB
bun run cli stats
```

When analyzing, report:
- Total leads count
- Breakdown by status (new, contacted, qualified, etc.)
- Leads with missing data (no phone, no email, no decision maker)
- Data quality issues

### Filter Leads

Filter by various criteria:

**By status:**
- `status=new` - Not yet contacted
- `status=contacted` - Already reached out
- `status=qualified` - Good fit confirmed

**By completeness:**
- `has_email=true` - Has email address
- `has_phone=true` - Has phone number
- `has_decision_maker=true` - Has decision maker info

**By rating:**
- `rating>=4` - High rated on Google

### Priority Suggestions

Analyze leads and suggest contact priority based on:

1. **High Priority**
   - Status: new
   - Has decision maker with email/phone
   - Rating >= 4.0
   - Has CRECI (verified broker)

2. **Medium Priority**
   - Status: new
   - Has company email/phone but no decision maker
   - Any rating

3. **Low Priority**
   - Missing contact info
   - Already contacted with no response
   - Low rating (< 3.0)

### Mail Merge Prep

Format data for email campaigns:

```
/excel merge-prep
```

Outputs CSV with columns:
- first_name (from decision maker)
- email
- company_name
- personalization_field

## CLI Commands

```bash
# Import from external spreadsheet
bun run cli import leads.xlsx
bun run cli import contacts.csv --allow-duplicates

# Sync CRM changes back
bun run cli sync leads.xlsx --dry-run  # preview
bun run cli sync leads.xlsx            # apply

# Export fresh copy
bun run cli export --output leads.xlsx
bun run cli export --format csv
```

## Import Column Mapping

The import accepts these column names (Portuguese or English):

| Field | Accepted Headers |
|-------|------------------|
| Company | empresa, company, nome, razão social |
| Phone | telefone, phone, tel, fone |
| Email | email, e-mail |
| Website | website, site, url |
| Decision Maker | decisor, contact, responsável |
| Title | cargo, title, função |

## Sync Behavior

When syncing from Excel:

**Syncs (Excel → DB):**
- Status
- Last contact date
- Next step
- Notes

**Does NOT sync (preserves DB data):**
- Company name, address, phone, email, website
- Decision maker info
- Ratings, CRECI
- Social media links

This ensures scraped data isn't overwritten by manual edits.
