
"""Akış backend package and deployment identity."""

import os

__version__ = "0.4.0"


def release_info() -> dict[str, str]:
    """Return a safe, public build identity without exposing arbitrary env data."""
    commit = (os.getenv("NF_DEPLOYMENT_SHA") or os.getenv("AKIS_BUILD_SHA") or "").strip().lower()
    if len(commit) < 7 or any(character not in "0123456789abcdef" for character in commit):
        commit = ""
    return {"version": __version__, "commit": commit[:12]}
