package com.podcast.reader.tts

import android.content.Context
import com.podcast.reader.data.AppDatabase
import com.podcast.reader.data.entity.AudioChunkEntity
import com.podcast.reader.util.sha256Hex
import java.io.File
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Coordinates lazy engine load + WAV cache. The engine itself never loads at
 * app start — only on the first call to [generateOrCached].
 */
class TtsManager(
    private val context: Context,
    private val db: AppDatabase,
    private val engineFactory: () -> Engine = {
        // Try Kokoro first; fall back to stub if the ONNX model isn't shipped.
        runCatching { KokoroOnnxEngine(context) as Engine }.getOrElse { StubEngine() }
    },
) {
    @Volatile private var engine: Engine? = null
    @Volatile private var lastUsedMs: Long = 0
    private val audioDir: File by lazy {
        File(context.filesDir, "audio_cache").also { it.mkdirs() }
    }

    val isEngineLoaded: Boolean
        get() = engine?.isLoaded == true

    val engineName: String?
        get() = engine?.name

    suspend fun generateOrCached(
        bookId: String,
        pageId: String,
        text: String,
        voice: String = "default",
    ): AudioChunkEntity = withContext(Dispatchers.IO) {
        val textHash = sha256Hex(text.toByteArray(Charsets.UTF_8))
        val resolvedEngine = ensureEngine()
        val key = CacheKey.derive(textHash, resolvedEngine.name, voice, "en", 1.0f)

        db.audioChunkDao().byKey(key)?.let { existing ->
            if (File(existing.path).exists()) {
                lastUsedMs = System.currentTimeMillis()
                return@withContext existing
            }
        }

        val outFile = File(audioDir, "$key.wav")
        val durationMs = resolvedEngine.synthesize(text, outFile, voice = voice)
        lastUsedMs = System.currentTimeMillis()
        val entity = AudioChunkEntity(
            id = UUID.randomUUID().toString(),
            bookId = bookId,
            pageId = pageId,
            sectionId = null,
            cacheKey = key,
            path = outFile.absolutePath,
            durationMs = durationMs,
            engine = resolvedEngine.name,
            voicePreset = voice,
            textHash = textHash,
            createdAt = System.currentTimeMillis() / 1000,
        )
        db.audioChunkDao().insert(entity)
        entity
    }

    /** Idle unload — should be called from a periodic worker / lifecycle hook. */
    suspend fun unloadIfIdle(idleMs: Long = 60_000) {
        val eng = engine ?: return
        if (eng.isLoaded && System.currentTimeMillis() - lastUsedMs > idleMs) {
            eng.unload()
        }
    }

    private suspend fun ensureEngine(): Engine {
        engine?.let { if (it.isLoaded) return it }
        val eng = engine ?: engineFactory().also { engine = it }
        eng.load()
        return eng
    }
}
