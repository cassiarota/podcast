package com.podcast.reader.ui.reader

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.podcast.reader.data.ReaderSettings
import com.podcast.reader.ui.theme.presetById
import com.podcast.reader.viewmodel.ReaderViewModel
import kotlinx.coroutines.delay

private const val AUTO_HIDE_MS = 2200L

@Composable
fun ReaderScreen(
    readerVm: ReaderViewModel,
    settings: ReaderSettings,
    onUpdateSettings: (ReaderSettings.() -> ReaderSettings) -> Unit,
) {
    val state by readerVm.state.collectAsState()
    val preset = presetById(settings.background)
    val context = LocalContext.current

    // Auto-hide controls after inactivity.
    LaunchedEffect(state.controlsVisible, state.pageIndex) {
        if (state.controlsVisible) {
            delay(AUTO_HIDE_MS)
            readerVm.hideControls()
        }
    }

    // TTS playback when ttsPath updates.
    LaunchedEffect(state.ttsPath) {
        val path = state.ttsPath ?: return@LaunchedEffect
        playWav(context, path)
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(preset.bg)
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 24.dp, vertical = 56.dp)
        ) {
            val fontSize = when (settings.fontSize) {
                "small" -> 16.sp
                "large" -> 22.sp
                else -> 19.sp
            }
            Text(
                text = state.currentPage?.content ?: "",
                color = preset.fg,
                fontSize = fontSize,
                fontFamily = FontFamily.Serif,
                lineHeight = fontSize * 1.7,
                modifier = Modifier.verticalScroll(rememberScrollState()),
            )
        }

        // Tap regions (left 1/3 prev, center toggles controls, right 1/3 next).
        val density = LocalDensity.current
        Box(
            modifier = Modifier
                .fillMaxSize()
                .pointerInput(Unit) {
                    detectTapGestures { (x, _) ->
                        val third = size.width / 3f
                        when {
                            x < third -> readerVm.prev()
                            x > 2 * third -> readerVm.next()
                            else -> readerVm.toggleControls()
                        }
                    }
                }
        )

        // Bottom progress badge (always visible).
        Box(
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(16.dp)
                .background(Color(0x66000000))
                .padding(horizontal = 8.dp, vertical = 4.dp),
        ) {
            val percent = if (state.pageCount > 0)
                ((state.pageIndex + 1) * 100 / state.pageCount) else 0
            Text("$percent%", color = Color.White, fontSize = 12.sp)
        }

        AnimatedVisibility(
            visible = state.controlsVisible,
            enter = slideInVertically { it },
            exit = slideOutVertically { it },
            modifier = Modifier.align(Alignment.BottomCenter),
        ) {
            ReaderControls(
                state = state,
                settings = settings,
                onClose = readerVm::close,
                onTocClick = { readerVm.setTocOpen(true) },
                onPlay = { readerVm.play() },
                onUpdateSettings = onUpdateSettings,
            )
        }

        if (state.tocOpen) {
            TocPanel(
                sections = state.sections,
                onPick = { readerVm.jumpToSection(it) },
                onDismiss = { readerVm.setTocOpen(false) },
            )
        }

        if (state.ttsError != null) {
            androidx.compose.material3.AlertDialog(
                onDismissRequest = readerVm::clearTtsError,
                confirmButton = { androidx.compose.material3.TextButton(onClick = readerVm::clearTtsError) { Text("好") } },
                title = { Text("音频生成失败") },
                text = { Text(state.ttsError ?: "") },
            )
        }
    }
}

private fun playWav(context: android.content.Context, path: String) {
    runCatching {
        val mp = android.media.MediaPlayer().apply {
            setDataSource(path)
            setOnPreparedListener { it.start() }
            setOnCompletionListener { it.release() }
            prepareAsync()
        }
        mp
    }
}
