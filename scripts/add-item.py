#!/usr/bin/env python3
"""Create a new CA item folder with manifest.json and notes.md template."""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ITEMS_DIR = ROOT / "study" / "items"

NOTES_TEMPLATE = """## Facts

-

## Static connection



## GS paper fit

-

## Exam angle



## Miscellaneous


"""

SLUG_RE = re.compile(r"[^a-z0-9]+")


def slugify(text: str) -> str:
    s = SLUG_RE.sub("-", text.lower().strip())
    return s.strip("-")[:48] or "item"


def main() -> int:
    parser = argparse.ArgumentParser(description="Add a new current affairs item")
    parser.add_argument("title", help="Short title")
    parser.add_argument("--date", default=date.today().isoformat(), help="YYYY-MM-DD")
    parser.add_argument("--tag", action="append", default=[], dest="tags")
    parser.add_argument("--thread", action="append", default=[], dest="threads")
    parser.add_argument("--gs", type=int, action="append", dest="gs_papers", help="GS paper 1-4")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    item_id = f"{args.date}-{slugify(args.title)}"
    folder = ITEMS_DIR / item_id
    if folder.exists():
        print(f"error: already exists: {folder}", file=sys.stderr)
        return 1

    manifest = {
        "id": item_id,
        "date": args.date,
        "title": args.title,
        "status": "to-study",
        "gsPapers": sorted(set(args.gs_papers)),
        "tags": args.tags,
        "threads": args.threads,
        "images": [],
        "sources": [],
        "links": [],
    }

    if args.dry_run:
        print(json.dumps(manifest, indent=2))
        return 0

    folder.mkdir(parents=True)
    (folder / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    (folder / "notes.md").write_text(NOTES_TEMPLATE, encoding="utf-8")
    print(f"created {folder}")
    print("next: python3 scripts/build-index.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
