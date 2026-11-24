import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  CanvasSource,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  VideoSampleSink,
  canEncodeVideo,
} from 'mediabunny';
import {
  buildRoiAlphaMap,
  getPaddedRoi,
  getVideoWatermarkBase,
  removeWatermarkExact,
  resolveWatermarkBox,
  type TunerParams,
} from './coreRemover';
import { loadReferenceMasks } from './referenceMasks';

export interface VideoPreviewFrame {
  width: number;
  height: number;
  duration: number;
  imageData: ImageData;
}

export interface VideoExportResult {
  blob: Blob;
  url: string;
  originalUrl: string;
  width: number;
  height: number;
  ext: string;
  mime: string;
  hasAudio: boolean;
  frameCount: number;
}

export function isWebCodecsVideoSupported(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoDecoder !== 'undefined';
}

function isFrameMeaningful(imageData: ImageData): boolean {
  const data = imageData.data;
  const len = data.length;
  const step = Math.max(4, Math.floor(len / 2000) * 4);
  let sum = 0;
  let sumSq = 0;
  let samples = 0;
  for (let i = 0; i < len; i += step) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    sum += lum;
    sumSq += lum * lum;
    samples++;
  }
  if (samples === 0) return false;
  const mean = sum / samples;
  const variance = sumSq / samples - mean * mean;
  return mean > 12 && mean < 245 && variance > 10;
}

/**
 * Extracts a crisp, non-black representative preview frame from an uploaded video
 * by probing timestamps at 35%, 50%, 20%, 65%, 10% (exact reference approach).
 */
export function grabBestVideoPreviewFrame(file: File): Promise<VideoPreviewFrame> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'auto';
    v.muted = true;
    v.playsInline = true;
    v.src = url;

    let cleanedUp = false;
    const cleanup = () => {
      if (!cleanedUp) {
        cleanedUp = true;
        URL.revokeObjectURL(url);
        v.removeAttribute('src');
        v.load();
      }
    };

    const globalTimeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('Hết thời gian chờ trích xuất khung hình xem trước.'));
    }, 12000);

    v.onerror = () => {
      window.clearTimeout(globalTimeout);
      cleanup();
      reject(new Error('Không thể đọc file video này.'));
    };

    const onReady = async () => {
      v.onloadedmetadata = null;
      v.onloadeddata = null;

      const duration = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 1;
      const ratios = [0.35, 0.5, 0.2, 0.65, 0.1];
      const timestamps = ratios.map((r) =>
        Math.min(Math.max(duration * r, 0.05), Math.max(0.05, duration - 0.05))
      );

      const w = v.videoWidth || 1280;
      const h = v.videoHeight || 720;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const cx = c.getContext('2d', { willReadFrequently: true })!;

      let bestFrame: ImageData | null = null;
      let highestVariance = -1;

      const seekAndCapture = (time: number): Promise<ImageData | null> =>
        new Promise((res) => {
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            window.clearTimeout(seekTimer);
            v.removeEventListener('seeked', onSeeked);
            try {
              cx.drawImage(v, 0, 0, w, h);
              res(cx.getImageData(0, 0, w, h));
            } catch {
              res(null);
            }
          };
          const onSeeked = () => window.setTimeout(finish, 25);
          const seekTimer = window.setTimeout(finish, 1400);
          v.addEventListener('seeked', onSeeked, { once: true });
          try {
            if (Math.abs(v.currentTime - time) < 0.01) {
              finish();
            } else {
              v.currentTime = time;
            }
          } catch {
            finish();
          }
        });

      for (const t of timestamps) {
        const frame = await seekAndCapture(t);
        if (!frame) continue;
        if (isFrameMeaningful(frame)) {
          window.clearTimeout(globalTimeout);
          cleanup();
          resolve({ width: w, height: h, duration, imageData: frame });
          return;
        }
        const data = frame.data;
        let sum = 0;
        let sumSq = 0;
        let samples = 0;
        const step = Math.max(4, Math.floor(data.length / 1000) * 4);
        for (let i = 0; i < data.length; i += step) {
          const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          sum += lum;
          sumSq += lum * lum;
          samples++;
        }
        const mean = sum / (samples || 1);
        const variance = sumSq / (samples || 1) - mean * mean;
        if (variance > highestVariance) {
          highestVariance = variance;
          bestFrame = frame;
        }
      }

      window.clearTimeout(globalTimeout);
      cleanup();
      if (bestFrame) {
        resolve({ width: w, height: h, duration, imageData: bestFrame });
      } else {
        reject(new Error('Không thể trích xuất khung hình từ video này.'));
      }
    };

    if (v.readyState >= 1) {
      void onReady();
    } else {
      v.onloadedmetadata = () => void onReady();
      v.onloadeddata = () => void onReady();
    }
  });
}

