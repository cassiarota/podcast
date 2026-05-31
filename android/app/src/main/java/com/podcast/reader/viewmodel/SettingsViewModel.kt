package com.podcast.reader.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.podcast.reader.data.LibraryRepository
import com.podcast.reader.data.ReaderSettings
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class SettingsViewModel(private val repo: LibraryRepository) : ViewModel() {
    private val _settings = MutableStateFlow(ReaderSettings())
    val settings: StateFlow<ReaderSettings> = _settings.asStateFlow()

    init {
        viewModelScope.launch { _settings.value = repo.getReaderSettings() }
    }

    fun update(patch: ReaderSettings.() -> ReaderSettings) {
        viewModelScope.launch {
            val next = _settings.value.patch()
            _settings.value = next
            repo.saveReaderSettings(next)
        }
    }
}
