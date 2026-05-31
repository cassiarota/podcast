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

    private fun splitIntoSections(text: String): List<RawSection> {
        val out = mutableListOf<RawSection>()
        val bytes = text.toByteArray(Charsets.UTF_8)
        var byteCursor = 0
        var pendingStart = 0
        var pendingTitle = ""
        for (line in text.split("\n")) {
            val lineBytes = line.toByteArray(Charsets.UTF_8).size
            val trimmed = line.trim()
            val isHeading = trimmed.isNotEmpty()
                && trimmed.length < 80
                && trimmed.none { it.isLowerCase() }
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
