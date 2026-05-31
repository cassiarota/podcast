package com.podcast.reader.tts

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class CacheKeyTest {
    @Test fun deterministic() {
        val a = CacheKey.derive("h", "kokoro", "default", "en", 1.0f)
        val b = CacheKey.derive("h", "kokoro", "default", "en", 1.0f)
        assertEquals(a, b)
        assertEquals(64, a.length)
    }

    @Test fun changesWithEveryField() {
        val base = CacheKey.derive("h", "kokoro", "v1", "en", 1.0f)
        assertNotEquals(base, CacheKey.derive("h2", "kokoro", "v1", "en", 1.0f))
        assertNotEquals(base, CacheKey.derive("h", "qwen", "v1", "en", 1.0f))
        assertNotEquals(base, CacheKey.derive("h", "kokoro", "v2", "en", 1.0f))
        assertNotEquals(base, CacheKey.derive("h", "kokoro", "v1", "ja", 1.0f))
        assertNotEquals(base, CacheKey.derive("h", "kokoro", "v1", "en", 1.25f))
    }
}
