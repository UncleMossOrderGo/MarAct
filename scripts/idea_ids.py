import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def idea_ids() -> list[str]:
    ideas = ROOT / "frontend/src/ideas"
    return sorted(
        path.name
        for path in ideas.iterdir()
        if path.is_dir() and re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", path.name)
    )
