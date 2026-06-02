#!/usr/bin/env python3
"""Build data/index.json from study/items/*/manifest.json."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ITEMS_DIR = ROOT / "study" / "items"
OUT_PATH = ROOT / "data" / "index.json"


def load_manifest(path: Path) -> dict | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        print(f"warn: skip {path}: {exc}", file=sys.stderr)
        return None
    if not data.get("id"):
        data["id"] = path.parent.name
    return data


def main() -> int:
    items: list[dict] = []
    if ITEMS_DIR.is_dir():
        for manifest_path in sorted(ITEMS_DIR.glob("*/manifest.json")):
            row = load_manifest(manifest_path)
            if row:
                row["_folder"] = manifest_path.parent.name
                items.append(row)

    items.sort(key=lambda x: (x.get("date") or "", x.get("id") or ""), reverse=True)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generatedAt": __import__("datetime").datetime.now(__import__("datetime").timezone.utc)
        .isoformat()
        .replace("+00:00", "Z"),
        "count": len(items),
        "items": items,
    }
    OUT_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {OUT_PATH} ({len(items)} items)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
