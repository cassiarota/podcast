package com.podcast.reader.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import com.podcast.reader.data.entity.AudioChunkEntity
import com.podcast.reader.data.entity.BookEntity
import com.podcast.reader.data.entity.PageEntity
import com.podcast.reader.data.entity.ReadingPositionEntity
import com.podcast.reader.data.entity.SectionEntity
import com.podcast.reader.data.entity.SettingsEntity

@Database(
    entities = [
        BookEntity::class,
        SectionEntity::class,
        PageEntity::class,
        ReadingPositionEntity::class,
        AudioChunkEntity::class,
        SettingsEntity::class,
    ],
    version = 1,
    exportSchema = false,
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun bookDao(): BookDao
    abstract fun sectionDao(): SectionDao
    abstract fun pageDao(): PageDao
    abstract fun readingPositionDao(): ReadingPositionDao
    abstract fun audioChunkDao(): AudioChunkDao
    abstract fun settingsDao(): SettingsDao

    companion object {
        @Volatile private var instance: AppDatabase? = null

        fun get(context: Context): AppDatabase {
            return instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    "library.db",
                ).build().also { instance = it }
            }
        }
    }
}
