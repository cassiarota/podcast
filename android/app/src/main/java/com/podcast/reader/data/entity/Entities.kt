package com.podcast.reader.data.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(tableName = "books")
data class BookEntity(
    @PrimaryKey val id: String,
    val title: String,
    val author: String?,
    val sourceFormat: String,
    val sourcePath: String?,
    val sourceHash: String?,
    val pageCount: Int,
    val createdAt: Long,
)

@Entity(
    tableName = "sections",
    indices = [Index(value = ["bookId", "ord"])],
)
data class SectionEntity(
    @PrimaryKey val id: String,
    val bookId: String,
    val title: String,
    val ord: Int,
    val sourceOffset: Int,
    val sourceLen: Int,
)

@Entity(
    tableName = "pages",
    indices = [
        Index(value = ["bookId", "pageIndex"], unique = true),
        Index(value = ["bookId", "sectionId"]),
    ],
)
data class PageEntity(
    @PrimaryKey val id: String,
    val bookId: String,
    val sectionId: String,
    val pageIndex: Int,
    val textHash: String,
    val content: String,
    val sourceOffset: Int,
    val sourceLen: Int,
)

@Entity(tableName = "reading_positions")
data class ReadingPositionEntity(
    @PrimaryKey val bookId: String,
    val sectionId: String,
    val pageIndex: Int,
    val sourceOffset: Int,
    val percent: Double,
    val updatedAt: Long,
)

@Entity(
    tableName = "audio_chunks",
    indices = [
        Index(value = ["cacheKey"], unique = true),
        Index(value = ["bookId"]),
    ],
)
data class AudioChunkEntity(
    @PrimaryKey val id: String,
    val bookId: String,
    val pageId: String?,
    val sectionId: String?,
    val cacheKey: String,
    val path: String,
    val durationMs: Long,
    val engine: String,
    val voicePreset: String,
    val textHash: String,
    val createdAt: Long,
)

@Entity(tableName = "settings")
data class SettingsEntity(
    @PrimaryKey val key: String,
    val value: String,
)
