package com.podcast.reader.data

import com.podcast.reader.data.entity.BookEntity
import com.podcast.reader.data.entity.PageEntity
import com.podcast.reader.data.entity.ReadingPositionEntity
import com.podcast.reader.data.entity.SectionEntity
import com.podcast.reader.data.entity.SettingsEntity
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

@Serializable
data class ReaderSettings(
    val fontSize: String = "medium",
    val background: String = "warm-paper",
    val brightness: Double = 1.0,
)

class LibraryRepository(private val db: AppDatabase) {
    private val json = Json { ignoreUnknownKeys = true }

    fun observeBooks(): Flow<List<BookEntity>> = db.bookDao().observeAll()

    suspend fun getBook(id: String): BookEntity? = db.bookDao().get(id)

    suspend fun sectionsForBook(id: String): List<SectionEntity> = db.sectionDao().forBook(id)

    suspend fun page(bookId: String, index: Int): PageEntity? = db.pageDao().get(bookId, index)

    suspend fun firstPageOfSection(bookId: String, sectionId: String): Int =
        db.pageDao().firstPageOfSection(bookId, sectionId) ?: 0

    suspend fun savePosition(position: ReadingPositionEntity) {
        db.readingPositionDao().upsert(position)
    }

    suspend fun position(bookId: String): ReadingPositionEntity? =
        db.readingPositionDao().get(bookId)

    suspend fun saveImport(
        book: BookEntity,
        sections: List<SectionEntity>,
        pages: List<PageEntity>,
    ) {
        // Room serializes all DAO calls on its single-thread executor.
        // For Phase 2 we issue them sequentially; if we ever need true
        // atomicity, switch to a @Transaction-annotated DAO method.
        db.bookDao().insert(book)
        db.sectionDao().insertAll(sections)
        db.pageDao().insertAll(pages)
        db.bookDao().updatePageCount(book.id, pages.size)
    }

    suspend fun getReaderSettings(): ReaderSettings {
        val row = db.settingsDao().get("reader") ?: return ReaderSettings()
        return runCatching { json.decodeFromString<ReaderSettings>(row.value) }
            .getOrElse { ReaderSettings() }
    }

    suspend fun saveReaderSettings(settings: ReaderSettings) {
        db.settingsDao().upsert(SettingsEntity("reader", json.encodeToString(settings)))
    }
}
