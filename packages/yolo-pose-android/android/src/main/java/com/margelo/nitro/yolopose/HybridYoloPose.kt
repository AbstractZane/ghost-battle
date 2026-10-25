package com.margelo.nitro.yolopose

import android.os.SystemClock
import androidx.annotation.Keep
import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OnnxJavaType
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import ai.onnxruntime.TensorInfo
import com.facebook.common.internal.DoNotStrip
import com.margelo.nitro.NitroModules
import com.margelo.nitro.camera.HybridFrameSpec
import com.margelo.nitro.camera.PixelFormat
import com.margelo.nitro.camera.public.NativeFrame
import org.json.JSONArray
import org.json.JSONObject
import java.nio.FloatBuffer
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.exp
import kotlin.math.min

/** Android-only local lab. Camera images are copied into memory, never persisted or logged. */
@DoNotStrip
@Keep
class HybridYoloPose : HybridYoloPoseSpec() {
  private val worker = Executors.newSingleThreadExecutor { task ->
    Thread(task, "PushPVP-YoloPose").apply { priority = Thread.NORM_PRIORITY - 1 }
  }
  private val pending = AtomicBoolean(false)
  private val generation = AtomicInteger(0)
  private val completed = AtomicReference<String?>(null)
  @Volatile private var state = "idle"
  private var environment: OrtEnvironment? = null
  private var session: OrtSession? = null

  override fun start(): String {
    if (state == "ready" || state == "loading") return state
    state = "loading"
    val current = generation.incrementAndGet()
    worker.execute {
      try {
        val context = NitroModules.applicationContext ?: error("Android context unavailable")
        val bytes = context.assets.open("yoloxpose_tiny_416_raw.onnx").use { it.readBytes() }
        val env = OrtEnvironment.getEnvironment()
        val options = OrtSession.SessionOptions().apply { setIntraOpNumThreads(2) }
        val opened = options.use { env.createSession(bytes, it) }
        val input = opened.inputInfo["bgr_image"]?.info as? TensorInfo
        val output = opened.outputInfo["raw_predictions"]?.info as? TensorInfo
        if (input?.shape?.contentEquals(longArrayOf(1, 3, 416, 416)) != true ||
          output?.shape?.contentEquals(longArrayOf(1, 3549, 57)) != true ||
          input.type != OnnxJavaType.FLOAT || output.type != OnnxJavaType.FLOAT) {
          opened.close()
          error("YOLO ONNX tensor shape mismatch")
        }
        if (generation.get() != current) {
          opened.close()
          return@execute
        }
        environment = env
        session = opened
        state = "ready"
        completed.set(JSONObject().put("state", "ready").toString())
      } catch (_: Exception) {
        if (generation.get() == current) {
          state = "error"
          completed.set(JSONObject().put("state", "error")
            .put("message", "YOLO model could not load; switch to MoveNet.").toString())
        }
      }
    }
    return state
  }

