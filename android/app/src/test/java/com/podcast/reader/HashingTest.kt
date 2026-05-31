package com.podcast.reader.tts

import com.podcast.reader.util.sha256Hex
import org.junit.Assert.assertEquals
import org.junit.Test

class HashingTest {
    @Test fun sha256HexProducesKnownValue() {
        // "" → e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
        assertEquals(
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            sha256Hex(ByteArray(0)),
        )
    }

    @Test fun sha256HexLengthIs64() {
        assertEquals(64, sha256Hex("hello".toByteArray()).length)
    }
}
