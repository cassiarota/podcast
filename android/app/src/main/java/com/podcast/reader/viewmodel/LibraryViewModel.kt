package com.podcast.reader.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.podcast.reader.data.LibraryRepository
import com.podcast.reader.data.entity.BookEntity
import com.podcast.reader.importer.EpubImporter
import com.podcast.reader.importer.ImportedBook
import com.podcast.reader.importer.TxtImporter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Generic Compose-friendly ViewModel factory that takes a zero-arg builder. */
inline fun <reified T : ViewModel> viewModelFactory(crossinline builder: () -> T): ViewModelProvider.Factory =
    object : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <U : ViewModel> create(modelClass: Class<U>): U = builder() as U
    }

class LibraryViewModel(private val repo: LibraryRepository) : ViewModel() {
    val books: StateFlow<List<BookEntity>> = repo.observeBooks().stateIn(
        viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList()
    )

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error

    fun importTxt(bytes: ByteArray, displayName: String) {
        viewModelScope.launch {
            runCatching {
                val imported = withContext(Dispatchers.Default) {
                    TxtImporter.import(bytes, displayName, sourcePath = null)
                }
                repo.saveImport(imported.book, imported.sections, imported.pages)
            }.onFailure { _error.value = it.message ?: it::class.simpleName }
        }
    }

    fun importEpub(bytes: ByteArray, displayName: String) {
        viewModelScope.launch {
            runCatching {
                val imported: ImportedBook = withContext(Dispatchers.Default) {
                    EpubImporter.import(bytes, displayName, sourcePath = null)
                }
                repo.saveImport(imported.book, imported.sections, imported.pages)
            }.onFailure { _error.value = it.message ?: it::class.simpleName }
        }
    }

    fun clearError() { _error.value = null }
}