  override fun submit(frame: HybridFrameSpec): String? {
    val last = completed.getAndSet(null)
    if (state != "ready" || !pending.compareAndSet(false, true)) return last
    val native = frame as? NativeFrame
    if (native == null) {
      pending.set(false)
      return last
    }
    try {
      val image = native.image
      val plane = image.planes.singleOrNull() ?: error("Expected RGB camera frame")
      val source = plane.buffer.duplicate()
      source.rewind()
      val bytes = ByteArray(source.remaining())
      source.get(bytes)
      val width = image.width
      val height = image.height
      val rowStride = plane.rowStride
      val pixelStride = plane.pixelStride
      val isBgra = frame.pixelFormat == PixelFormat.RGB_BGRA_8_BIT
      val capturedAt = captureWallTime(image.imageInfo.timestamp)
      val isMirrored = frame.isMirrored
      val orientation = frame.orientation.toString().lowercase()
      val current = generation.get()
      worker.execute {
        try {
          if (generation.get() != current || state != "ready") return@execute
          val active = session ?: return@execute
          val env = environment ?: return@execute
          val started = SystemClock.elapsedRealtimeNanos()
          val scale = min(416.0 / width, 416.0 / height)
          val padX = (416.0 - width * scale) / 2.0
          val padY = (416.0 - height * scale) / 2.0
          val input = preprocess(bytes, width, height, rowStride, pixelStride, isBgra, scale, padX, padY)
          OnnxTensor.createTensor(env, FloatBuffer.wrap(input), longArrayOf(1, 3, 416, 416)).use { tensor ->
            active.run(mapOf("bgr_image" to tensor)).use { result ->
              val raw = (result[0] as OnnxTensor).floatBuffer
              val decoded = decode(raw, width, height, scale, padX, padY)
              val latency = (SystemClock.elapsedRealtimeNanos() - started) / 1_000_000.0
              if (generation.get() == current) {
                completed.set(JSONObject()
                  .put("state", "pose")
                  .put("capturedAt", capturedAt)
                  .put("sourceWidth", width)
                  .put("sourceHeight", height)
                  .put("inputMirrored", isMirrored)
                  .put("orientation", orientation)
                  .put("inferenceLatencyMs", latency)
                  .put("candidate", decoded).toString())
              }
            }
          }
        } catch (_: Exception) {
          if (generation.get() == current) {
            state = "error"
            completed.set(JSONObject().put("state", "error")
              .put("message", "YOLO inference failed; switch to MoveNet.").toString())
          }
        } finally {
          pending.set(false)
        }
      }
    } catch (_: Exception) {
      pending.set(false)
      state = "error"
      completed.set(JSONObject().put("state", "error")
        .put("message", "YOLO camera buffer unavailable; switch to MoveNet.").toString())
    }
    return last
  }

  override fun stop() {
    generation.incrementAndGet()
    state = "stopped"
    completed.set(null)
    worker.execute {
      session?.close()
      session = null
      environment = null
    }
    worker.shutdown()
  }

  private fun captureWallTime(capturedNs: Long): Long {
    val ageMs = (SystemClock.elapsedRealtimeNanos() - capturedNs) / 1_000_000
    return if (ageMs in 0..5_000) System.currentTimeMillis() - ageMs else System.currentTimeMillis()
  }

