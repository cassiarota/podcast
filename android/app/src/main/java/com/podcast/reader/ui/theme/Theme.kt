package com.podcast.reader.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.luminance

@Composable
fun PodcastReaderTheme(preset: BackgroundPreset, content: @Composable () -> Unit) {
    val isDark = preset.bg.luminance() < 0.4f
    val colors = if (isDark) {
        darkColorScheme(
            background = preset.bg,
            surface = preset.bg,
            onBackground = preset.fg,
            onSurface = preset.fg,
        )
    } else {
        lightColorScheme(
            background = preset.bg,
            surface = preset.bg,
            onBackground = preset.fg,
            onSurface = preset.fg,
        )
    }
    MaterialTheme(colorScheme = colors, content = content)
}
