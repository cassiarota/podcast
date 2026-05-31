package com.podcast.reader.importer

import com.podcast.reader.data.entity.BookEntity
import com.podcast.reader.data.entity.PageEntity
import com.podcast.reader.data.entity.SectionEntity
import com.podcast.reader.reader.Paginator
import com.podcast.reader.util.sha256Hex
import java.io.InputStream
import java.util.UUID
import java.util.zip.ZipInputStream

/**
 * Minimal EPUB importer. Parses container.xml → OPF → reads spine items in order,
 * extracts plain text via the same HTML→text stripper we use on the desktop side.
 *
 * Phase 2 caveat: we do not implement full TOC reconciliation. Spine order is the
 * reading order; section titles fall back to "Chapter N" when the OPF/NAV doesn't
 * give us a friendlier label.
 */
object EpubImporter {
    fun import(epubBytes: ByteArray, displayName: String, sourcePath: String?): ImportedBook {
        val entries = readZipEntries(epubBytes)
        val container = entries["META-INF/container.xml"]
            ?: error("EPUB missing META-INF/container.xml")
        val opfPath = parseOpfPath(container.toString(Charsets.UTF_8))
            ?: error("EPUB container.xml has no rootfile entry")
        val opfBytes = entries[opfPath] ?: error("EPUB missing OPF at $opfPath")
        val opfDir = opfPath.substringBeforeLast('/', missingDelimiterValue = "")
        val opfText = opfBytes.toString(Charsets.UTF_8)

        val metadata = parseMetadata(opfText)
        val manifest = parseManifest(opfText) // id -> href
        val spineIds = parseSpine(opfText)

        val bookId = UUID.randomUUID().toString()
        val now = System.currentTimeMillis() / 1000

        val sections = mutableListOf<SectionEntity>()
        val pages = mutableListOf<PageEntity>()
        var pageIndex = 0
        var runningOffset = 0
        val fullTextChunks = StringBuilder()

        for ((spineOrd, spineId) in spineIds.withIndex()) {
            val href = manifest[spineId] ?: continue
            val resolved = if (opfDir.isEmpty()) href else "$opfDir/$href"
            val itemBytes = entries[resolved] ?: continue
            val html = itemBytes.toString(Charsets.UTF_8)
            val plain = htmlToText(html)
            if (plain.isBlank()) continue
            fullTextChunks.append(plain).append("\n\n")
            val chapterTitle = manifest.toList()
                .firstOrNull { it.first == spineId }?.first ?: "Chapter ${spineOrd + 1}"

            val sectionId = UUID.randomUUID().toString()
            val bodyBytes = plain.toByteArray(Charsets.UTF_8).size
            sections.add(
                SectionEntity(
                    id = sectionId,
                    bookId = bookId,
                    title = chapterTitle,
                    ord = spineOrd,
                    sourceOffset = runningOffset,
                    sourceLen = bodyBytes,
                )
            )
            for (chunk in Paginator.paginate(plain, runningOffset)) {
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
            runningOffset += bodyBytes
        }

        if (pages.isEmpty()) error("EPUB had no readable chapters")

        val book = BookEntity(
            id = bookId,
            title = metadata["title"] ?: displayName.ifBlank { "Untitled" },
            author = metadata["creator"],
            sourceFormat = "epub",
            sourcePath = sourcePath,
            sourceHash = sha256Hex(fullTextChunks.toString().toByteArray(Charsets.UTF_8)),
            pageCount = pageIndex,
            createdAt = now,
        )
        return ImportedBook(book, sections, pages)
    }

    private fun readZipEntries(bytes: ByteArray): Map<String, ByteArray> {
        val out = mutableMapOf<String, ByteArray>()
        ZipInputStream(bytes.inputStream()).use { zip ->
            var entry = zip.nextEntry
            while (entry != null) {
                if (!entry.isDirectory) {
                    out[entry.name] = zip.readAll()
                }
                zip.closeEntry()
                entry = zip.nextEntry
            }
        }
        return out
    }

    private fun InputStream.readAll(): ByteArray {
        val buf = java.io.ByteArrayOutputStream()
        val chunk = ByteArray(8 * 1024)
        while (true) {
            val n = read(chunk)
            if (n <= 0) break
            buf.write(chunk, 0, n)
        }
        return buf.toByteArray()
    }

    private fun parseOpfPath(containerXml: String): String? {
        val re = Regex("""full-path="([^"]+)"""")
        return re.find(containerXml)?.groupValues?.get(1)
    }

    private fun parseMetadata(opf: String): Map<String, String> {
        val out = mutableMapOf<String, String>()
        Regex("""<dc:(title|creator|language|date)[^>]*>([^<]+)</dc:""")
            .findAll(opf)
            .forEach { m ->
                out.putIfAbsent(m.groupValues[1], m.groupValues[2].trim())
            }
        return out
    }

    private fun parseManifest(opf: String): Map<String, String> {
        val out = LinkedHashMap<String, String>()
        Regex("""<item\s+([^>]+)/>""").findAll(opf).forEach { m ->
            val attrs = m.groupValues[1]
            val id = Regex("""id="([^"]+)"""").find(attrs)?.groupValues?.get(1) ?: return@forEach
            val href = Regex("""href="([^"]+)"""").find(attrs)?.groupValues?.get(1) ?: return@forEach
            out[id] = href
        }
        return out
    }

    private fun parseSpine(opf: String): List<String> {
        return Regex("""<itemref\s+idref="([^"]+)"""")
            .findAll(opf)
            .map { it.groupValues[1] }
            .toList()
    }

    /** Mirrors desktop/src-tauri/src/import_epub.rs::html_to_text. */
    internal fun htmlToText(html: String): String {
        val out = StringBuilder(html.length)
        var inTag = false
        val tagBuf = StringBuilder()
        var skipUntil: String? = null
        for (ch in html) {
            if (skipUntil != null) {
                if (ch == '<') {
                    inTag = true
                    tagBuf.clear()
                } else if (inTag) {
                    if (ch == '>') {
                        if (tagBuf.toString().equals(skipUntil, ignoreCase = true)) {
                            skipUntil = null
                        }
                        inTag = false
                        tagBuf.clear()
                    } else {
                        tagBuf.append(ch)
                    }
                }
                continue
            }
            when {
                ch == '<' -> { inTag = true; tagBuf.clear() }
                ch == '>' -> {
                    inTag = false
                    val lower = tagBuf.toString().lowercase()
                    val name = lower.trimStart('/').substringBefore(' ').substringBefore('\t')
                    when (name) {
                        "script" -> skipUntil = "/script"
                        "style" -> skipUntil = "/style"
                        "br", "/p", "/div", "/h1", "/h2", "/h3", "/h4", "/li" -> out.append('\n')
                        "p", "div", "h1", "h2", "h3", "h4" -> if (!out.endsWith('\n')) out.append('\n')
                    }
                    tagBuf.clear()
                }
                inTag -> tagBuf.append(ch)
                else -> out.append(ch)
            }
        }
        var s = out.toString()
            .replace("&nbsp;", " ")
            .replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&#39;", "'")
            .replace("&apos;", "'")
        // Collapse 3+ blank lines into 2.
        val collapsed = StringBuilder(s.length)
        var run = 0
        for (ch in s) {
            if (ch == '\n') {
                run++
                if (run <= 2) collapsed.append(ch)
            } else {
                run = 0
                collapsed.append(ch)
            }
        }
        return collapsed.toString().trim()
    }
}
