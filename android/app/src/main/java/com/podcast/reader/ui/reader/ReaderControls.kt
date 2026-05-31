package com.podcast.reader.ui.reader

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.podcast.reader.data.ReaderSettings
import com.podcast.reader.data.entity.SectionEntity
import com.podcast.reader.ui.theme.BackgroundPresets
import com.podcast.reader.viewmodel.ReaderUiState

@Composable
fun ReaderControls(
    state: ReaderUiState,
    settings: ReaderSettings,
    onClose: () -> Unit,
    onTocClick: () -> Unit,
    onPlay: () -> Unit,
    onUpdateSettings: ((ReaderSettings) -> ReaderSettings) -> Unit,
) {
    Surface(
        color = Color(0xEE141414),
        contentColor = Color.White,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
            ) {
                TextButton(onClick = onClose) { Text("← 书架") }
                TextButton(onClick = onTocClick) { Text("目录") }

                FontSizeRow(settings, onUpdateSettings)
                Spacer(modifier = Modifier.width(8.dp))
                ThemeRow(settings, onUpdateSettings)
                Spacer(modifier = Modifier.width(8.dp))
                BrightnessSlider(settings, onUpdateSettings)
                Spacer(modifier = Modifier.weight(1f, fill = false))
                Button(onClick = onPlay, enabled = !state.ttsBusy) {
                    Text(if (state.ttsBusy) "…" else "▶ 播放")
                }
            }
        }
    }
}

@Composable
private fun FontSizeRow(settings: ReaderSettings, update: ((ReaderSettings) -> ReaderSettings) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text("字号", fontSize = 12.sp, color = Color.White)
        Spacer(modifier = Modifier.width(4.dp))
        listOf("small" to "S", "medium" to "M", "large" to "L").forEach { (id, label) ->
            val selected = settings.fontSize == id
            Box(
                modifier = Modifier
                    .padding(horizontal = 2.dp)
                    .background(if (selected) Color(0xFF555555) else Color(0xFF333333))
                    .clickable { update { copy(fontSize = id) } }
                    .padding(horizontal = 8.dp, vertical = 4.dp),
            ) { Text(label, fontSize = 12.sp, color = Color.White) }
        }
    }
}

@Composable
private fun ThemeRow(settings: ReaderSettings, update: ((ReaderSettings) -> ReaderSettings) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text("主题", fontSize = 12.sp, color = Color.White)
        Spacer(modifier = Modifier.width(4.dp))
        BackgroundPresets.forEach { p ->
            val selected = settings.background == p.id
            Box(
                modifier = Modifier
                    .padding(horizontal = 2.dp)
                    .size(20.dp)
                    .background(p.bg)
                    .clickable { update { copy(background = p.id) } }
            ) {
                if (selected) {
                    Box(
                        modifier = Modifier.matchParentSize().background(Color(0x55FFFFFF))
                    )
                }
            }
        }
    }
}

@Composable
private fun BrightnessSlider(settings: ReaderSettings, update: ((ReaderSettings) -> ReaderSettings) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text("亮度", fontSize = 12.sp, color = Color.White)
        Spacer(modifier = Modifier.width(4.dp))
        Slider(
            value = settings.brightness.toFloat(),
            valueRange = 0.3f..1.0f,
            steps = 6,
            onValueChange = { v -> update { copy(brightness = v.toDouble()) } },
            modifier = Modifier.width(120.dp),
        )
    }
}

@Composable
fun TocPanel(sections: List<SectionEntity>, onPick: (String) -> Unit, onDismiss: () -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0x88000000))
            .clickable(onClick = onDismiss),
    ) {
        Surface(
            color = Color(0xF21E1E1E),
            contentColor = Color.White,
            modifier = Modifier
                .fillMaxHeight()
                .width(300.dp),
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text("目录", color = Color.White, fontSize = 18.sp)
                Spacer(modifier = Modifier.height(12.dp))
                LazyColumn {
                    items(sections, key = { it.id }) { s ->
                        Text(
                            text = s.title.ifBlank { "Section ${s.ord + 1}" },
                            color = Color(0xFFE0E0E0),
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { onPick(s.id) }
                                .padding(vertical = 10.dp),
                        )
                    }
                }
            }
        }
    }
}
