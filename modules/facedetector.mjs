/**
 * FaceDetector module for Medfon-talkingV1
 * Uses MediaPipe Face Landmarker to detect user's face position from webcam stream
 * and calculate lookAt coordinates (X, Y) for TalkingHead 3D Avatar.
 */

import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm";

export class FaceDetector {
  /**
   * @param {HTMLVideoElement} videoElement - Hidden video element to play webcam stream
   * @param {Object} options - Configuration options
   * @param {Function} [options.onDetect] - Callback(result) when face coordinates are updated
   * @param {number} [options.smoothing] - Smoothing factor (0 to 1, default 0.15)
   * @param {number} [options.timeoutMs] - Time in ms without face before resetting to center (default 1500)
   */
  constructor(videoElement, options = {}) {
    this.video = videoElement;
    this.onDetect = options.onDetect || null;
    this.smoothing = options.smoothing !== undefined ? options.smoothing : 0.15;
    this.timeoutMs = options.timeoutMs || 1500;

    this.faceLandmarker = null;
    this.stream = null;
    this.isTracking = false;
    this.lastVideoTime = -1;
    this.lastDetectedTime = 0;
    this.animFrameId = null;

    // Smoothed target positions (-1.0 to 1.0)
    this.currentX = 0;
    this.currentY = 0;
    this.targetX = 0;
    this.targetY = 0;
  }

  /**
   * Initialize MediaPipe FaceLandmarker WASM model
   */
  async init() {
    if (this.faceLandmarker) return;

    try {
      const filesetResolver = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
      );

      this.faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
          delegate: "GPU"
        },
        outputFaceBlendshapes: false,
        runningMode: "VIDEO",
        numFaces: 1
      });

      console.log("MediaPipe FaceLandmarker initialized successfully.");
    } catch (error) {
      console.error("Failed to initialize FaceLandmarker:", error);
      throw error;
    }
  }

  /**
   * Start webcam and face tracking loop
   */
  async start() {
    if (this.isTracking) return;

    await this.init();

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
        audio: false
      });

      this.video.srcObject = this.stream;
      await this.video.play();

      this.isTracking = true;
      this.lastVideoTime = -1;
      this.lastDetectedTime = Date.now();
      this.loop();
      console.log("FaceDetector webcam tracking started.");
    } catch (error) {
      console.error("Failed to access webcam:", error);
      this.stop();
      throw error;
    }
  }

  /**
   * Stop webcam and tracking loop
   */
  stop() {
    this.isTracking = false;

    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    if (this.video) {
      this.video.srcObject = null;
    }

    // Reset position to center
    this.targetX = 0;
    this.targetY = 0;
    this.currentX = 0;
    this.currentY = 0;

    if (this.onDetect) {
      this.onDetect({ found: false, x: 0, y: 0 });
    }

    console.log("FaceDetector tracking stopped.");
  }

  /**
   * Main detection loop
   */
  loop() {
    if (!this.isTracking) return;

    const now = Date.now();

    if (this.video.currentTime !== this.lastVideoTime && this.video.readyState >= 2) {
      this.lastVideoTime = this.video.currentTime;

      const results = this.faceLandmarker.detectForVideo(this.video, now);

      if (results && results.faceLandmarks && results.faceLandmarks.length > 0) {
        const landmarks = results.faceLandmarks[0];
        this.lastDetectedTime = now;

        // Landmark 1 is the nose tip
        const nose = landmarks[1];

        // Map webcam coordinates (0..1) to normalized coordinates (-1..1)
        // Webcam is mirrored horizontally, so (0.5 - nose.x) reverses direction
        const rawX = (0.5 - nose.x) * 2.5; // Scale multiplier for natural head rotation range
        const rawY = (0.5 - nose.y) * 2.0;

        // Clamp to [-1, 1]
        this.targetX = Math.max(-1, Math.min(1, rawX));
        this.targetY = Math.max(-1, Math.min(1, rawY));
      }
    }

    // Timeout check: If no face detected for timeoutMs, return to center
    if (now - this.lastDetectedTime > this.timeoutMs) {
      this.targetX = 0;
      this.targetY = 0;
    }

    // Smooth lerp movement
    this.currentX += (this.targetX - this.currentX) * this.smoothing;
    this.currentY += (this.targetY - this.currentY) * this.smoothing;

    if (this.onDetect) {
      const isFound = now - this.lastDetectedTime <= this.timeoutMs;
      this.onDetect({
        found: isFound,
        x: Number(this.currentX.toFixed(3)),
        y: Number(this.currentY.toFixed(3))
      });
    }

    this.animFrameId = requestAnimationFrame(() => this.loop());
  }
}
