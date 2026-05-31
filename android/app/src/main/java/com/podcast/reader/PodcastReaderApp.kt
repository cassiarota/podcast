package com.podcast.reader

import android.app.Application
import com.podcast.reader.data.AppDatabase
import com.podcast.reader.data.LibraryRepository
import com.podcast.reader.tts.TtsManager

class PodcastReaderApp : Application() {
    lateinit var database: AppDatabase
        private set
    lateinit var repository: LibraryRepository
        private set
    lateinit var ttsManager: TtsManager
        private set

    override fun onCreate() {
        super.onCreate()
        database = AppDatabase.get(this)
        repository = LibraryRepository(database)
        ttsManager = TtsManager(this, database)
    }
}
