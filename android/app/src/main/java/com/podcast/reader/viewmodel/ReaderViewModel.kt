package com.podcast.reader.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.podcast.reader.data.LibraryRepository
import com.podcast.reader.data.entity.PageEntity
import com.podcast.reader.data.entity.ReadingPositionEntity
import com.podcast.reader.data.entity.SectionEntity
import com.podcast.reader.tts.TtsManager
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class ReaderUiState(
    val openBookId: String? = null,
    val sections: List<SectionEntity> = emptyList(),
    val currentPage: PageEntity? = null,
    val pageIndex: Int = 0,
    val pageCount: Int = 0,
    val controlsVisible: Boolean = false,
    val tocOpen: Boolean = false,
    val ttsPath: String? = null,
    val ttsError: String? = null,
    val ttsBusy: Boolean = false,
)

class ReaderViewModel(
    private val repo: LibraryRepository,
    private val tts: TtsManager,
) : ViewModel() {
    private val _state = MutableStateFlow(ReaderUiState())
    val state: StateFlow<ReaderUiState> = _state.asStateFlow()

    fun open(bookId: String) {
        viewModelScope.launch {
            val book = repo.getBook(bookId) ?: return@launch
            val sections = repo.sectionsForBook(bookId)
            val saved = repo.position(bookId)
            val index = saved?.pageIndex ?: 0
            val page = repo.page(bookId, index)
            _state.value = ReaderUiState(
                openBookId = bookId,
                sections = sections,
                currentPage = page,
                pageIndex = index,
                pageCount = book.pageCount,
                controlsVisible = false,
                tocOpen = false,
            )
        }
    }

    fun close() {
        _state.value = ReaderUiState()
    }

    fun goTo(index: Int) {
        val s = _state.value
        val bookId = s.openBookId ?: return
        val clamped = index.coerceIn(0, (s.pageCount - 1).coerceAtLeast(0))
        viewModelScope.launch {
            val page = repo.page(bookId, clamped) ?: return@launch
            val percent = if (s.pageCount > 0) (clamped + 1).toDouble() / s.pageCount else 0.0
            repo.savePosition(
                ReadingPositionEntity(
                    bookId = bookId,
                    sectionId = page.sectionId,
                    pageIndex = clamped,
                    sourceOffset = page.sourceOffset,
                    percent = percent,
                    updatedAt = System.currentTimeMillis() / 1000,
                )
            )
            _state.value = s.copy(currentPage = page, pageIndex = clamped, controlsVisible = s.controlsVisible)
        }
    }

    fun next() = goTo(_state.value.pageIndex + 1)
    fun prev() = goTo(_state.value.pageIndex - 1)

    fun toggleControls() {
        _state.value = _state.value.copy(controlsVisible = !_state.value.controlsVisible)
    }
    fun hideControls() { _state.value = _state.value.copy(controlsVisible = false) }
    fun setTocOpen(open: Boolean) { _state.value = _state.value.copy(tocOpen = open) }

    fun jumpToSection(sectionId: String) {
        val bookId = _state.value.openBookId ?: return
        viewModelScope.launch {
            val idx = repo.firstPageOfSection(bookId, sectionId)
            goTo(idx)
            setTocOpen(false)
        }
    }

    fun play(voice: String = "default") {
        val s = _state.value
        val page = s.currentPage ?: return
        viewModelScope.launch {
            _state.value = s.copy(ttsBusy = true, ttsError = null)
            runCatching {
                tts.generateOrCached(page.bookId, page.id, page.content, voice)
            }.onSuccess { chunk ->
                _state.value = _state.value.copy(ttsBusy = false, ttsPath = chunk.path)
            }.onFailure {
                _state.value = _state.value.copy(ttsBusy = false, ttsError = it.message)
            }
        }
    }

    fun clearTtsError() {
        _state.value = _state.value.copy(ttsError = null)
    }
}
