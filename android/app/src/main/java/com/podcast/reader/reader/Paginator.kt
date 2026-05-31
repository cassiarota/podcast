package com.podcast.reader.reader

/**
 * Page chunker — mirrors desktop/src-tauri/src/import_txt.rs::paginate.
 *
 * Splits text into ~PAGE_BYTES-byte chunks, snapping backwards to paragraph
 * (`\n\n`) or space boundaries when a clean break is available in the second
 * half of the candidate window. Always lands on UTF-8 character boundaries.
 */
object Paginator {
    const val PAGE_BYTES = 1800

    data class PageChunk(val text: String, val offset: Int, val len: Int)

    fun paginate(body: String, baseOffset: Int = 0): List<PageChunk> {
        val out = mutableListOf<PageChunk>()
        val bytes = body.toByteArray(Charsets.UTF_8)
        val total = bytes.size
        var start = 0
        while (start < total) {
            var end = (start + PAGE_BYTES).coerceAtMost(total)
            // CRITICAL: snap `end` backwards to a UTF-8 char boundary BEFORE
            // decodeToString, otherwise the decoded String contains a U+FFFD
            // replacement at the boundary and `lastIndexOf` operates on a
            // String whose char→byte offsets no longer round-trip cleanly.
            // (Continuation bytes have the bit pattern 10xxxxxx.)
            while (end > start && end < total && (bytes[end].toInt() and 0xC0) == 0x80) {
                end -= 1
            }
            if (end < total) {
                val window = bytes.decodeToString(start, end)
                val paragraph = window.lastIndexOf("\n\n")
                if (paragraph != -1 && paragraph > PAGE_BYTES / 2) {
                    end = start + paragraph.toUtf8ByteLen(window) + 2
                } else {
                    val space = window.lastIndexOf(' ')
                    if (space != -1 && space > PAGE_BYTES / 2) {
                        end = start + space.toUtf8ByteLen(window) + 1
                    }
                }
            }
            // Belt-and-suspenders: advance forward past any continuation bytes
            // (covers the case where `end` came from rfind on a non-ASCII char).
            while (end < total && (bytes[end].toInt() and 0xC0) == 0x80) {
                end += 1
            }
            // Force progress if we somehow couldn't advance.
            if (end <= start) {
                end = start + 1
                while (end < total && (bytes[end].toInt() and 0xC0) == 0x80) {
                    end += 1
                }
            }
            val chunk = bytes.decodeToString(start, end)
            out.add(PageChunk(chunk, baseOffset + start, end - start))
            start = end
        }
        return out
    }

    /** Convert a *char* index inside `window` to a UTF-8 *byte* offset. */
    private fun Int.toUtf8ByteLen(window: String): Int {
        if (this <= 0) return 0
        return window.substring(0, this).toByteArray(Charsets.UTF_8).size
    }
}
