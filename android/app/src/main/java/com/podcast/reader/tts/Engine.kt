package com.podcast.reader.tts

import java.io.File

interface Engine {
    val name: String
    val isLoaded: Boolean
    suspend fun load()
    suspend fun unload()

    /**
     * Synthesizes `text` into a 16-bit mono WAV at `outFile`. Returns duration in ms.
     */
    suspend fun synthesize(
        text: String,
        outFile: File,
        voice: String = "default",
        language: String = "en",
        speed: Float = 1.0f,
    ): Long
}

class EngineNotReadyException(
    val reason: String,
    message: String,
    val paths: List<String> = emptyList(),
) : RuntimeException(message)
