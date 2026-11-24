import JSZip from 'jszip';
import {
  CheckCircle2,
  Columns2,
  Download,
  Eye,
  Focus,
  Layers,
  Loader2,
  MoveHorizontal,
  RotateCcw,
  Scan,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  Wand2,
  X,
  Zap,
} from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  cleanFrameExact,
  detectImageWatermark,
  estimateOptimalGain,
  getAdaptiveImagePreset,
  getImageWatermarkBase,
  resolveWatermarkBox,
  type DetectionResult,
  type ImagePresetKey,
  type TunerParams,
  type WatermarkBox,
} from '../engine/coreRemover';
import { loadReferenceMasks } from '../engine/referenceMasks';
import { generateAuthenticSample } from '../engine/sampleGenerator';

export interface LoadedImageEntry {
  id: string;
  name: string;
  file: File;
  width: number;
  height: number;
  imageData: ImageData;
  originalUrl: string;
  base: WatermarkBox;
  detection: DetectionResult<ImagePresetKey>;
  tuner: TunerParams;
  presetKey: ImagePresetKey;
}

interface ImageTunerStudioProps {
  externalFiles: File[];
  onClearExternalFiles: () => void;
  onImageCountChange: (count: number) => void;
  onNotify: (msg: string) => void;
}

async function decodeImageFile(file: File): Promise<{ width: number; height: number; imageData: ImageData; url: string }> {
  const url = URL.createObjectURL(file);
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const width = bmp.width;
      const height = bmp.height;
      const c = document.createElement('canvas');
      c.width = width;
      c.height = height;
      const cx = c.getContext('2d', { willReadFrequently: true })!;
      cx.drawImage(bmp, 0, 0, width, height);
      const imageData = cx.getImageData(0, 0, width, height);
      bmp.close();
      return { width, height, imageData, url };
    } catch {
      // Fallback to HTMLImageElement
    }
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;
      const c = document.createElement('canvas');
      c.width = width;
      c.height = height;
      const cx = c.getContext('2d', { willReadFrequently: true })!;
      cx.drawImage(img, 0, 0, width, height);
      const imageData = cx.getImageData(0, 0, width, height);
      resolve({ width, height, imageData, url });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Không thể đọc file ảnh này.'));
    };
    img.src = url;
  });
}

