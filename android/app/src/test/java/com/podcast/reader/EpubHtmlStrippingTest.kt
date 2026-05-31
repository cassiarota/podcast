package com.podcast.reader.importer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class EpubHtmlStrippingTest {
    @Test fun stripsTags() {
        val plain = EpubImporter.htmlToText("<p>Hello <b>world</b>!</p>")
        assertEquals("Hello world!", plain)
    }

    @Test fun removesScriptAndStyleBlocks() {
        val html = "<p>Before</p><script>alert('x')</script><style>p{color:red}</style><p>After</p>"
        val plain = EpubImporter.htmlToText(html)
        assertFalse(plain.contains("alert"))
        assertFalse(plain.contains("color:red"))
        assertTrue(plain.contains("Before"))
        assertTrue(plain.contains("After"))
    }

    @Test fun decodesCommonEntities() {
        val plain = EpubImporter.htmlToText("<p>Tom&nbsp;&amp;&nbsp;Jerry &lt;3 &quot;tag&quot;</p>")
        assertTrue(plain.contains("Tom & Jerry"))
        assertTrue(plain.contains("<3"))
        assertTrue(plain.contains("\"tag\""))
    }

    @Test fun collapsesBlankLines() {
        val plain = EpubImporter.htmlToText("<p>One</p><p></p><p></p><p></p><p>Two</p>")
        assertFalse(plain.contains("\n\n\n"))
        assertTrue(plain.contains("One"))
        assertTrue(plain.contains("Two"))
    }
}
