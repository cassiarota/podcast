package com.podcast.reader.importer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HeadingDetectionTest {
    @Test fun chineseChapterMarkersAreHeadings() {
        assertTrue(TxtImporter.isHeadingLine("第1章 师傅"))
        assertTrue(TxtImporter.isHeadingLine("第999章 福生天"))
        assertTrue(TxtImporter.isHeadingLine("第三卷"))
        assertTrue(TxtImporter.isHeadingLine("第二节 修炼"))
    }

    @Test fun commonChineseSectionTokensAreHeadings() {
        assertTrue(TxtImporter.isHeadingLine("序章"))
        assertTrue(TxtImporter.isHeadingLine("楔子"))
        assertTrue(TxtImporter.isHeadingLine("尾声"))
        assertTrue(TxtImporter.isHeadingLine("正文卷"))
    }

    @Test fun chineseNarrativeAndDialogueAreNotHeadings() {
        // These would all be wrongly flagged by the original "no lowercase" check.
        assertFalse(TxtImporter.isHeadingLine("“啊！”一声女人的惊恐尖叫。"))
        assertFalse(TxtImporter.isHeadingLine("他无视嘈杂，继续干活。"))
        assertFalse(TxtImporter.isHeadingLine("“俺就弄一下。”"))
        assertFalse(TxtImporter.isHeadingLine("------------"))
    }

    @Test fun englishChapterMarkersAreHeadings() {
        assertTrue(TxtImporter.isHeadingLine("Chapter 1"))
        assertTrue(TxtImporter.isHeadingLine("CHAPTER ONE"))
        assertTrue(TxtImporter.isHeadingLine("Part Two"))
        assertTrue(TxtImporter.isHeadingLine("PROLOGUE"))
        assertTrue(TxtImporter.isHeadingLine("INTRODUCTION"))
    }

    @Test fun lowercaseAsciiTextIsNotAHeading() {
        assertFalse(TxtImporter.isHeadingLine("just some plain prose"))
        assertFalse(TxtImporter.isHeadingLine("a"))
    }

    @Test fun tooLongLinesAreNotHeadings() {
        val long = "第1章 ".repeat(40)  // > 80 bytes
        assertFalse(TxtImporter.isHeadingLine(long))
    }
}
