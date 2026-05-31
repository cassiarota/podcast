package com.podcast.reader.ui.theme

import androidx.compose.ui.graphics.Color

/** 10 background presets, mirrors desktop/src/styles/themes.css. */
data class BackgroundPreset(val id: String, val label: String, val bg: Color, val fg: Color)

val BackgroundPresets: List<BackgroundPreset> = listOf(
    BackgroundPreset("white", "白", Color(0xFFFFFFFF), Color(0xFF1A1A1A)),
    BackgroundPreset("warm-paper", "暖纸", Color(0xFFF7F0E1), Color(0xFF2B2417)),
    BackgroundPreset("sepia", "古书", Color(0xFFF4ECD8), Color(0xFF5B4636)),
    BackgroundPreset("eye-protect-green", "护眼绿", Color(0xFFCBE1C1), Color(0xFF1F2D1C)),
    BackgroundPreset("gray", "中灰", Color(0xFFD6D6D6), Color(0xFF222222)),
    BackgroundPreset("low-contrast", "低对比", Color(0xFFDDD6C8), Color(0xFF4A463E)),
    BackgroundPreset("cool-paper", "冷纸", Color(0xFFEEF2F6), Color(0xFF1A2230)),
    BackgroundPreset("rose", "玫瑰", Color(0xFFF3D9D9), Color(0xFF3D1A1A)),
    BackgroundPreset("dark", "深色", Color(0xFF2A2A2A), Color(0xFFD8D8D8)),
    BackgroundPreset("black", "纯黑", Color(0xFF000000), Color(0xFFC0C0C0)),
)

fun presetById(id: String): BackgroundPreset =
    BackgroundPresets.firstOrNull { it.id == id } ?: BackgroundPresets[1] // warm-paper default
