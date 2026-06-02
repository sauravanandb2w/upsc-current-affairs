# Monthly revision

Optional per-month files:

```
2025-06/
├── digest.md       # your end-of-month summary
└── flashcards.json # backup export (live deck in Supabase)
```

Generate topic reports across months:

```bash
python3 scripts/topic-report.py --year 2025 --tag monetary-policy -o reports/rbi-2025.md
```
