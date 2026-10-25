package com.pushforge.app

import android.graphics.ImageFormat
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.Image
import com.facebook.react.bridge.*
import com.facebook.react.ReactPackage
import com.facebook.react.uimanager.ViewManager
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.math.max

/** Explicitly selected, app-owned video only. No camera buffers or image files leave this worker. */
class GhostVideoAnalysisModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "GhostVideoAnalysis"
  private class Job(val id: String) {
    @Volatile var cancelled = false
    @Volatile var state = "running"
    @Volatile var error: String? = null
    @Volatile var progress = 0.0
    @Volatile var aspectRatio = 1.0
    val samples = ArrayBlockingQueue<String>(8)
  }
  private val worker = Executors.newSingleThreadExecutor()
  @Volatile private var job: Job? = null

  @ReactMethod fun start(uri: String, durationMs: Double, promise: Promise) {
    try {
      require(durationMs.isFinite() && durationMs in 1000.0..300000.0)
      require(uri.startsWith("file://"))
      val file = File(android.net.Uri.parse(uri).path ?: "").canonicalFile
      require(file.isFile && file.path.startsWith(context.filesDir.canonicalPath + File.separator))
      job?.cancelled = true
      val next = Job(UUID.randomUUID().toString()); job = next
      worker.execute { analyze(next, file, durationMs.toLong()) }
      promise.resolve(next.id)
    } catch (_: Exception) { promise.reject("VIDEO_INPUT", "Choose an imported video up to 5 minutes.") }
  }
  @ReactMethod fun cancel(id: String) { job?.takeIf { it.id == id }?.let { it.cancelled = true; it.samples.clear() } }
  @ReactMethod fun poll(id: String, promise: Promise) {
    val current = job
    if (current == null || current.id != id) { promise.reject("VIDEO_JOB", "Analysis is no longer available."); return }
    val samples = JSONArray()
    repeat(4) { current.samples.poll()?.let { samples.put(it) } }
    val state = if (current.cancelled) "cancelled" else if (current.state == "complete" && current.samples.isNotEmpty()) "running" else current.state
    promise.resolve(JSONObject().put("state", state).put("samples", samples)
      .put("progress", current.progress).put("aspectRatio", current.aspectRatio)
      .put("error", current.error).toString())
  }
  private fun analyze(job: Job, file: File, durationMs: Long) {
    val extractor = MediaExtractor()
    var codec: MediaCodec? = null
    var inference: GhostPoseInference? = null
    try {
      extractor.setDataSource(file.path)
      val track = (0 until extractor.trackCount).firstOrNull {
        extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("video/") == true
      } ?: error("No video track")
      extractor.selectTrack(track)
      val format = extractor.getTrackFormat(track)
      val declaredDuration = if (format.containsKey(MediaFormat.KEY_DURATION)) format.getLong(MediaFormat.KEY_DURATION) / 1000 else durationMs
      require(kotlin.math.abs(declaredDuration - durationMs) <= 1000) { "Video duration changed" }
      val rotation = if (format.containsKey(MediaFormat.KEY_ROTATION)) format.getInteger(MediaFormat.KEY_ROTATION) else 0
      format.setInteger(MediaFormat.KEY_ROTATION, 0)
      format.setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible)
      codec = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!)
      codec.configure(format, null, null, 0); codec.start()
      inference = GhostPoseInference(context)
      val info = MediaCodec.BufferInfo()
      var inputEnded = false; var outputEnded = false; var nextSampleUs = 0L; var lastAt = -1L
      var lastProgressNs = System.nanoTime()
      while (!outputEnded && !job.cancelled) {
        if (!inputEnded) {
          val index = codec.dequeueInputBuffer(10000)
          if (index >= 0) {
            val buffer = codec.getInputBuffer(index) ?: error("No decoder input")
            val size = extractor.readSampleData(buffer, 0)
            if (size < 0) { codec.queueInputBuffer(index, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM); inputEnded = true }
            else { codec.queueInputBuffer(index, 0, size, extractor.sampleTime, 0); extractor.advance() }
          }
        }
        val index = codec.dequeueOutputBuffer(info, 10000)
        if (index >= 0) {
          lastProgressNs = System.nanoTime()
          try {
            val at = info.presentationTimeUs / 1000
            if (info.size > 0 && info.presentationTimeUs >= nextSampleUs && at > lastAt && at <= durationMs) {
              val image = codec.getOutputImage(index) ?: error("Video decoder cannot expose frames; use manual markers")
              image.use {
                require(image.format == ImageFormat.YUV_420_888) { "Unsupported decoded image format" }
                val width = image.cropRect.width(); val height = image.cropRect.height()
                job.aspectRatio = if (rotation % 180 == 0) width.toDouble() / height else height.toDouble() / width
                val sample = inference.estimate(image, rotation, at + 1)
                while (!job.cancelled && !job.samples.offer(sample, 100, TimeUnit.MILLISECONDS)) { /* Bounded backpressure. */ }
              }
              nextSampleUs = info.presentationTimeUs + 66666
              lastAt = at; job.progress = (at.toDouble() / durationMs).coerceIn(0.0, 1.0)
            }
            outputEnded = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
          } finally { codec.releaseOutputBuffer(index, false) }
        } else if (System.nanoTime() - lastProgressNs > 20_000_000_000L) error("Video decoding stalled")
      }
      if (!job.cancelled) {
        require(lastAt >= max(0L, durationMs - 1500)) { "Video ended before its declared duration" }
        job.progress = 1.0; job.state = "complete"
      }
    } catch (_: Exception) {
      if (!job.cancelled) {
        job.error = "This video could not be analyzed. Try another MP4 or mark reps manually."
        job.state = "error"
      }
    } finally {
      try { codec?.stop() } catch (_: Exception) {}
      codec?.release(); extractor.release(); inference?.close()
    }
  }
  override fun invalidate() { job?.cancelled = true; worker.shutdown(); super.invalidate() }
}
class GhostVideoPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(GhostVideoAnalysisModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
