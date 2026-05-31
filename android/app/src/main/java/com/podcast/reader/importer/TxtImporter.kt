package com.podcast.reader.importer

import com.podcast.reader.data.entity.BookEntity
import com.podcast.reader.data.entity.PageEntity
import com.podcast.reader.data.entity.SectionEntity
import com.podcast.reader.reader.Paginator
import com.podcast.reader.util.sha256Hex
import java.util.UUID

data class ImportedBook(
    val book: BookEntity,
    val sections: List<SectionEntity>,
    val pages: List<PageEntity>,
)

object TxtImporter {
    /**
     * Mirrors desktop/src-tauri/src/import_txt.rs.
     * Title is taken from the supplied `displayName`; the caller fills it from
     * either the picked Uri's display name or a fallback.
     */
    fun import(rawBytes: ByteArray, displayName: String, sourcePath: String?): ImportedBook {
        val text = String(rawBytes, Charsets.UTF_8)
            .replace("\r\n", "\n")
            .replace("\r", "\n")

        val sourceHash = sha256Hex(text.toByteArray(Charsets.UTF_8))
        val bookId = UUID.randomUUID().toString()
        val now = System.currentTimeMillis() / 1000

        val rawSections = splitIntoSections(text)
        val sections = mutableListOf<SectionEntity>()
        val pages = mutableListOf<PageEntity>()
        var pageIndex = 0
        for ((ord, raw) in rawSections.withIndex()) {
            val sectionId = UUID.randomUUID().toString()
            sections.add(
                SectionEntity(
                    id = sectionId,
                    bookId = bookId,
                    title = raw.title,
                    ord = ord,
                    sourceOffset = raw.offset,
                    sourceLen = raw.len,
                )
            )
            for (chunk in Paginator.paginate(raw.body, raw.offset)) {
                pages.add(
                    PageEntity(
                        id = UUID.randomUUID().toString(),
                        bookId = bookId,
                        sectionId = sectionId,
                        pageIndex = pageIndex,
                        textHash = sha256Hex(chunk.text.toByteArray(Charsets.UTF_8)),
                        content = chunk.text,
                        sourceOffset = chunk.offset,
                        sourceLen = chunk.len,
                    )
                )
                pageIndex++
            }
        }

        val book = BookEntity(
            id = bookId,
            title = displayName.ifBlank { "Untitled" },
            author = null,
            sourceFormat = "txt",
            sourcePath = sourcePath,
            sourceHash = sourceHash,
            pageCount = pageIndex,
            createdAt = now,
        )
        return ImportedBook(book, sections, pages)
    }

    private data class RawSection(val title: String, val body: String, val offset: Int, val len: Int)

    private val CHINESE_HEADINGS = setOf(
        "序章", "序言", "序", "楔子", "尾声", "番外", "终章", "终曲",
        "正文卷", "终结", "前言", "后记", "致谢",
    )

    /**
     * Heading detection — mirrors desktop/src-tauri/src/import_txt.rs::is_heading_line.
     *
     * Previously used a naive "no lowercase letters" check which falsely flagged
     * every short Chinese line as a heading. This now recognizes Chinese chapter
     * markers (第N章/节/回/卷/篇), common Chinese heading tokens, English chapter
     * markers, and ALL-CAPS English headings.
     */
    internal fun isHeadingLine(line: String): Boolean {
        val trimmed = line.trim()
        if (trimmed.isEmpty() || trimmed.toByteArray(Charsets.UTF_8).size > 80) return false
        if (trimmed.startsWith("第") && trimmed.any { it in "章节回卷篇" }) return true
        if (trimmed in CHINESE_HEADINGS) return true
        val lower = trimmed.lowercase()
        if (lower.startsWith("chapter ") || lower.startsWith("part ")
            || lower.startsWith("book ") || lower.startsWith("section ")
        ) return true
        if (lower in setOf("prologue", "epilogue", "introduction", "preface", "foreword")) return true
        val asciiLetters = trimmed.filter { it.code < 128 && it.isLetter() }
        if (asciiLetters.length >= 2 && asciiLetters.all { it.isUpperCase() }) return true
        return false
    }

    private fun splitIntoSections(text: String): List<RawSection> {
        val out = mutableListOf<RawSection>()
        val bytes = text.toByteArray(Charsets.UTF_8)
        var byteCursor = 0
        var pendingStart = 0
        var pendingTitle = ""
        for (line in text.split("\n")) {
            val lineBytes = line.toByteArray(Charsets.UTF_8).size
            val trimmed = line.trim()
            val isHeading = isHeadingLine(line)
            if (isHeading && byteCursor > pendingStart) {
                val bodySlice = bytes.decodeToString(pendingStart, byteCursor)
                if (bodySlice.isNotBlank()) {
                    out.add(RawSection(pendingTitle, bodySlice, pendingStart, byteCursor - pendingStart))
                }
                pendingTitle = trimmed
                pendingStart = byteCursor + lineBytes + 1
            }
            byteCursor += lineBytes + 1
        }
        if (pendingStart < bytes.size) {
            val tail = bytes.decodeToString(pendingStart, bytes.size)
            if (tail.isNotBlank()) {
                out.add(RawSection(pendingTitle, tail, pendingStart, bytes.size - pendingStart))
            }
        }
        if (out.isEmpty()) {
            out.add(RawSection("", text, 0, bytes.size))
        }
        return out
    }
}
