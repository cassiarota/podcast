"""Tests for the KokoroEngine language-code mapping.

The real `kokoro` Python package isn't installed in the test sandbox, so we
only test the language-code lookup table — no model load required.
"""

from __future__ import annotations

import unittest

from engine_kokoro import LANG_CODE_MAP


class KokoroLangCodeTest(unittest.TestCase):
    def test_english_maps_to_a(self) -> None:
        self.assertEqual(LANG_CODE_MAP["en"], "a")
        self.assertEqual(LANG_CODE_MAP["en-US"], "a")

    def test_british_english_maps_to_b(self) -> None:
        self.assertEqual(LANG_CODE_MAP["en-GB"], "b")

    def test_chinese_maps_to_z(self) -> None:
        self.assertEqual(LANG_CODE_MAP["zh"], "z")

    def test_japanese_maps_to_j(self) -> None:
        self.assertEqual(LANG_CODE_MAP["ja"], "j")

    def test_all_nine_kokoro_languages_present(self) -> None:
        # Kokoro v1.0 supports 9 distinct codes; "en" alias notwithstanding,
        # we expect a, b, z, j, e, f, h, i, p (9 unique values).
        codes = set(LANG_CODE_MAP.values())
        self.assertEqual(codes, {"a", "b", "z", "j", "e", "f", "h", "i", "p"})


if __name__ == "__main__":
    unittest.main()
