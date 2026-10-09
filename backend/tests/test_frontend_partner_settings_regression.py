"""Regression test for PartnerSettings frontend code.

Verifies:
1. setPartnerNameEditing is not referenced anywhere in frontend source files.
2. All tab navigation click handlers in PartnerSettings.jsx reference valid state setters.
"""

import re
from pathlib import Path

FRONTEND_SRC = Path(__file__).resolve().parent.parent.parent / "frontend" / "src"
PARTNER_SETTINGS_PATH = FRONTEND_SRC / "pages" / "PartnerSettings.jsx"


def test_set_partner_name_editing_not_in_frontend():
    """Verify setPartnerNameEditing is not present anywhere in frontend/src."""
    assert FRONTEND_SRC.exists(), f"Frontend src directory not found at {FRONTEND_SRC}"
    
    matches = []
    for jsx_file in FRONTEND_SRC.rglob("*.jsx"):
        content = jsx_file.read_text(encoding="utf-8")
        if "setPartnerNameEditing" in content:
            matches.append(str(jsx_file.relative_to(FRONTEND_SRC)))
            
    assert not matches, f"Found undefined setPartnerNameEditing reference in: {matches}"


def test_partner_settings_tab_click_handler_valid():
    """Verify PartnerSettings tab click handler references setProfileEditing instead of setPartnerNameEditing."""
    content = PARTNER_SETTINGS_PATH.read_text(encoding="utf-8")
    
    # Check that tab click handler calls setProfileEditing(false)
    assert "setProfileEditing(false)" in content
    assert "setPartnerNameEditing" not in content
