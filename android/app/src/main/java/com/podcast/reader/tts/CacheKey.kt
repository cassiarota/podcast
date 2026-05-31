package com.podcast.reader.tts

import com.podcast.reader.util.sha256Hex

object CacheKey {
    /** Same formula as desktop/src-tauri/src/cache.rs::cache_key. */
    fun derive(textHash: String, engine: String, voice: String, language: String, speed: Float): String {
        val raw = "$textHash|$engine|$voice|$language|${"%.2f".format(speed)}"
        return sha256Hex(raw.toByteArray(Charsets.UTF_8))
    }
}
