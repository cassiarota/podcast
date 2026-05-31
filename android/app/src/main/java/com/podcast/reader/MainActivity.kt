package com.podcast.reader

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.lifecycle.viewmodel.compose.viewModel
import com.podcast.reader.ui.AppRoot
import com.podcast.reader.viewmodel.LibraryViewModel
import com.podcast.reader.viewmodel.ReaderViewModel
import com.podcast.reader.viewmodel.SettingsViewModel
import com.podcast.reader.viewmodel.viewModelFactory

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val app = application as PodcastReaderApp
        setContent {
            val libraryVm: LibraryViewModel = viewModel(
                factory = viewModelFactory { LibraryViewModel(app.repository) }
            )
            val readerVm: ReaderViewModel = viewModel(
                factory = viewModelFactory { ReaderViewModel(app.repository, app.ttsManager) }
            )
            val settingsVm: SettingsViewModel = viewModel(
                factory = viewModelFactory { SettingsViewModel(app.repository) }
            )
            val settings by settingsVm.settings.collectAsState()
            AppRoot(
                libraryVm = libraryVm,
                readerVm = readerVm,
                settings = settings,
                onUpdateSettings = settingsVm::update,
            )
        }
    }
}
