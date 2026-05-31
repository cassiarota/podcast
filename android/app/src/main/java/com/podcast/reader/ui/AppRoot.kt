package com.podcast.reader.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import com.podcast.reader.data.ReaderSettings
import com.podcast.reader.ui.library.LibraryScreen
import com.podcast.reader.ui.reader.ReaderScreen
import com.podcast.reader.ui.theme.PodcastReaderTheme
import com.podcast.reader.ui.theme.presetById
import com.podcast.reader.viewmodel.LibraryViewModel
import com.podcast.reader.viewmodel.ReaderViewModel

@Composable
fun AppRoot(
    libraryVm: LibraryViewModel,
    readerVm: ReaderViewModel,
    settings: ReaderSettings,
    onUpdateSettings: (ReaderSettings.() -> ReaderSettings) -> Unit,
) {
    val readerState by readerVm.state.collectAsState()
    val preset = presetById(settings.background)
    PodcastReaderTheme(preset = preset) {
        Surface(modifier = Modifier.fillMaxSize(), color = preset.bg) {
            Box(modifier = Modifier.fillMaxSize()) {
                if (readerState.openBookId == null) {
                    LibraryScreen(
                        libraryVm = libraryVm,
                        onOpenBook = { readerVm.open(it) },
                    )
                } else {
                    ReaderScreen(
                        readerVm = readerVm,
                        settings = settings,
                        onUpdateSettings = onUpdateSettings,
                    )
                }
                // Dim overlay for brightness control.
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(Color.Black.copy(alpha = (1.0 - settings.brightness).toFloat().coerceIn(0f, 1f)))
                )
            }
        }
    }
}
