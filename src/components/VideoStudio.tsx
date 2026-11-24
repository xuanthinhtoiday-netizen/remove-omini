import {
  CheckCircle2,
  Download,
  Film,
  Focus,
  Loader2,
  RotateCcw,
  Scan,
  ShieldCheck,
  Sparkles,
  StopCircle,
  UploadCloud,
  Volume2,
  Wand2,
  Zap,
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import {
  cleanFrameExact,
  detectVideoWatermark,
  estimateOptimalGain,
  getAdaptiveVideoPreset,
  getVideoWatermarkBase,
  resolveWatermarkBox,
  type DetectionResult,
  type TunerParams,
  type VideoPresetKey,
  type WatermarkBox,
} from '../engine/coreRemover';
import {
  exportCleanedVideoMp4,
  grabBestVideoPreviewFrame,
  isWebCodecsVideoSupported,
  type VideoExportResult,
  type VideoPreviewFrame,
} from '../engine/mediabunnyVideo';
import { loadReferenceMasks } from '../engine/referenceMasks';

interface VideoStudioProps {
  onNotify: (msg: string) => void;
}

export const VideoStudio: React.FC<VideoStudioProps> = ({ onNotify }) => {
  const [file, setFile] = useState<File | null>(null);
  const [previewFrame, setPreviewFrame] = useState<VideoPreviewFrame | null>(null);
  const [baseBox, setBaseBox] = useState<WatermarkBox | null>(null);
  const [detection, setDetection] = useState<DetectionResult<VideoPresetKey> | null>(null);
  const [presetKey, setPresetKey] = useState<VideoPresetKey>('veo');
  const [tuner, setTuner] = useState<TunerParams>({
    gain: 0.6,
    offsetX: -24,
    offsetY: -24,
    sizeScale: 1.0,
  });

  const [isDragging, setIsDragging] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showGuideBox, setShowGuideBox] = useState(true);
  const [cleanedFrameUrl, setCleanedFrameUrl] = useState<string | null>(null);

  const [isExporting, setIsExporting] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [framesDone, setFramesDone] = useState(0);
  const [phaseLabel, setPhaseLabel] = useState('');
  const [exportResult, setExportResult] = useState<VideoExportResult | null>(null);

  const bg96Ref = useRef<HTMLImageElement | null>(null);
  const zoomOrigRef = useRef<HTMLCanvasElement | null>(null);
  const zoomCleanRef = useRef<HTMLCanvasElement | null>(null);
  const frameBoxRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; initOffX: number; initOffY: number } | null>(null);

  const handleVideoFile = async (selected: File) => {
    if (!selected.type.startsWith('video/')) {
      onNotify('Vui lòng chọn file video hợp lệ (MP4, WebM, MOV).');
      return;
    }

    if (exportResult) {
      URL.revokeObjectURL(exportResult.url);
      URL.revokeObjectURL(exportResult.originalUrl);
      setExportResult(null);
    }

    setIsAnalyzing(true);
    try {
      const [{ bg96 }, frame] = await Promise.all([
        loadReferenceMasks(),
        grabBestVideoPreviewFrame(selected),
      ]);
      bg96Ref.current = bg96;

      const base = getVideoWatermarkBase(frame.width, frame.height);
      const det = detectVideoWatermark(frame.imageData, frame.width, frame.height, bg96);

      setFile(selected);
      setPreviewFrame(frame);
      setBaseBox(base);
      setDetection(det);
      setPresetKey(det.presetKey);
      setTuner({
        gain: det.gain,
        offsetX: det.offsetX,
        offsetY: det.offsetY,
        sizeScale: det.sizeScale,
      });

      onNotify(
        det.matchFound
          ? `Đã tự động khóa logo Video: ${det.name} (${Math.round(det.score * 100)}% khớp)!`
          : `Đã trích xuất khung hình video — áp dụng preset Gemini Omni / Veo 3!`
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Không thể phân tích video này.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Live 60fps Preview Frame + Dual Zoomed Comparison Canvas!
  useEffect(() => {
    if (!previewFrame || !baseBox) return;
    let cancelled = false;

    const renderLive = async () => {
      if (!bg96Ref.current) {
        const { bg96 } = await loadReferenceMasks();
        bg96Ref.current = bg96;
      }
      if (cancelled || !bg96Ref.current) return;

      const { width, height, imageData } = previewFrame;
      const copy = new ImageData(new Uint8ClampedArray(imageData.data), width, height);
      const { wm, roi } = cleanFrameExact(bg96Ref.current, copy, width, height, baseBox, tuner);

      const cleanCanvas = document.createElement('canvas');
      cleanCanvas.width = width;
      cleanCanvas.height = height;
      cleanCanvas.getContext('2d')!.putImageData(copy, 0, 0);

      const origCanvas = document.createElement('canvas');
      origCanvas.width = width;
      origCanvas.height = height;
      origCanvas.getContext('2d')!.putImageData(imageData, 0, 0);

      setCleanedFrameUrl(cleanCanvas.toDataURL('image/png'));

      const zOrig = zoomOrigRef.current;
      if (zOrig) {
        const zctx = zOrig.getContext('2d')!;
        zctx.imageSmoothingEnabled = false;
        zctx.clearRect(0, 0, zOrig.width, zOrig.height);
        zctx.drawImage(origCanvas, roi.x, roi.y, roi.width, roi.height, 0, 0, zOrig.width, zOrig.height);
        if (showGuideBox) {
          const sx = zOrig.width / roi.width;
          const sy = zOrig.height / roi.height;
          zctx.strokeStyle = '#38bdf8';
          zctx.lineWidth = 2;
          zctx.strokeRect((wm.x - roi.x) * sx, (wm.y - roi.y) * sy, wm.width * sx, wm.height * sy);
        }
      }

      const zClean = zoomCleanRef.current;
      if (zClean) {
        const zctx = zClean.getContext('2d')!;
        zctx.imageSmoothingEnabled = false;
        zctx.clearRect(0, 0, zClean.width, zClean.height);
        zctx.drawImage(cleanCanvas, roi.x, roi.y, roi.width, roi.height, 0, 0, zClean.width, zClean.height);
        if (showGuideBox) {
          const sx = zClean.width / roi.width;
          const sy = zClean.height / roi.height;
          zctx.strokeStyle = '#34d399';
          zctx.lineWidth = 2;
          zctx.strokeRect((wm.x - roi.x) * sx, (wm.y - roi.y) * sy, wm.width * sx, wm.height * sy);
        }
      }
    };

    void renderLive();
    return () => {
      cancelled = true;
    };
  }, [previewFrame, baseBox, tuner, showGuideBox]);

  // Drag guide box directly on video preview frame
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current || !frameBoxRef.current || !previewFrame) return;
      const rect = frameBoxRef.current.getBoundingClientRect();
      const { startX, startY, initOffX, initOffY } = dragRef.current;
      const dx = Math.round(((e.clientX - startX) / rect.width) * previewFrame.width);
      const dy = Math.round(((e.clientY - startY) / rect.height) * previewFrame.height);
      setTuner((prev) => ({ ...prev, offsetX: initOffX + dx, offsetY: initOffY + dy }));
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [previewFrame]);

  const handleApplyPreset = (key: VideoPresetKey) => {
    if (!previewFrame) return;
    setPresetKey(key);
    setTuner(getAdaptiveVideoPreset(key, previewFrame.width, previewFrame.height));
  };

  const handleAutoDetectAgain = async () => {
    if (!previewFrame) return;
    const { bg96 } = await loadReferenceMasks();
    const det = detectVideoWatermark(previewFrame.imageData, previewFrame.width, previewFrame.height, bg96);
    setDetection(det);
    setPresetKey(det.presetKey);
    setTuner({
      gain: det.gain,
      offsetX: det.offsetX,
      offsetY: det.offsetY,
      sizeScale: det.sizeScale,
    });
    onNotify(`Auto-Detect Video: ${det.name} (${Math.round(det.score * 100)}% khớp)`);
  };

  const handleAutoGain = async () => {
    if (!previewFrame || !baseBox) return;
    const { bg96 } = await loadReferenceMasks();
    const wm = resolveWatermarkBox(baseBox, previewFrame.width, previewFrame.height, tuner);
    const optimal = estimateOptimalGain(
      previewFrame.imageData,
      previewFrame.width,
      previewFrame.height,
      bg96,
      wm,
      tuner.gain
    );
    setTuner((prev) => ({ ...prev, gain: optimal }));
    onNotify(`Đã tối ưu Độ mạnh Alpha cho video: ${optimal.toFixed(2)}x`);
  };

  const handleExportVideo = async () => {
    if (!file) return;
    setIsExporting(true);
    setProgressPct(0);
    setFramesDone(0);
    setPhaseLabel('Đang khởi tạo WebCodecs H.264...');
    setExportResult(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await exportCleanedVideoMp4(
        file,
        tuner,
        (pct, count, phase) => {
          setProgressPct(pct);
          setFramesDone(count);
          setPhaseLabel(phase);
        },
        controller.signal
      );
      setExportResult(res);
      onNotify(
        res.hasAudio
          ? `Xuất thành công video MP4 sạch (${res.frameCount} khung hình · giữ nguyên âm thanh gốc)!`
          : `Xuất thành công video MP4 sạch (${res.frameCount} khung hình)!`
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Lỗi khi xuất video.');
    } finally {
      setIsExporting(false);
      abortRef.current = null;
    }
  };

  const handleDownloadVideo = () => {
    if (!exportResult || !file) return;
    const baseName = file.name.replace(/\.[^.]+$/, '');
    const a = document.createElement('a');
    a.href = exportResult.url;
    a.download = `clean_${baseName}.mp4`;
    a.click();
  };

  const handleResetAll = () => {
    if (exportResult) {
      URL.revokeObjectURL(exportResult.url);
      URL.revokeObjectURL(exportResult.originalUrl);
    }
    setFile(null);
    setPreviewFrame(null);
    setBaseBox(null);
    setDetection(null);
    setExportResult(null);
    setCleanedFrameUrl(null);
  };

  // Empty Video Dropzone
  if (!file || !previewFrame || !baseBox) {
    return (
      <section className="dropzone-stage">
        <div className="hero-header">
          <div className="hero-pill">
            <Film size={14} />
            <span>WebCodecs H.264 MP4 · Giữ 100% Âm Thanh Gốc · Gemini Omni / Flow / Veo 3</span>
          </div>
          <h1 className="hero-title">
            Xóa Logo <span>Video Omni &amp; Veo 3</span> siêu tốc
          </h1>
          <p className="hero-desc">
            Sử dụng công nghệ <strong>WebCodecs + MediaBunny</strong> giải mã &amp; khử watermark bằng
            Reverse Alpha chuẩn toán học từng khung hình, xuất trực tiếp file <strong>MP4 H.264</strong>{' '}
            giữ nguyên 100% âm thanh gốc mà không gửi video lên máy chủ.
          </p>
        </div>

        <label
          className={`dropzone-card glass-panel ${isDragging ? 'dragging' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void handleVideoFile(f);
          }}
        >
          <input
            type="file"
            accept="video/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleVideoFile(f);
              e.target.value = '';
            }}
          />
          <div className="dropzone-visual">
            {isAnalyzing ? (
              <Loader2 size={34} color="var(--accent-2)" className="spin" />
            ) : (
              <UploadCloud size={34} color="var(--accent-2)" />
            )}
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>
              {isAnalyzing
                ? 'Đang quét khung hình đẹp nhất & tự nhận diện logo Omni / Veo...'
                : 'Kéo thả Video Gemini Omni / Flow / Veo 3 vào đây'}
            </div>
            <div style={{ fontSize: 13.5, color: 'var(--text-secondary)' }}>
              Hỗ trợ MP4 · WebM · MOV · Xuất MP4 chất lượng cao giữ nguyên âm thanh gốc
            </div>
          </div>
          <div className="format-chips">
            <span className="format-chip">Gemini Omni</span>
            <span className="format-chip">Google Flow</span>
            <span className="format-chip">Veo 3</span>
            <span className="format-chip">H.264 MP4 + Audio Passthrough</span>
          </div>
        </label>

        <div className="feature-strip">
          <div className="feature-item">
            <Volume2 size={15} color="#34d399" />
            <span>Audio Passthrough — Giữ nguyên 100% âm thanh</span>
          </div>
          <div className="feature-item">
            <Zap size={15} color="#38bdf8" />
            <span>Tăng tốc phần cứng WebCodecs (nhanh hơn real-time)</span>
          </div>
          <div className="feature-item">
            <ShieldCheck size={15} color="#c084fc" />
            <span>{isWebCodecsVideoSupported() ? 'Trình duyệt đã sẵn sàng WebCodecs' : 'Khuyên dùng Chrome / Edge'}</span>
          </div>
        </div>
      </section>
    );
  }

  // Exported Result Comparison View
  if (exportResult) {
    return (
      <div className="glass-panel" style={{ borderRadius: 24, padding: 24, maxWidth: 1120, margin: '0 auto', width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <CheckCircle2 size={24} color="#34d399" />
            <div>
              <h2 style={{ fontSize: 19, fontWeight: 700 }}>Đã xóa sạch Watermark Video MP4!</h2>
              <p style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                {exportResult.width}×{exportResult.height}px · {exportResult.frameCount} khung hình ·{' '}
                {exportResult.hasAudio ? 'Đã giữ nguyên âm thanh gốc' : 'Video không có track âm thanh'}
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="btn btn-ghost" onClick={() => setExportResult(null)}>
              <RotateCcw size={15} />
              <span>Chỉnh lại Live Tuner</span>
            </button>
            <button type="button" className="btn btn-ghost" onClick={handleResetAll}>
              <UploadCloud size={15} />
              <span>Chọn video khác</span>
            </button>
            <button type="button" className="btn btn-success" onClick={handleDownloadVideo}>
              <Download size={16} />
              <span>Tải Video MP4 Sạch</span>
            </button>
          </div>
        </div>

        <div className="video-compare-grid">
          <div className="video-result-box">
            <div className="zoom-card-head">
              <span className="dot blue" />
              <span>Video Gốc (Có Logo)</span>
            </div>
            <video src={exportResult.originalUrl} controls playsInline />
          </div>
          <div className="video-result-box clean">
            <div className="zoom-card-head">
              <span className="dot green" />
              <span>Video Sau Khi Xóa Logo (MP4 Sạch)</span>
            </div>
            <video src={exportResult.url} controls playsInline />
          </div>
        </div>
      </div>
    );
  }

  const wm = resolveWatermarkBox(baseBox, previewFrame.width, previewFrame.height, tuner);
  const offXMin = -Math.round(previewFrame.width * 0.45);
  const offXMax = Math.round(previewFrame.width * 0.25);
  const offYMin = -Math.round(previewFrame.height * 0.45);
  const offYMax = Math.round(previewFrame.height * 0.25);

  return (
    <div className="studio-grid">
      {/* Left Video Frame Live Tuner + Dual Zoomed Comparison */}
      <div className="canvas-stage-panel glass-panel">
        <div className="tuner-status-strip">
          <div className="detect-pill">
            <Scan size={14} color={detection?.matchFound ? '#34d399' : '#fbbf24'} />
            <span>
              {detection?.matchFound ? (
                <>
                  Tự nhận diện Video: <strong>{detection.name}</strong> ·{' '}
                  <span style={{ color: '#34d399' }}>{Math.round(detection.score * 100)}% khớp</span>
                </>
              ) : (
                <>
                  Áp dụng chuẩn: <strong>{detection?.name ?? 'Gemini Omni / Veo 3'}</strong>
                </>
              )}
            </span>
          </div>

          <div className="hud-group">
            <button
              type="button"
              className={`hud-btn ${showGuideBox ? 'active' : ''}`}
              onClick={() => setShowGuideBox((v) => !v)}
            >
              <Focus size={14} />
              <span>Khung vị trí</span>
            </button>
            <button type="button" className="hud-btn" onClick={handleResetAll}>
              <UploadCloud size={14} />
              <span>Đổi video</span>
            </button>
          </div>
        </div>

        <div className="canvas-viewport" style={{ padding: 20 }}>
          <div
            ref={frameBoxRef}
            className="canvas-frame-wrapper"
            style={{
              width: 'min(100%, 840px)',
              aspectRatio: `${previewFrame.width} / ${previewFrame.height}`,
            }}
          >
            {cleanedFrameUrl && (
              <img
                src={cleanedFrameUrl}
                alt="Video Frame Preview"
                className="canvas-img"
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
            )}

            {showGuideBox && (
              <div
                className="roi-box"
                style={{
                  left: `${(wm.x / previewFrame.width) * 100}%`,
                  top: `${(wm.y / previewFrame.height) * 100}%`,
                  width: `${(wm.width / previewFrame.width) * 100}%`,
                  height: `${(wm.height / previewFrame.height) * 100}%`,
                }}
                title="Kéo khung để căn chuẩn vị trí logo video"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  dragRef.current = {
                    startX: e.clientX,
                    startY: e.clientY,
                    initOffX: tuner.offsetX,
                    initOffY: tuner.offsetY,
                  };
                }}
              >
                <div className="roi-label">
                  ✦ Video {wm.size}×{wm.size}px · α={tuner.gain.toFixed(2)}x
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Dual Zoomed Pixel Loupe */}
        <div className="dual-zoom-bar">
          <div className="zoom-card">
            <div className="zoom-card-head">
              <span className="dot blue" />
              <span>Khung hình GỐC (Zoom góc logo)</span>
            </div>
            <canvas ref={zoomOrigRef} width={220} height={220} />
          </div>

          <div className="zoom-card clean">
            <div className="zoom-card-head">
              <span className="dot green" />
              <span>Khung hình ĐÃ XÓA (Live 60fps)</span>
            </div>
            <canvas ref={zoomCleanRef} width={220} height={220} />
          </div>
        </div>
      </div>

      {/* Right Video Live Tuner Controls */}
      <aside className="inspector-panel glass-panel">
        <div className="inspector-section">
          <div className="section-label">
            <span>Model Preset Video</span>
          </div>
          <div className="algo-list">
            <button
              type="button"
              className={`algo-pill ${presetKey === 'veo' ? 'active' : ''}`}
              onClick={() => handleApplyPreset('veo')}
            >
              <strong>Omni / Veo 3</strong>
              <span>Inset chuẩn</span>
            </button>
            <button
              type="button"
              className={`algo-pill ${presetKey === 'corner' ? 'active' : ''}`}
              onClick={() => handleApplyPreset('corner')}
            >
              <strong>Flow Corner</strong>
              <span>Sát góc</span>
            </button>
            <button
              type="button"
              className={`algo-pill ${presetKey === 'sparkle' ? 'active' : ''}`}
              onClick={() => handleApplyPreset('sparkle')}
            >
              <strong>Sparkle</strong>
              <span>Kiểu ảnh</span>
            </button>
          </div>

          <button
            type="button"
            className="btn btn-ghost"
            style={{ width: '100%', marginTop: 4 }}
            onClick={() => void handleAutoDetectAgain()}
          >
            <Scan size={15} color="var(--accent-2)" />
            <span>Quét Tự Động Khung Hình</span>
          </button>
        </div>

        <div className="inspector-section">
          <div className="section-label">
            <span>Live Tuner Video</span>
            <button type="button" className="text-link-btn" onClick={() => void handleAutoDetectAgain()}>
              <RotateCcw size={12} />
              <span>Reset</span>
            </button>
          </div>

          <div className="slider-row">
            <div className="slider-header">
              <span>Độ mạnh Alpha (Gain)</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button type="button" className="micro-pill-btn" onClick={() => void handleAutoGain()}>
                  Auto
                </button>
                <span className="slider-val">{tuner.gain.toFixed(2)}x</span>
              </div>
            </div>
            <input
              type="range"
              min={0.1}
              max={1.8}
              step={0.02}
              value={tuner.gain}
              className="studio-slider"
              onChange={(e) => setTuner((p) => ({ ...p, gain: parseFloat(e.target.value) }))}
            />
          </div>

          <div className="slider-row">
            <div className="slider-header">
              <span>Tỉ lệ kích thước (Scale)</span>
              <span className="slider-val">{tuner.sizeScale.toFixed(2)}x</span>
            </div>
            <input
              type="range"
              min={0.4}
              max={2.2}
              step={0.01}
              value={tuner.sizeScale}
              className="studio-slider"
              onChange={(e) => setTuner((p) => ({ ...p, sizeScale: parseFloat(e.target.value) }))}
            />
          </div>

          <div className="slider-row">
            <div className="slider-header">
              <span>Dịch ngang (Offset X)</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <button
                  type="button"
                  className="micro-pill-btn"
                  onClick={() => setTuner((p) => ({ ...p, offsetX: p.offsetX - 1 }))}
                >
                  -1
                </button>
                <span className="slider-val">{tuner.offsetX}px</span>
                <button
                  type="button"
                  className="micro-pill-btn"
                  onClick={() => setTuner((p) => ({ ...p, offsetX: p.offsetX + 1 }))}
                >
                  +1
                </button>
              </div>
            </div>
            <input
              type="range"
              min={offXMin}
              max={offXMax}
              step={1}
              value={tuner.offsetX}
              className="studio-slider"
              onChange={(e) => setTuner((p) => ({ ...p, offsetX: parseInt(e.target.value, 10) }))}
            />
          </div>

          <div className="slider-row">
            <div className="slider-header">
              <span>Dịch dọc (Offset Y)</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <button
                  type="button"
                  className="micro-pill-btn"
                  onClick={() => setTuner((p) => ({ ...p, offsetY: p.offsetY - 1 }))}
                >
                  -1
                </button>
                <span className="slider-val">{tuner.offsetY}px</span>
                <button
                  type="button"
                  className="micro-pill-btn"
                  onClick={() => setTuner((p) => ({ ...p, offsetY: p.offsetY + 1 }))}
                >
                  +1
                </button>
              </div>
            </div>
            <input
              type="range"
              min={offYMin}
              max={offYMax}
              step={1}
              value={tuner.offsetY}
              className="studio-slider"
              onChange={(e) => setTuner((p) => ({ ...p, offsetY: parseInt(e.target.value, 10) }))}
            />
          </div>
        </div>

        <div className="metrics-card">
          <div className="metrics-row">
            <span>File Video</span>
            <span style={{ maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {file.name}
            </span>
          </div>
          <div className="metrics-row">
            <span>Độ phân giải</span>
            <span>
              {previewFrame.width}×{previewFrame.height} · {previewFrame.duration.toFixed(1)}s
            </span>
          </div>
        </div>

        {isExporting && (
          <div className="inspector-section">
            <div className="slider-header">
              <span style={{ fontSize: 11.5 }}>{phaseLabel}</span>
              <span className="slider-val">{progressPct}%</span>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${progressPct}%` }} />
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
              Đã xử lý {framesDone} khung hình · Giữ tab này mở
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 'auto' }}>
          {!isExporting ? (
            <button
              type="button"
              className="btn btn-primary btn-lg"
              onClick={() => void handleExportVideo()}
            >
              <Sparkles size={17} />
              <span>Xuất Video MP4 Sạch (H.264 + Audio)</span>
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-ghost btn-lg"
              onClick={() => abortRef.current?.abort()}
            >
              <StopCircle size={17} color="#f87171" />
              <span>Hủy xuất video</span>
            </button>
          )}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)' }}>
            <Wand2 size={12} />
            <span>Mẹo: Chỉnh slider đến khi ô Zoom phải sạch hoàn toàn rồi bấm Xuất</span>
          </div>
        </div>
      </aside>
    </div>
  );
};
