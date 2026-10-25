package com.pushforge.app

import android.content.Context
import android.media.Image
import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import org.json.JSONArray
import org.json.JSONObject
import java.nio.FloatBuffer
import kotlin.math.exp
import kotlin.math.min

/** Recorded-video inference. Decoder adapted from the credited PushPVP YOLO bridge. */
class GhostPoseInference(context: Context) : AutoCloseable {
  private val env = OrtEnvironment.getEnvironment()
  private val session: OrtSession
  init {
    val options = OrtSession.SessionOptions().apply { setIntraOpNumThreads(2) }
    session = options.use { env.createSession(context.assets.open("yoloxpose_tiny_416_raw.onnx").use { it.readBytes() }, it) }
  }
  fun estimate(image: Image, rotation: Int, atMs: Long): String {
    val crop = image.cropRect
    val rotated = rotation % 180 != 0
    val width = if (rotated) crop.height() else crop.width()
    val height = if (rotated) crop.width() else crop.height()
    val scale = min(416.0 / width, 416.0 / height)
    val padX = (416.0 - width * scale) / 2
    val padY = (416.0 - height * scale) / 2
    val input = FloatArray(3 * 416 * 416)
    val planes = image.planes
    fun rgb(x: Int, y: Int, channel: Int): Double {
      if (x !in 0 until width || y !in 0 until height) return 114.0
      val sourceX: Int
      val sourceY: Int
      when ((rotation % 360 + 360) % 360) {
        90 -> { sourceX = y; sourceY = crop.height() - 1 - x }
        180 -> { sourceX = crop.width() - 1 - x; sourceY = crop.height() - 1 - y }
        270 -> { sourceX = crop.width() - 1 - y; sourceY = x }
        else -> { sourceX = x; sourceY = y }
      }
      val sx = sourceX + crop.left; val sy = sourceY + crop.top
      fun value(p: Int, px: Int, py: Int): Int {
        val plane = planes[p]
        return plane.buffer.get(plane.buffer.position() + py * plane.rowStride + px * plane.pixelStride).toInt() and 255
      }
      val yy = 1.164 * (value(0, sx, sy) - 16).coerceAtLeast(0)
      val u = value(1, sx / 2, sy / 2) - 128
      val v = value(2, sx / 2, sy / 2) - 128
      return when (channel) { 0 -> yy + 2.018 * u; 1 -> yy - 0.391 * u - 0.813 * v; else -> yy + 1.596 * v }.coerceIn(0.0, 255.0)
    }
    for (y in 0 until 416) {
      val sy = (y - padY) / scale; val y0 = kotlin.math.floor(sy).toInt(); val fy = sy - y0
      for (x in 0 until 416) {
        val sx = (x - padX) / scale; val x0 = kotlin.math.floor(sx).toInt(); val fx = sx - x0
        for (c in 0..2) {
          input[c * 416 * 416 + y * 416 + x] =
            ((rgb(x0, y0, c) * (1 - fx) + rgb(x0 + 1, y0, c) * fx) * (1 - fy) +
              (rgb(x0, y0 + 1, c) * (1 - fx) + rgb(x0 + 1, y0 + 1, c) * fx) * fy).toFloat()
        }
      }
    }
    val candidate = OnnxTensor.createTensor(env, FloatBuffer.wrap(input), longArrayOf(1, 3, 416, 416)).use { tensor ->
      session.run(mapOf("bgr_image" to tensor)).use { result -> decode((result[0] as OnnxTensor).floatBuffer, width, height, scale, padX, padY) }
    }
    return JSONObject().put("state", "pose").put("capturedAt", atMs)
      .put("sourceWidth", width).put("sourceHeight", height).put("inputMirrored", false)
      .put("orientation", "up").put("inferenceLatencyMs", 0).put("candidate", candidate).toString()
  }
  override fun close() { session.close() }
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
