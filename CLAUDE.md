# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Communication

Be extremely concise. Sacrifice grammar for brevity. Same for commits, docs, comments.

## Project Purpose

Lead generation pipeline for real estate. Orchestrated by Claude Code + browser extension:
1. Scrape Google Maps for business leads
2. Enrich via LinkedIn (Claude --chrome)
3. Export to Excel for CRM usage

## Tech Stack

- **Runtime**: Bun (not Node)
- **Language**: TypeScript 5, strict mode
- **Database**: bun:sqlite
- **Validation**: Zod v4
- **Logging**: Pino
- **Frontend**: HTML imports with Bun.serve(), React (no Vite)

## Commands

```bash
bun install                          # install deps

# Collection pipeline
bun run cli collect --limit 50       # full pipeline (Maps + websites + LinkedIn)
bun run cli collect --skip-linkedin  # skip LinkedIn scraping

# Individual scrapers
bun run cli scrape google-maps --limit 100
bun run cli scrape websites --limit 50
bun run cli scrape linkedin --login  # manual login first
bun run cli scrape linkedin --limit 20

# Excel operations
bun run cli export --output leads.xlsx
bun run cli import leads.csv
bun run cli sync leads.xlsx --dry-run

# Browser extension enrichment
bun run cli serve --port 3000        # start API for claude --chrome

# Utilities
bun run cli stats
bun run cli dedupe --dry-run
bun run cli clear-cache --expired
```

## Code Style

- Functional TypeScript, pure functions, no classes
- Types over interfaces
- Zod for runtime validation
- Avoid `any` - infer types
- Bun APIs only:
  - `Bun.serve()` not express
  - `bun:sqlite` not better-sqlite3
  - `Bun.$\`cmd\`` not execa
  - No dotenv (Bun auto-loads .env)

## GitHub

Use `gh` CLI for all GitHub operations.

## Python

Use `uv` for Python package management:

```bash
uv run scripts/recalc.py leads.xlsx    # run script with deps
uv pip install openpyxl                 # install package
uv venv                                 # create venv
```
