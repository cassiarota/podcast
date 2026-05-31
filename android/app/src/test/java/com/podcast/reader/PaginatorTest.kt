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

    @Test fun handlesCjkAtPageBoundaryWithoutCorruption() {
        // Regression for the crash hit on 道诡异仙.txt: PAGE_BYTES=1800 landed
        // inside a 3-byte 中文 codepoint. Build a body where the boundary
        // sits inside a multi-byte char and there's no \n\n or space refuge
        // in the second half of the window.
        val body = "不".repeat(1000)   // 3000 UTF-8 bytes, no whitespace
        val pages = Paginator.paginate(body)
        val joined = pages.joinToString("") { it.text }
        assertEquals("paginate must not drop or corrupt source bytes", body, joined)
    }

    @Test fun handlesRealChineseNovelPassage() {
        val passage = "李火旺举起手中的捣药杆，百无聊赖的一下一下砸在捣药罐里，把里面夹杂着淤泥的流光青石慢慢碾磨成粉末。虽然这溶洞潮湿寒冷，但是他身上也只穿着一件粗糙布衣。但是他却满脸不在乎，似乎并没有把这一切放在眼里。"
        val body = passage.repeat(50)
        val pages = Paginator.paginate(body)
        assertTrue(pages.size >= 2)
        val joined = pages.joinToString("") { it.text }
        assertEquals(body, joined)
    }
}