export const ImageTunerStudio: React.FC<ImageTunerStudioProps> = ({
  externalFiles,
  onClearExternalFiles,
  onImageCountChange,
  onNotify,
}) => {
  const [entries, setEntries] = useState<LoadedImageEntry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [isExportingZip, setIsExportingZip] = useState(false);
  const [exportFormat, setExportFormat] = useState<'png' | 'jpeg' | 'webp'>('png');

  const [splitPct, setSplitPct] = useState(48);
  const [compareMode, setCompareMode] = useState<'split' | 'clean'>('clean');
  const [peekingOrig, setPeekingOrig] = useState(false);
  const [showGuideBox, setShowGuideBox] = useState(true);
  const [draggingSplit, setDraggingSplit] = useState(false);
  const [cleanedPreviewUrl, setCleanedPreviewUrl] = useState<string | null>(null);

  const bg96Ref = useRef<HTMLImageElement | null>(null);
  const zoomOrigCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const zoomCleanCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const dragBoxRef = useRef<{ startX: number; startY: number; initOffX: number; initOffY: number } | null>(null);

  const activeEntry = entries.find((e) => e.id === activeId) ?? entries[0] ?? null;

  useEffect(() => {
    onImageCountChange(entries.length);
  }, [entries.length, onImageCountChange]);

  const ingestFiles = useCallback(
    async (files: File[]) => {
      const valid = files.filter((f) => f.type.startsWith('image/'));
      if (valid.length === 0) return;

      setIsLoadingFiles(true);
      try {
        const { bg96 } = await loadReferenceMasks();
        bg96Ref.current = bg96;

        const created: LoadedImageEntry[] = [];
        for (const file of valid) {
          const decoded = await decodeImageFile(file);
          const base = getImageWatermarkBase(decoded.width, decoded.height);
          const detection = detectImageWatermark(decoded.imageData, decoded.width, decoded.height, bg96);
          const tuner: TunerParams = {
            gain: detection.gain,
            offsetX: detection.offsetX,
            offsetY: detection.offsetY,
            sizeScale: detection.sizeScale,
          };
          created.push({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name: file.name,
            file,
            width: decoded.width,
            height: decoded.height,
            imageData: decoded.imageData,
            originalUrl: decoded.url,
            base,
            detection,
            tuner,
            presetKey: detection.presetKey,
          });
        }

        if (created.length > 0) {
          setEntries((prev) => [...prev, ...created]);
          setActiveId(created[0].id);
          const top = created[0];
          onNotify(
            top.detection.matchFound
              ? `Tự động khóa logo ${top.detection.name} (${Math.round(top.detection.score * 100)}% khớp)!`
              : `Đã tải ${created.length} ảnh — áp dụng cấu hình chuẩn Gemini!`
          );
        }
      } catch (err) {
        onNotify(err instanceof Error ? err.message : 'Lỗi khi tải ảnh.');
      } finally {
        setIsLoadingFiles(false);
      }
    },
    [onNotify]
  );

  // Consume external files passed from TopBar Upload or Ctrl+V paste
  useEffect(() => {
    if (externalFiles.length > 0) {
      void ingestFiles(externalFiles);
      onClearExternalFiles();
    }
  }, [externalFiles, ingestFiles, onClearExternalFiles]);

  // Real-time 60fps Live Renderer whenever activeEntry or its tuner sliders change!
  useEffect(() => {
    if (!activeEntry) {
      setCleanedPreviewUrl(null);
      return;
    }

    let cancelled = false;

    const renderLive = async () => {
      if (!bg96Ref.current) {
        const { bg96 } = await loadReferenceMasks();
        bg96Ref.current = bg96;
      }
      if (cancelled || !bg96Ref.current) return;

      const { width, height, imageData, base, tuner } = activeEntry;
      const copy = new ImageData(new Uint8ClampedArray(imageData.data), width, height);
      const { wm, roi } = cleanFrameExact(bg96Ref.current, copy, width, height, base, tuner);

      // Build cleaned full canvas
      const cleanCanvas = document.createElement('canvas');
      cleanCanvas.width = width;
      cleanCanvas.height = height;
      cleanCanvas.getContext('2d')!.putImageData(copy, 0, 0);

      const origCanvas = document.createElement('canvas');
      origCanvas.width = width;
      origCanvas.height = height;
      origCanvas.getContext('2d')!.putImageData(imageData, 0, 0);

      // Update main cleaned image preview URL
      setCleanedPreviewUrl(cleanCanvas.toDataURL('image/png'));

      // Draw crisp pixel-exact Dual Zoomed Comparison Loupes (Original vs Cleaned)
      const zOrig = zoomOrigCanvasRef.current;
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

      const zClean = zoomCleanCanvasRef.current;
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
  }, [activeEntry, showGuideBox]);

  // Global pointer handlers for split slider & dragging watermark guide box directly on canvas
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!frameRef.current || !activeEntry) return;
      const rect = frameRef.current.getBoundingClientRect();

      if (draggingSplit) {
        const pct = ((e.clientX - rect.left) / rect.width) * 100;
        setSplitPct(Math.max(2, Math.min(98, pct)));
      } else if (dragBoxRef.current) {
        const { startX, startY, initOffX, initOffY } = dragBoxRef.current;
        const dx = Math.round(((e.clientX - startX) / rect.width) * activeEntry.width);
        const dy = Math.round(((e.clientY - startY) / rect.height) * activeEntry.height);
        updateActiveTuner({ offsetX: initOffX + dx, offsetY: initOffY + dy });
      }
    };
    const onUp = () => {
      setDraggingSplit(false);
      dragBoxRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [draggingSplit, activeEntry]);

  const updateActiveTuner = (patch: Partial<TunerParams>, nextPreset?: ImagePresetKey) => {
    if (!activeEntry) return;
    setEntries((prev) =>
      prev.map((item) =>
        item.id === activeEntry.id
          ? {
              ...item,
              tuner: { ...item.tuner, ...patch },
              presetKey: nextPreset ?? item.presetKey,
            }
          : item
      )
    );
  };

  const handleApplyPreset = (presetKey: ImagePresetKey) => {
    if (!activeEntry) return;
    const preset = getAdaptiveImagePreset(presetKey, activeEntry.width, activeEntry.height);
    updateActiveTuner(preset, presetKey);
  };

  const handleReRunAutoDetect = async () => {
    if (!activeEntry) return;
    const { bg96 } = await loadReferenceMasks();
    bg96Ref.current = bg96;
    const det = detectImageWatermark(activeEntry.imageData, activeEntry.width, activeEntry.height, bg96);
    setEntries((prev) =>
      prev.map((item) =>
        item.id === activeEntry.id
          ? {
              ...item,
              detection: det,
              presetKey: det.presetKey,
              tuner: {
                gain: det.gain,
                offsetX: det.offsetX,
                offsetY: det.offsetY,
                sizeScale: det.sizeScale,
              },
            }
          : item
      )
    );
    onNotify(`Auto-Detect: ${det.name} (${Math.round(det.score * 100)}% khớp)`);
  };

  const handleAutoGain = async () => {
    if (!activeEntry) return;
    const { bg96 } = await loadReferenceMasks();
    const wm = resolveWatermarkBox(activeEntry.base, activeEntry.width, activeEntry.height, activeEntry.tuner);
    const optimal = estimateOptimalGain(
      activeEntry.imageData,
      activeEntry.width,
      activeEntry.height,
      bg96,
      wm,
      activeEntry.tuner.gain
    );
    updateActiveTuner({ gain: optimal });
    onNotify(`Đã tối ưu Độ mạnh Alpha tự động: ${optimal.toFixed(2)}x`);
  };

  const renderEntryBlob = async (entry: LoadedImageEntry): Promise<Blob> => {
    const { bg96 } = await loadReferenceMasks();
    const copy = new ImageData(new Uint8ClampedArray(entry.imageData.data), entry.width, entry.height);
    cleanFrameExact(bg96, copy, entry.width, entry.height, entry.base, entry.tuner);
    const canvas = document.createElement('canvas');
    canvas.width = entry.width;
    canvas.height = entry.height;
    canvas.getContext('2d')!.putImageData(copy, 0, 0);
    const mime =
      exportFormat === 'jpeg' ? 'image/jpeg' : exportFormat === 'webp' ? 'image/webp' : 'image/png';
    return new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), mime, 0.96));
  };

  const handleDownloadCurrent = async () => {
    if (!activeEntry) return;
    const blob = await renderEntryBlob(activeEntry);
    const url = URL.createObjectURL(blob);
    const ext = exportFormat === 'jpeg' ? 'jpg' : exportFormat;
    const baseName = activeEntry.name.replace(/\.[^.]+$/, '');
    const a = document.createElement('a');
    a.href = url;
    a.download = `clean_${baseName}.${ext}`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    onNotify(`Đã tải xuống ảnh sạch clean_${baseName}.${ext}`);
  };

  const handleDownloadAllZip = async () => {
    if (entries.length === 0) return;
    setIsExportingZip(true);
    try {
      const zip = new JSZip();
      const ext = exportFormat === 'jpeg' ? 'jpg' : exportFormat;
      for (const entry of entries) {
        const blob = await renderEntryBlob(entry);
        const baseName = entry.name.replace(/\.[^.]+$/, '');
        zip.file(`clean_${baseName}.${ext}`, blob);
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `AuraErase_Clean_${entries.length}_Images.zip`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
      onNotify(`Đã xuất gói ZIP gồm ${entries.length} ảnh sạch không giảm chất lượng!`);
    } finally {
      setIsExportingZip(false);
    }
  };

  const handleLoadSample = async (kind: 'gemini-new' | 'gemini-classic') => {
    setIsLoadingFiles(true);
    try {
      const sample = await generateAuthenticSample(kind);
      await ingestFiles([sample.file]);
    } finally {
      setIsLoadingFiles(false);
    }
  };

  const handleRemoveEntry = (id: string) => {
    setEntries((prev) => {
      const target = prev.find((e) => e.id === id);
      if (target) URL.revokeObjectURL(target.originalUrl);
      const next = prev.filter((e) => e.id !== id);
      if (activeId === id) setActiveId(next[0]?.id ?? null);
      return next;
    });
  };

  // Empty Hero State
  if (!activeEntry) {
    return (
      <section className="dropzone-stage">
        <div className="hero-header">
          <div className="hero-pill">
            <Sparkles size={14} />
            <span>Exact Reverse Alpha Mask (bg_48 &amp; bg_96) · Chuẩn 100% Pixel Gốc</span>
          </div>
          <h1 className="hero-title">
            Xóa Logo <span>Gemini &amp; Nano Banana</span> chuẩn từng pixel
          </h1>
          <p className="hero-desc">
            Sử dụng đúng bản đồ alpha gốc của Google Gemini / Nano Banana / Omni kết hợp bộ nhận diện
            đa tỉ lệ + gradient tự động và <strong>Live Tuner 60fps</strong> — khôi phục 100% chi tiết
            nền mà không làm mờ ảnh như AI Inpainting.
          </p>
        </div>

        <label
          className={`dropzone-card glass-panel ${isDraggingFile ? 'dragging' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDraggingFile(true);
          }}
          onDragLeave={() => setIsDraggingFile(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDraggingFile(false);
            if (e.dataTransfer.files?.length) void ingestFiles(Array.from(e.dataTransfer.files));
          }}
        >
          <input
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files?.length) void ingestFiles(Array.from(e.target.files));
              e.target.value = '';
            }}
          />
          <div className="dropzone-visual">
            {isLoadingFiles ? (
              <Loader2 size={34} color="var(--accent-2)" className="spin" />
            ) : (
              <UploadCloud size={34} color="var(--accent-2)" />
            )}
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>
              {isLoadingFiles
                ? 'Đang phân tích & tự động nhận diện watermark...'
                : 'Kéo thả ảnh Gemini / Omni vào đây hoặc nhấn để chọn'}
            </div>
            <div style={{ fontSize: 13.5, color: 'var(--text-secondary)' }}>
              Tự động khóa vị trí logo ngay khi tải lên · Hỗ trợ Ctrl+V &amp; xử lý hàng loạt
            </div>
          </div>
          <div className="format-chips">
            <span className="format-chip">PNG Lossless</span>
            <span className="format-chip">JPG / JPEG</span>
            <span className="format-chip">WebP</span>
            <span className="format-chip">Nano Banana 12.5% Inset</span>
            <span className="format-chip">Gemini Classic Corner</span>
          </div>
        </label>

        <div className="sample-row">
          <button
            type="button"
            className="sample-card"
            onClick={() => void handleLoadSample('gemini-new')}
            disabled={isLoadingFiles}
          >
            <div className="sample-icon gemini">
              <Sparkles size={20} />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 3 }}>
                Thử ảnh mẫu Gemini &amp; Nano Banana (Mới)
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                Test thuật toán Reverse Alpha trên nền Cyberpunk sắc nét
              </div>
            </div>
          </button>

          <button
            type="button"
            className="sample-card"
            onClick={() => void handleLoadSample('gemini-classic')}
            disabled={isLoadingFiles}
          >
            <div className="sample-icon omni">
              <Wand2 size={20} />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 3 }}>
                Thử ảnh mẫu Gemini Classic Corner
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                Test tự động định vị 1px &amp; xóa sạch không để lại viền mờ
              </div>
            </div>
          </button>
        </div>

        <div className="feature-strip">
          <div className="feature-item">
            <ShieldCheck size={15} color="#34d399" />
            <span>100% chạy trên máy — Không quảng cáo, không upload</span>
          </div>
          <div className="feature-item">
            <Zap size={15} color="#38bdf8" />
            <span>Live Tuner thời gian thực 60fps</span>
          </div>
          <div className="feature-item">
            <Layers size={15} color="#c084fc" />
            <span>Xóa hàng loạt &amp; tải ZIP Lossless</span>
          </div>
        </div>
      </section>
    );
  }

  const wm = resolveWatermarkBox(activeEntry.base, activeEntry.width, activeEntry.height, activeEntry.tuner);
  const offXMin = -Math.round(activeEntry.width * 0.45);
  const offXMax = Math.round(activeEntry.width * 0.25);
  const offYMin = -Math.round(activeEntry.height * 0.45);
  const offYMax = Math.round(activeEntry.height * 0.25);

  return (
    <>
      <div className="studio-grid">
        {/* Left Interactive Canvas + Dual Zoomed Comparison */}
        <div className="canvas-stage-panel glass-panel">
          {/* Auto-Detect Status Strip */}
          <div className="tuner-status-strip">
            <div className="detect-pill">
              <Scan size={14} color={activeEntry.detection.matchFound ? '#34d399' : '#fbbf24'} />
              <span>
                {activeEntry.detection.matchFound ? (
                  <>
                    Tự nhận diện: <strong>{activeEntry.detection.name}</strong> ·{' '}
                    <span style={{ color: '#34d399' }}>
                      {Math.round(activeEntry.detection.score * 100)}% khớp
                    </span>
                  </>
                ) : (
                  <>Áp dụng chuẩn: <strong>{activeEntry.detection.name}</strong> (kéo khung hoặc slider để tinh chỉnh)</>
                )}
              </span>
            </div>

            <div className="hud-group">
              <button
                type="button"
                className={`hud-btn ${compareMode === 'split' ? 'active' : ''}`}
                onClick={() => setCompareMode((m) => (m === 'split' ? 'clean' : 'split'))}
              >
                <Columns2 size={14} />
                <span>So sánh chia đôi</span>
              </button>
              <button
                type="button"
                className={`hud-btn ${peekingOrig ? 'active' : ''}`}
                onPointerDown={() => setPeekingOrig(true)}
                onPointerUp={() => setPeekingOrig(false)}
                onPointerLeave={() => setPeekingOrig(false)}
              >
                <Eye size={14} />
                <span>Giữ xem gốc</span>
              </button>
              <button
                type="button"
                className={`hud-btn ${showGuideBox ? 'active' : ''}`}
                onClick={() => setShowGuideBox((v) => !v)}
              >
                <Focus size={14} />
                <span>Khung vị trí</span>
              </button>
            </div>
          </div>

          {/* Main Image Viewport */}
          <div className="canvas-viewport" style={{ padding: 20 }}>
            <div
              ref={frameRef}
              className="canvas-frame-wrapper"
              style={{
                width: 'min(100%, 860px)',
                aspectRatio: `${activeEntry.width} / ${activeEntry.height}`,
              }}
            >
              <img
                src={peekingOrig || !cleanedPreviewUrl ? activeEntry.originalUrl : cleanedPreviewUrl}
                alt={activeEntry.name}
                className="canvas-img"
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />

              {compareMode === 'split' && !peekingOrig && cleanedPreviewUrl && (
                <>
                  <div
                    className="compare-overlay-clip"
                    style={{ clipPath: `inset(0 ${100 - splitPct}% 0 0)` }}
                  >
                    <img
                      src={activeEntry.originalUrl}
                      alt="Ảnh gốc"
                      className="canvas-img"
                      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                    />
                  </div>
                  <span className="compare-badge left">ẢNH GỐC</span>
                  <span className="compare-badge right">ĐÃ XÓA LOGO</span>
                  <div
                    className="compare-divider"
                    style={{ left: `${splitPct}%` }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setDraggingSplit(true);
                    }}
                  >
                    <div className="compare-handle">
                      <MoveHorizontal size={16} />
                    </div>
                  </div>
                </>
              )}

              {/* Draggable Watermark Guide Box */}
              {showGuideBox && (
                <div
                  className="roi-box"
                  style={{
                    left: `${(wm.x / activeEntry.width) * 100}%`,
                    top: `${(wm.y / activeEntry.height) * 100}%`,
                    width: `${(wm.width / activeEntry.width) * 100}%`,
                    height: `${(wm.height / activeEntry.height) * 100}%`,
                  }}
                  title="Kéo khung này để dịch chuyển vị trí khử logo theo từng pixel"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    dragBoxRef.current = {
                      startX: e.clientX,
                      startY: e.clientY,
                      initOffX: activeEntry.tuner.offsetX,
                      initOffY: activeEntry.tuner.offsetY,
                    };
                  }}
                >
                  <div className="roi-label">
                    ✦ {wm.size}×{wm.size}px · α={activeEntry.tuner.gain.toFixed(2)}x
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Dual Zoomed Pixel-Perfect Inspection Strip (EXACTLY like ishara-madu Live Tuner!) */}
          <div className="dual-zoom-bar">
            <div className="zoom-card">
              <div className="zoom-card-head">
                <span className="dot blue" />
                <span>Cận cảnh ẢNH GỐC (Zoom góc logo)</span>
              </div>
              <canvas ref={zoomOrigCanvasRef} width={220} height={220} />
            </div>

            <div className="zoom-card clean">
              <div className="zoom-card-head">
                <span className="dot green" />
                <span>Cận cảnh SAU KHI XÓA (Live 60fps)</span>
              </div>
              <canvas ref={zoomCleanCanvasRef} width={220} height={220} />
            </div>
          </div>
        </div>

        {/* Right Live Tuner Inspector */}
        <aside className="inspector-panel glass-panel">
          <div className="inspector-section">
            <div className="section-label">
              <span>Chọn nhanh cấu hình Model</span>
            </div>
            <div className="corner-grid">
              <button
                type="button"
                className={`corner-btn ${activeEntry.presetKey === 'new' ? 'active' : ''}`}
                onClick={() => handleApplyPreset('new')}
              >
                <Sparkles size={14} />
                <span>Gemini / Nano Banana</span>
              </button>
              <button
                type="button"
                className={`corner-btn ${activeEntry.presetKey === 'classic' ? 'active' : ''}`}
                onClick={() => handleApplyPreset('classic')}
              >
                <Wand2 size={14} />
                <span>Classic Corner</span>
              </button>
            </div>

            <button
              type="button"
              className="btn btn-ghost"
              style={{ width: '100%', marginTop: 4 }}
              onClick={() => void handleReRunAutoDetect()}
            >
              <Scan size={15} color="var(--accent-2)" />
              <span>Quét Tự Động (Auto-Detect 1px)</span>
            </button>
          </div>

          {/* Live Sliders (exact ishara-madu controls + fine nudge buttons!) */}
          <div className="inspector-section">
            <div className="section-label">
              <span>Live Tuner (Chỉnh trực tiếp)</span>
              <button
                type="button"
                className="text-link-btn"
                onClick={() => void handleReRunAutoDetect()}
                title="Đặt lại về thông số Auto-Detect"
              >
                <RotateCcw size={12} />
                <span>Reset</span>
              </button>
            </div>

            {/* Alpha Gain */}
            <div className="slider-row">
              <div className="slider-header">
                <span>Độ mạnh Alpha (Gain)</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    type="button"
                    className="micro-pill-btn"
                    onClick={() => void handleAutoGain()}
                  >
                    Auto
                  </button>
                  <span className="slider-val">{activeEntry.tuner.gain.toFixed(2)}x</span>
                </div>
              </div>
              <input
                type="range"
                min={0.1}
                max={1.8}
                step={0.02}
                value={activeEntry.tuner.gain}
                className="studio-slider"
                onChange={(e) => updateActiveTuner({ gain: parseFloat(e.target.value) })}
              />
            </div>

            {/* Size Scale */}
            <div className="slider-row">
              <div className="slider-header">
                <span>Tỉ lệ kích thước (Scale)</span>
                <span className="slider-val">{activeEntry.tuner.sizeScale.toFixed(2)}x</span>
              </div>
              <input
                type="range"
                min={0.4}
                max={2.2}
                step={0.01}
                value={activeEntry.tuner.sizeScale}
                className="studio-slider"
                onChange={(e) => updateActiveTuner({ sizeScale: parseFloat(e.target.value) })}
              />
            </div>

            {/* Offset X */}
            <div className="slider-row">
              <div className="slider-header">
                <span>Dịch ngang (Offset X)</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <button
                    type="button"
                    className="micro-pill-btn"
                    onClick={() => updateActiveTuner({ offsetX: activeEntry.tuner.offsetX - 1 })}
                  >
                    -1
                  </button>
                  <span className="slider-val">{activeEntry.tuner.offsetX}px</span>
                  <button
                    type="button"
                    className="micro-pill-btn"
                    onClick={() => updateActiveTuner({ offsetX: activeEntry.tuner.offsetX + 1 })}
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
                value={activeEntry.tuner.offsetX}
                className="studio-slider"
                onChange={(e) => updateActiveTuner({ offsetX: parseInt(e.target.value, 10) })}
              />
            </div>

            {/* Offset Y */}
            <div className="slider-row">
              <div className="slider-header">
                <span>Dịch dọc (Offset Y)</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <button
                    type="button"
                    className="micro-pill-btn"
                    onClick={() => updateActiveTuner({ offsetY: activeEntry.tuner.offsetY - 1 })}
                  >
                    -1
                  </button>
                  <span className="slider-val">{activeEntry.tuner.offsetY}px</span>
                  <button
                    type="button"
                    className="micro-pill-btn"
                    onClick={() => updateActiveTuner({ offsetY: activeEntry.tuner.offsetY + 1 })}
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
                value={activeEntry.tuner.offsetY}
                className="studio-slider"
                onChange={(e) => updateActiveTuner({ offsetY: parseInt(e.target.value, 10) })}
              />
            </div>
          </div>

          {/* Export Format */}
          <div className="inspector-section">
            <div className="section-label">
              <span>Định dạng xuất file</span>
            </div>
            <div className="algo-list">
              {(['png', 'jpeg', 'webp'] as const).map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  className={`algo-pill ${exportFormat === fmt ? 'active' : ''}`}
                  onClick={() => setExportFormat(fmt)}
                >
                  <strong>{fmt.toUpperCase()}</strong>
                  <span>{fmt === 'png' ? 'Lossless' : fmt === 'webp' ? 'Siêu nhẹ' : 'JPG'}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Live Info */}
          <div className="metrics-card">
            <div className="metrics-row">
              <span>Độ phân giải gốc</span>
              <span>
                {activeEntry.width} × {activeEntry.height}px
              </span>
            </div>
            <div className="metrics-row">
              <span>Vùng khử logo</span>
              <span>
                ({wm.x}, {wm.y}) · {wm.size}px
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 'auto' }}>
            <button
              type="button"
              className="btn btn-success btn-lg"
              onClick={() => void handleDownloadCurrent()}
            >
              <Download size={17} />
              <span>Tải Ảnh Sạch (.{exportFormat.toUpperCase()})</span>
            </button>
          </div>
        </aside>
      </div>

      {/* Multi-Image Batch Queue Strip */}
      {entries.length > 0 && (
        <div className="filmstrip-bar glass-panel">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <Layers size={16} color="var(--accent-2)" />
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>Danh sách ({entries.length} ảnh)</div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                Tất cả đã tự động khử logo
              </div>
            </div>
          </div>

          <div className="filmstrip-list">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className={`thumb-item ${entry.id === activeEntry.id ? 'active' : ''}`}
                onClick={() => setActiveId(entry.id)}
                title={entry.name}
              >
                <img src={entry.originalUrl} alt={entry.name} />
                <button
                  type="button"
                  className="thumb-remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveEntry(entry.id);
                  }}
                >
                  <X size={11} />
                </button>
                <span className="thumb-status">
                  <CheckCircle2 size={13} color="#34d399" />
                </span>
              </div>
            ))}
          </div>

          {entries.length > 1 && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={isExportingZip}
              onClick={() => void handleDownloadAllZip()}
            >
              {isExportingZip ? <Loader2 size={15} className="spin" /> : <Download size={15} />}
              <span>Tải tất cả ZIP ({entries.length})</span>
            </button>
          )}
        </div>
      )}
    </>
  );
};