  private fun preprocess(
    source: ByteArray, width: Int, height: Int, rowStride: Int, pixelStride: Int,
    isBgra: Boolean, scale: Double, padX: Double, padY: Double,
  ): FloatArray {
    require(pixelStride >= 3 && rowStride > 0 && width > 0 && height > 0)
    val out = FloatArray(3 * 416 * 416)
    val area = 416 * 416
    for (y in 0 until 416) {
      val sy = (y - padY) / scale
      val y0 = kotlin.math.floor(sy).toInt()
      val fy = sy - y0
      for (x in 0 until 416) {
        val sx = (x - padX) / scale
        val x0 = kotlin.math.floor(sx).toInt()
        val fx = sx - x0
        val offset = y * 416 + x
        for (channel in 0..2) {
          val color = if (isBgra) channel else 2 - channel // MMPose BGR
          val a = sample(source, width, height, rowStride, pixelStride, x0, y0, color)
          val b = sample(source, width, height, rowStride, pixelStride, x0 + 1, y0, color)
          val c = sample(source, width, height, rowStride, pixelStride, x0, y0 + 1, color)
          val d = sample(source, width, height, rowStride, pixelStride, x0 + 1, y0 + 1, color)
          out[channel * area + offset] =
            ((a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy).toFloat()
        }
      }
    }
    return out
  }

  private fun sample(
    data: ByteArray, width: Int, height: Int, rowStride: Int, pixelStride: Int,
    x: Int, y: Int, channel: Int,
  ): Int {
    if (x !in 0 until width || y !in 0 until height) return 114
    val index = y * rowStride + x * pixelStride + channel
    return if (index in data.indices) data[index].toInt() and 0xff else 114
  }

  private fun decode(raw: FloatBuffer, width: Int, height: Int, scale: Double, padX: Double, padY: Double): JSONObject {
    require(raw.remaining() == 3549 * 57) { "Unexpected YOLO output size" }
    val levels = intArrayOf(52, 26, 13)
    var global = 0
    var bestScore = 0.0
    var bestIndex = -1
    var bestGridX = 0
    var bestGridY = 0
    var bestStride = 8
    for (level in levels.indices) {
      val side = levels[level]
      val stride = 8 shl level
      for (cell in 0 until side * side) {
        val score = sigmoid(raw.get(global * 57)) * sigmoid(raw.get(global * 57 + 1))
        if (score > bestScore) {
          bestScore = score
          bestIndex = global
          bestGridX = cell % side
          bestGridY = cell / side
          bestStride = stride
        }
        global++
      }
    }
    if (bestIndex < 0 || bestScore < 0.01) return JSONObject().put("score", 0.0)
    val base = bestIndex * 57
    val priorX = bestGridX * bestStride
    val priorY = bestGridY * bestStride
    val centerX = raw.get(base + 2) * bestStride + priorX
    val centerY = raw.get(base + 3) * bestStride + priorY
    val boxWidth = exp(raw.get(base + 4).toDouble().coerceIn(-10.0, 10.0)) * bestStride
    val boxHeight = exp(raw.get(base + 5).toDouble().coerceIn(-10.0, 10.0)) * bestStride
    val bestBounds = doubleArrayOf(centerX - boxWidth / 2, centerY - boxHeight / 2,
      centerX + boxWidth / 2, centerY + boxHeight / 2)
    var secondScore = 0.0
    global = 0
    for (level in levels.indices) {
      val side = levels[level]
      val stride = 8 shl level
      for (cell in 0 until side * side) {
        if (global != bestIndex) {
          val otherBase = global * 57
          val score = sigmoid(raw.get(otherBase)) * sigmoid(raw.get(otherBase + 1))
          if (score > secondScore && score >= 0.15) {
            val otherX = raw.get(otherBase + 2) * stride + cell % side * stride
            val otherY = raw.get(otherBase + 3) * stride + cell / side * stride
            val otherWidth = exp(raw.get(otherBase + 4).toDouble().coerceIn(-10.0, 10.0)) * stride
            val otherHeight = exp(raw.get(otherBase + 5).toDouble().coerceIn(-10.0, 10.0)) * stride
            val otherBounds = doubleArrayOf(otherX - otherWidth / 2, otherY - otherHeight / 2,
              otherX + otherWidth / 2, otherY + otherHeight / 2)
            if (iou(bestBounds, otherBounds) < 0.65) secondScore = score
          }
        }
        global++
      }
    }
    val bbox = JSONArray()
      .put(((centerX - boxWidth / 2 - padX) / scale / width).coerceIn(0.0, 1.0))
      .put(((centerY - boxHeight / 2 - padY) / scale / height).coerceIn(0.0, 1.0))
      .put(((centerX + boxWidth / 2 - padX) / scale / width).coerceIn(0.0, 1.0))
      .put(((centerY + boxHeight / 2 - padY) / scale / height).coerceIn(0.0, 1.0))
    val landmarks = JSONArray()
    for (joint in 0 until 17) {
      val x = (raw.get(base + 6 + joint * 2) * bestStride + priorX - padX) / scale / width
      val y = (raw.get(base + 7 + joint * 2) * bestStride + priorY - padY) / scale / height
      val confidence = sigmoid(raw.get(base + 40 + joint))
      landmarks.put(x.coerceIn(0.0, 1.0))
      landmarks.put(y.coerceIn(0.0, 1.0))
      landmarks.put(confidence)
    }
    return JSONObject()
      .put("score", bestScore)
      .put("secondScore", secondScore)
      .put("bbox", bbox)
      .put("landmarks", landmarks)
  }

  private fun sigmoid(value: Float): Double {
    val x = value.toDouble().coerceIn(-50.0, 50.0)
    return 1.0 / (1.0 + exp(-x))
  }

  private fun iou(a: DoubleArray, b: DoubleArray): Double {
    val w = (min(a[2], b[2]) - kotlin.math.max(a[0], b[0])).coerceAtLeast(0.0)
    val h = (min(a[3], b[3]) - kotlin.math.max(a[1], b[1])).coerceAtLeast(0.0)
    val intersection = w * h
    val areaA = (a[2] - a[0]).coerceAtLeast(0.0) * (a[3] - a[1]).coerceAtLeast(0.0)
    val areaB = (b[2] - b[0]).coerceAtLeast(0.0) * (b[3] - b[1]).coerceAtLeast(0.0)
    return if (areaA + areaB > intersection) intersection / (areaA + areaB - intersection) else 0.0
  }
}
