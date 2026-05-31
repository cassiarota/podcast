package com.podcast.reader.ui.library

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.podcast.reader.data.entity.BookEntity
import com.podcast.reader.viewmodel.LibraryViewModel

@Composable
fun LibraryScreen(
    libraryVm: LibraryViewModel,
    onOpenBook: (String) -> Unit,
) {
    val books by libraryVm.books.collectAsState()
    val error by libraryVm.error.collectAsState()
    val context = LocalContext.current

    val pickFile = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        val resolver = context.contentResolver
        val name = uri.lastPathSegment?.substringAfterLast('/') ?: "imported"
        val bytes = runCatching {
            resolver.openInputStream(uri)?.use { it.readBytes() }
        }.getOrNull() ?: return@rememberLauncherForActivityResult
        val displayName = name.substringBeforeLast('.', missingDelimiterValue = name)
        if (name.endsWith(".epub", ignoreCase = true)) {
            libraryVm.importEpub(bytes, displayName)
        } else {
            libraryVm.importTxt(bytes, displayName)
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(listOf(Color(0xFF3A2A1A), Color(0xFF2A1F12)))
            )
    ) {
        Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
            Text(
                "书架",
                fontSize = 24.sp,
                fontWeight = FontWeight.SemiBold,
                color = Color(0xFFF5E6D3),
                modifier = Modifier.padding(bottom = 12.dp),
            )
            if (books.isEmpty()) {
                Box(modifier = Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                    Text(
                        "书架空空如也。点击下方导入按钮开始阅读。",
                        color = Color(0xFFE0D5C0),
                    )
                }
            } else {
                LazyVerticalGrid(
                    columns = GridCells.Adaptive(minSize = 110.dp),
                    modifier = Modifier.weight(1f).fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    items(books, key = { it.id }) { book -> BookSpine(book, onOpenBook) }
                }
            }
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 12.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(Color(0x33000000))
                    .clickable { pickFile.launch(arrayOf("text/plain", "application/epub+zip", "*/*")) }
                    .padding(vertical = 16.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text("＋ 导入书籍", color = Color(0xFFF5E6D3))
            }
        }
        if (error != null) {
            AlertDialog(
                onDismissRequest = libraryVm::clearError,
                confirmButton = { TextButton(onClick = libraryVm::clearError) { Text("好") } },
                title = { Text("导入失败") },
                text = { Text(error ?: "") },
            )
        }
    }
}

@Composable
private fun BookSpine(book: BookEntity, onOpen: (String) -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .height(180.dp)
            .clip(RoundedCornerShape(4.dp))
            .background(
                Brush.linearGradient(listOf(Color(0xFF6B4423), Color(0xFF8B5A2B)))
            )
            .clickable { onOpen(book.id) }
            .padding(12.dp),
        verticalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(
            book.title,
            color = Color(0xFFF5E6D3),
            fontWeight = FontWeight.SemiBold,
            fontSize = 14.sp,
            maxLines = 4,
        )
        book.author?.let {
            Text(it, color = Color(0xCCF5E6D3), fontSize = 12.sp, maxLines = 1)
        }
    }
}
