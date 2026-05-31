package com.podcast.reader.importer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TxtImporterTest {
    @Test fun importedTxtCreatesBookAndPages() {
        val text = "CHAPTER ONE\n\nThis is page text. ".repeat(120)
        val imported = TxtImporter.import(text.toByteArray(Charsets.UTF_8), "Demo", null)
        assertEquals("txt", imported.book.sourceFormat)
        assertEquals(imported.book.pageCount, imported.pages.size)
        assertTrue(imported.pages.isNotEmpty())
        assertTrue(imported.sections.isNotEmpty())
        assertEquals("CHAPTER ONE", imported.sections[0].title)
    }

    @Test fun untitledFileFallsBackOnDisplayName() {
        val imported = TxtImporter.import("plain text".toByteArray(), "MyFile", null)
        assertEquals("MyFile", imported.book.title)
    }

    @Test fun blankDisplayNameFallsBackToUntitled() {
        val imported = TxtImporter.import("plain text".toByteArray(), "", null)
        assertEquals("Untitled", imported.book.title)
    }
}