/**
 * High-speed local WebCodecs + MediaBunny MP4 video watermark remover with
 * exact Reverse Alpha Blending and 100% original audio track passthrough!
 */
export async function exportCleanedVideoMp4(
  file: File,
  tuner: TunerParams,
  onProgress: (pct: number, framesProcessed: number, phase: string) => void,
  abortSignal?: AbortSignal
): Promise<VideoExportResult> {
  if (!isWebCodecsVideoSupported()) {
    throw new Error(
      'Trình duyệt của bạn không hỗ trợ WebCodecs VideoEncoder. Vui lòng dùng Chrome hoặc Edge trên máy tính.'
    );
  }

  if (typeof canEncodeVideo === 'function' && !(await canEncodeVideo('avc'))) {
    throw new Error(
      'Trình duyệt không hỗ trợ mã hóa H.264/AVC cục bộ. Hãy thử Chrome hoặc Edge desktop.'
    );
  }

  const { bg96 } = await loadReferenceMasks();
  const originalUrl = URL.createObjectURL(file);
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });

  const videoTrack = await input.getPrimaryVideoTrack();
  if (!videoTrack) {
    input.dispose?.();
    URL.revokeObjectURL(originalUrl);
    throw new Error('Không tìm thấy luồng video hợp lệ trong file.');
  }

  const width = videoTrack.displayWidth ?? videoTrack.codedWidth;
  const height = videoTrack.displayHeight ?? videoTrack.codedHeight;
  const duration = await input.computeDuration().catch(() => 0);

  let frameRate = 30;
  try {
    const stats = await videoTrack.computePacketStats(120);
    if (stats?.averagePacketRate) frameRate = Math.round(stats.averagePacketRate);
  } catch {
    // Keep 30fps default
  }

  const base = getVideoWatermarkBase(width, height);
  const wm = resolveWatermarkBox(base, width, height, tuner);
  const roi = getPaddedRoi(width, height, wm);
  const alpha = buildRoiAlphaMap(bg96, roi, wm, tuner.gain);
  const region = { x: 0, y: 0, width: roi.width, height: roi.height };

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat(), target });
  const videoSource = new CanvasSource(canvas, {
    codec: 'avc',
    bitrate: QUALITY_HIGH,
    keyFrameInterval: 2,
    sizeChangeBehavior: 'passThrough',
  });
  output.addVideoTrack(videoSource, { frameRate });

  // Original Audio Passthrough (exact untouched audio packets!)
  let audioSource: EncodedAudioPacketSource | null = null;
  let audioTrack: Awaited<ReturnType<typeof input.getPrimaryAudioTrack>> = null;
  let audioDecoderConfig: AudioDecoderConfig | null = null;
  let hasAudio = false;

  try {
    audioTrack = await input.getPrimaryAudioTrack();
    if (audioTrack) {
      const audioCodec = await audioTrack.getCodec();
      audioDecoderConfig = await audioTrack.getDecoderConfig().catch(() => null);
      if (audioCodec && audioDecoderConfig) {
        audioSource = new EncodedAudioPacketSource(audioCodec);
        output.addAudioTrack(audioSource);
        hasAudio = true;
      }
    }
  } catch {
    audioSource = null;
    hasAudio = false;
  }

  await output.start();
  onProgress(1, 0, 'Đang giải mã & khử logo từng khung hình (WebCodecs)...');

  const fallbackDur = frameRate > 0 ? 1 / frameRate : 1 / 30;
  const sink = new VideoSampleSink(videoTrack);
  let firstTimestamp: number | null = null;
  let lastTimestamp = -1;
  let frameCount = 0;

  try {
    for await (const sample of sink.samples()) {
      if (abortSignal?.aborted) {
        sample.close();
        throw new Error('Đã hủy xuất video.');
      }

      if (firstTimestamp === null) firstTimestamp = sample.timestamp;
      let timestamp = sample.timestamp - firstTimestamp;
      if (!(timestamp >= 0)) timestamp = 0;
      if (timestamp <= lastTimestamp) timestamp = lastTimestamp + fallbackDur;
      const dur =
        Number.isFinite(sample.duration) && sample.duration > 0 ? sample.duration : fallbackDur;
      lastTimestamp = timestamp;

      sample.draw(ctx, 0, 0, width, height);
      sample.close();

      // Exact ROI-only Reverse Alpha Subtraction (ultra fast!)
      const px = ctx.getImageData(roi.x, roi.y, roi.width, roi.height);
      removeWatermarkExact(px, alpha, region);

      // Force GPU texture sync for WebCodecs via ImageBitmap
      const bmp = await createImageBitmap(px);
      ctx.drawImage(bmp, roi.x, roi.y);
      bmp.close();

      await videoSource.add(timestamp, dur);
      frameCount++;

      if (duration > 0) {
        const pct = Math.min(96, Math.round((timestamp / duration) * 96));
        onProgress(pct, frameCount, 'Đang khử watermark & mã hóa H.264 MP4...');
      }
    }
  } catch (err) {
    videoSource.close();
    audioSource?.close();
    input.dispose?.();
    URL.revokeObjectURL(originalUrl);
    throw err;
  }

  videoSource.close();

  if (audioSource && audioTrack) {
    onProgress(97, frameCount, 'Đang ghép giữ nguyên âm thanh gốc...');
    try {
      const offset = firstTimestamp ?? 0;
      const aSink = new EncodedPacketSink(audioTrack);
      let isFirstAudio = true;
      let lastAudioTs = -1;
      for await (const packet of aSink.packets()) {
        let newTs = packet.timestamp - offset;
        if (newTs < 0) continue;
        if (newTs <= lastAudioTs) newTs = lastAudioTs + 1e-6;
        lastAudioTs = newTs;
        let outPacket = packet;
        if (newTs !== packet.timestamp && typeof packet.clone === 'function') {
          outPacket = packet.clone({ timestamp: newTs });
        }
        await audioSource.add(
          outPacket,
          isFirstAudio && audioDecoderConfig ? { decoderConfig: audioDecoderConfig } : undefined
        );
        isFirstAudio = false;
      }
    } catch (e) {
      console.warn('Audio passthrough skipped:', e);
    } finally {
      audioSource.close();
    }
  }

  onProgress(99, frameCount, 'Đang đóng gói file MP4...');
  await output.finalize();
  input.dispose?.();

  if (!target.buffer) {
    URL.revokeObjectURL(originalUrl);
    throw new Error('Không tạo được dữ liệu video đầu ra.');
  }

  const blob = new Blob([target.buffer], { type: 'video/mp4' });
  onProgress(100, frameCount, 'Hoàn tất!');

  return {
    blob,
    url: URL.createObjectURL(blob),
    originalUrl,
    width,
    height,
    ext: 'mp4',
    mime: 'video/mp4',
    hasAudio,
    frameCount,
  };
}
