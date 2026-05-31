package com.podcast.reader.tts

import java.io.File
import java.io.RandomAccessFile
import kotlin.math.PI
import kotlin.math.min
import kotlin.math.sin

/**
 * Stub engine — same approach as desktop/sidecar/engine_stub.py.
 * Generates a deterministic sine-wave envelope whose duration scales with
 * the input length. Used for development, demos, and as a fallback when the
 * Kokoro ONNX model isn't present.
 *
 * Output: 16-bit mono PCM WAV at 22050 Hz, stdlib only.
 */
class StubEngine : Engine {
    override val name: String = "stub"
    @Volatile private var loaded: Boolean = false
    override val isLoaded: Boolean get() = loaded

    override suspend fun load() { loaded = true }
    override suspend fun unload() { loaded = false }

    override suspend fun synthesize(
        text: String,
        outFile: File,
        voice: String,
        language: String,
        speed: Float,
    ): Long {
        if (!loaded) load()
        val msPerChar = 55
        val durationMs = (text.length * msPerChar / speed.coerceAtLeast(0.1f)).toInt().coerceAtLeast(400)
        val nSamples = (SAMPLE_RATE.toLong() * durationMs / 1000L).toInt()

        val baseFreq = 180.0 + (voice.hashCode().toLong() and 0xFFFFFFFFL).toInt() % 80
        val attack = (nSamples * 0.04).toInt().coerceAtLeast(1)
        val release = (nSamples * 0.06).toInt().coerceAtLeast(1)
        val pcm = ShortArray(nSamples)
        for (i in 0 until nSamples) {
            val t = i.toDouble() / SAMPLE_RATE
            val env = when {
                i < attack -> i.toDouble() / attack
                i > nSamples - release -> (nSamples - i).toDouble() / release
                else -> 1.0
            }
            val carrier = sin(2 * PI * baseFreq * t)
            val modulator = 0.35 * sin(2 * PI * 4.0 * t)
            val sample = env * (carrier + modulator * carrier) * 0.25
            val clamped = sample.coerceIn(-1.0, 1.0)
            pcm[i] = (clamped * 32767.0).toInt().toShort()
        }
        writeWav(outFile, pcm, SAMPLE_RATE)
        return durationMs.toLong()
    }

    companion object {
        const val SAMPLE_RATE = 22050

        /** Write a minimal RIFF/WAV file (16-bit signed PCM, mono). */
        fun writeWav(out: File, pcm: ShortArray, sampleRate: Int) {
            out.parentFile?.mkdirs()
            RandomAccessFile(out, "rw").use { raf ->
                raf.setLength(0)
                val byteRate = sampleRate * 2
                val dataSize = pcm.size * 2
                val riffSize = 36 + dataSize
                raf.writeBytes("RIFF")
                raf.writeLeInt(riffSize)
                raf.writeBytes("WAVEfmt ")
                raf.writeLeInt(16)            // fmt chunk size
                raf.writeLeShort(1)            // PCM
                raf.writeLeShort(1)            // mono
                raf.writeLeInt(sampleRate)
                raf.writeLeInt(byteRate)
                raf.writeLeShort(2)            // block align
                raf.writeLeShort(16)           // bits per sample
                raf.writeBytes("data")
                raf.writeLeInt(dataSize)
                val buf = java.nio.ByteBuffer.allocate(dataSize)
                    .order(java.nio.ByteOrder.LITTLE_ENDIAN)
                for (s in pcm) buf.putShort(s)
                raf.write(buf.array())
            }
        }

        private fun RandomAccessFile.writeLeInt(v: Int) {
            write(v and 0xFF)
            write((v shr 8) and 0xFF)
            write((v shr 16) and 0xFF)
            write((v shr 24) and 0xFF)
        }
        private fun RandomAccessFile.writeLeShort(v: Int) {
            write(v and 0xFF)
            write((v shr 8) and 0xFF)
        }
    }
}
