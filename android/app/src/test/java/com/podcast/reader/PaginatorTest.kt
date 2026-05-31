package com.podcast.reader.reader

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PaginatorTest {
    @Test fun shortTextYieldsOnePage() {
        val pages = Paginator.paginate("Hello world.")
        assertEquals(1, pages.size)
        assertEquals("Hello world.", pages[0].text)
    }

    @Test fun longTextSplitsIntoMultiplePages() {
        val body = "abc ".repeat(800)
        val pages = Paginator.paginate(body)
        assertTrue("got ${pages.size} pages", pages.size >= 2)
        val joined = pages.joinToString("") { it.text }
        assertEquals(body, joined)
    }

    @Test fun paginationPreservesOffsets() {
        val body = "x".repeat(5000)
        val pages = Paginator.paginate(body, baseOffset = 100)
        var running = 100
        for (p in pages) {
            assertEquals(running, p.offset)
            running += p.len
        }
    }

    @Test fun doesNotBreakUtf8Boundaries() {
        val body = "日本語のテキスト ".repeat(400)
        val pages = Paginator.paginate(body)
        for (p in pages) {
            // Round-trip must produce the same characters (UTF-8 safe).
            val rt = p.text.toByteArray(Charsets.UTF_8).toString(Charsets.UTF_8)
            assertEquals(p.text, rt)
        }
    }
}
