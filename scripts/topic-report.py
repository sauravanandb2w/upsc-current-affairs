#!/usr/bin/env python3
"""Export a year-end topic report from git manifests + notes.md."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ITEMS_DIR = ROOT / "study" / "items"
INDEX_PATH = ROOT / "data" / "index.json"

SECTION_ORDER = [
    "Summary / story",
    "Facts",
    "Static connection",
    "GS paper fit",
    "Exam angle",
    "Miscellaneous",
]


def parse_notes_md(text: str) -> dict[str, str]:
    sections: dict[str, str] = {}
    current = None
    buf: list[str] = []
    for line in text.splitlines():
        if line.startswith("## "):
            if current is not None:
                sections[current] = "\n".join(buf).strip()
            current = line[3:].strip()
            buf = []
        elif current is not None:
            buf.append(line)
    if current is not None:
        sections[current] = "\n".join(buf).strip()
    return sections


def load_items() -> list[dict]:
    if INDEX_PATH.is_file():
        data = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
        return data.get("items") or []
    items = []
    for manifest_path in sorted(ITEMS_DIR.glob("*/manifest.json")):
        items.append(json.loads(manifest_path.read_text(encoding="utf-8")))
    return items


def matches(item: dict, year: int | None, tag: str | None, thread: str | None) -> bool:
    d = item.get("date") or ""
    if year is not None and not d.startswith(str(year)):
        return False
    tags = [t.lower() for t in (item.get("tags") or [])]
    threads = item.get("threads") or []
    if tag and tag.lower() not in tags:
        return False
    if thread and thread not in threads:
        return False
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="Topic lens export (markdown)")
    parser.add_argument("--year", type=int, help="Filter by year e.g. 2025")
    parser.add_argument("--tag", help="Filter by tag e.g. monetary-policy")
    parser.add_argument("--thread", help="Filter by thread id")
    parser.add_argument("-o", "--output", type=Path, help="Write markdown file")
    args = parser.parse_args()

    if not args.tag and not args.thread:
        print("error: provide --tag and/or --thread", file=sys.stderr)
        return 1

    selected = [
        i
        for i in load_items()
        if matches(i, args.year, args.tag, args.thread)
    ]
    selected.sort(key=lambda x: x.get("date") or "")

    title_bits = []
    if args.year:
        title_bits.append(str(args.year))
    if args.tag:
        title_bits.append(args.tag)
    if args.thread:
        title_bits.append(args.thread)
    heading = "CA Topic Report — " + " · ".join(title_bits)

    lines = [f"# {heading}", "", f"**Items:** {len(selected)}", ""]

    for item in selected:
        item_id = item.get("id") or ""
        folder = ITEMS_DIR / item_id
        lines.append(f"## {item.get('date', '')} — {item.get('title', item_id)}")
        lines.append("")
        if item.get("tags"):
            lines.append(f"*Tags:* {', '.join(item['tags'])}")
        if item.get("gsPapers"):
            lines.append(f"*GS papers:* {', '.join('GS' + str(p) for p in item['gsPapers'])}")
        lines.append("")

        for link in item.get("links") or []:
            label = link.get("label") or link.get("url") or "link"
            url = link.get("url") or ""
            if url:
                lines.append(f"- [{label}]({url})")
        lines.append("")

        notes_path = folder / "notes.md"
        if notes_path.is_file():
            sections = parse_notes_md(notes_path.read_text(encoding="utf-8"))
            for sec in SECTION_ORDER:
                body = sections.get(sec, "").strip()
                if body:
                    lines.append(f"### {sec}")
                    lines.append("")
                    lines.append(body)
                    lines.append("")

        lines.append("---")
        lines.append("")

    out = "\n".join(lines)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(out, encoding="utf-8")
        print(f"wrote {args.output}")
    else:
        print(out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
