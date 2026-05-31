"""Tests for the KokoroEngine language-code mapping.

The real `kokoro` Python package isn't installed in the test sandbox, so we
only test the language-code lookup table — no model load required.
"""

from __future__ import annotations

import unittest

from engine_kokoro import LANG_CODE_MAP, _resolve_lang_code


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


class VoiceDerivedLanguageTest(unittest.TestCase):
    """Regression for the user-reported "Chinese letter, Chinese letter"
    bug: a Chinese voice with a stale `language=en` setting must still
    pick the Chinese phonemizer."""

    def test_chinese_voice_overrides_english_language(self) -> None:
        self.assertEqual(_resolve_lang_code("zf_xiaoxiao", "en"), "z")
        self.assertEqual(_resolve_lang_code("zm_yunxi", "en"), "z")

    def test_american_voice_overrides_chinese_language(self) -> None:
        self.assertEqual(_resolve_lang_code("af_heart", "zh"), "a")
        self.assertEqual(_resolve_lang_code("am_adam", "zh"), "a")

    def test_british_voice_overrides_language(self) -> None:
        self.assertEqual(_resolve_lang_code("bf_alice", "en"), "b")

    def test_japanese_voice(self) -> None:
        self.assertEqual(_resolve_lang_code("jf_alpha", "en"), "j")

    def test_unrecognized_voice_falls_back_to_language(self) -> None:
        self.assertEqual(_resolve_lang_code("default", "zh"), "z")
        self.assertEqual(_resolve_lang_code("custom_voice_id", "ja"), "j")
        self.assertEqual(_resolve_lang_code("", "en"), "a")

    def test_unknown_language_falls_back_to_american(self) -> None:
        self.assertEqual(_resolve_lang_code("custom", "xx"), "a")


if __name__ == "__main__":
    unittest.main()
