package com.podcast.reader.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import com.podcast.reader.data.entity.AudioChunkEntity
import com.podcast.reader.data.entity.BookEntity
import com.podcast.reader.data.entity.PageEntity
import com.podcast.reader.data.entity.ReadingPositionEntity
import com.podcast.reader.data.entity.SectionEntity
import com.podcast.reader.data.entity.SettingsEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface BookDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(book: BookEntity)

    @Update
    suspend fun update(book: BookEntity)

    @Query("UPDATE books SET pageCount = :count WHERE id = :id")
    suspend fun updatePageCount(id: String, count: Int)

    @Query("SELECT * FROM books WHERE id = :id")
    suspend fun get(id: String): BookEntity?

    @Query("SELECT * FROM books ORDER BY createdAt DESC")
    fun observeAll(): Flow<List<BookEntity>>

    @Query("DELETE FROM books WHERE id = :id")
    suspend fun delete(id: String)
}

@Dao
interface SectionDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(sections: List<SectionEntity>)

    @Query("SELECT * FROM sections WHERE bookId = :bookId ORDER BY ord")
    suspend fun forBook(bookId: String): List<SectionEntity>
}

@Dao
interface PageDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(pages: List<PageEntity>)

    @Query("SELECT * FROM pages WHERE bookId = :bookId AND pageIndex = :index LIMIT 1")
    suspend fun get(bookId: String, index: Int): PageEntity?

    @Query("SELECT MIN(pageIndex) FROM pages WHERE bookId = :bookId AND sectionId = :sectionId")
    suspend fun firstPageOfSection(bookId: String, sectionId: String): Int?

    @Query("SELECT * FROM pages WHERE bookId = :bookId ORDER BY pageIndex")
    suspend fun forBook(bookId: String): List<PageEntity>
}

@Dao
interface ReadingPositionDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(position: ReadingPositionEntity)

    @Query("SELECT * FROM reading_positions WHERE bookId = :bookId")
    suspend fun get(bookId: String): ReadingPositionEntity?
}

@Dao
interface AudioChunkDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(chunk: AudioChunkEntity)

    @Query("SELECT * FROM audio_chunks WHERE cacheKey = :key LIMIT 1")
    suspend fun byKey(key: String): AudioChunkEntity?

    @Query("SELECT * FROM audio_chunks WHERE bookId = :bookId")
    suspend fun forBook(bookId: String): List<AudioChunkEntity>

    @Query("DELETE FROM audio_chunks WHERE bookId = :bookId")
    suspend fun deleteForBook(bookId: String)
}

@Dao
interface SettingsDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(setting: SettingsEntity)

    @Query("SELECT * FROM settings WHERE `key` = :key LIMIT 1")
    suspend fun get(key: String): SettingsEntity?
}
