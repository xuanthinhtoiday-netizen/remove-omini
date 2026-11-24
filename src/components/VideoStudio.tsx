import JSZip from 'jszip';
import {
  CheckCircle2,
  CopyCheck,
  Download,
  Film,
  Focus,
  Layers,
  Loader2,
  Play,
  Plus,
  RotateCcw,
  Scan,
  ShieldCheck,
  Sparkles,
  StopCircle,
  UploadCloud,
  Volume2,
  Wand2,
  X,
  Zap,
} from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
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

interface VideoQueueEntry {
  id: string;
  file: File;
  name: string;
  thumbUrl: string;
  previewFrame: VideoPreviewFrame;
  baseBox: WatermarkBox;
  detection: DetectionResult<VideoPresetKey>;
  presetKey: VideoPresetKey;
  tuner: TunerParams;
  status: 'idle' | 'processing' | 'done' | 'error';
  progressPct: number;
  framesDone: number;
  phaseLabel: string;
  result?: VideoExportResult;
  errorMessage?: string;
}

interface VideoStudioProps {
  onNotify: (msg: string) => void;
}

function imageDataToThumbUrl(imageData: ImageData, maxW = 240): string {
  const scale = Math.min(1, maxW / imageData.width);
  const w = Math.max(1, Math.round(imageData.width * scale));
  const h = Math.max(1, Math.round(imageData.height * scale));
  const src = document.createElement('canvas');
  src.width = imageData.width;
  src.height = imageData.height;
  src.getContext('2d')!.putImageData(imageData, 0, 0);

  const dst = document.createElement('canvas');
  dst.width = w;
  dst.height = h;
  dst.getContext('2d')!.drawImage(src, 0, 0, w, h);
  return dst.toDataURL('image/jpeg', 0.78);
}

export const VideoStudio: React.FC<VideoStudioProps> = ({ onNotify }) => {
  const [entries, setEntries] = useState<VideoQueueEntry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'tuner' | 'result'>('tuner');

  const [isDragging, setIsDragging] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzingProgress, setAnalyzingProgress] = useState('');
  const [showGuideBox, setShowGuideBox] = useState(true);
  const [cleanedFrameUrl, setCleanedFrameUrl] = useState<string | null>(null);

  const [isExportingBatch, setIsExportingBatch] = useState(false);
  const [batchCounter, setBatchCounter] = useState<{ current: number; total: number } | null>(null);
  const [isZipping, setIsZipping] = useState(false);

  const bg96Ref = useRef<HTMLImageElement | null>(null);
  const zoomOrigRef = useRef<HTMLCanvasElement | null>(null);
  const zoomCleanRef = useRef<HTMLCanvasElement | null>(null);
  const frameBoxRef = useRef<HTMLDivElement | null>(null);
  const addMoreInputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; initOffX: number; initOffY: number } | null>(
    null
  );

  const activeEntry = entries.find((e) => e.id === activeId) ?? entries[0] ?? null;

  const updateEntry = useCallback((id: string, patch: Partial<VideoQueueEntry>) => {
    setEntries((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  const handleVideoFiles = async (fileList: FileList | File[]) => {
    const valid = Array.from(fileList).filter((f) => f.type.startsWith('video/'));
    if (valid.length === 0) {
      onNotify('Vui lòng chọn file video hợp lệ (MP4, WebM, MOV).');
      return;
    }

    setIsAnalyzing(true);
    try {
      const { bg96 } = await loadReferenceMasks();
      bg96Ref.current = bg96;

      const added: VideoQueueEntry[] = [];
      for (let i = 0; i < valid.length; i++) {
        const selected = valid[i];
        setAnalyzingProgress(`Đang phân tích video ${i + 1}/${valid.length}: ${selected.name}`);
        try {
          const frame = await grabBestVideoPreviewFrame(selected);
          const baseBox = getVideoWatermarkBase(frame.width, frame.height);
          const detection = detectVideoWatermark(frame.imageData, frame.width, frame.height, bg96);
          const thumbUrl = imageDataToThumbUrl(frame.imageData);

          added.push({
            id: `vid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            file: selected,
            name: selected.name,
            thumbUrl,
            previewFrame: frame,
            baseBox,
            detection,
            presetKey: detection.presetKey,
            tuner: {
              gain: detection.gain,
              offsetX: detection.offsetX,
              offsetY: detection.offsetY,
              sizeScale: detection.sizeScale,
            },
            status: 'idle',
            progressPct: 0,
            framesDone: 0,
            phaseLabel: '',
          });
        } catch (err) {
          onNotify(
            `Không đọc được "${selected.name}": ${err instanceof Error ? err.message : 'Lỗi file'}`
          );
        }
      }

      if (added.length > 0) {
        setEntries((prev) => [...prev, ...added]);
        setActiveId((prev) => prev ?? added[0].id);
        setViewMode('tuner');
        onNotify(
          added.length === 1
            ? `Đã tải & tự nhận diện logo cho "${added[0].name}"!`
            : `Đã thêm ${added.length} video vào hàng đợi và tự nhận diện logo cho từng video!`
        );
      }
    } finally {
      setIsAnalyzing(false);
      setAnalyzingProgress('');
    }
  };

  // Live 60fps Preview Frame + Dual Zoomed Comparison Canvas for Active Video!
  useEffect(() => {
    if (!activeEntry || viewMode !== 'tuner') return;
    let cancelled = false;

    const renderLive = async () => {
      if (!bg96Ref.current) {
        const { bg96 } = await loadReferenceMasks();
        bg96Ref.current = bg96;
      }
      if (cancelled || !bg96Ref.current) return;

      const { previewFrame, baseBox, tuner } = activeEntry;
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
  }, [activeEntry, viewMode, showGuideBox]);

  // Drag guide box directly on active video frame
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current || !frameBoxRef.current || !activeEntry) return;
      const rect = frameBoxRef.current.getBoundingClientRect();
      const { startX, startY, initOffX, initOffY } = dragRef.current;
      const dx = Math.round(((e.clientX - startX) / rect.width) * activeEntry.previewFrame.width);
      const dy = Math.round(((e.clientY - startY) / rect.height) * activeEntry.previewFrame.height);
      updateEntry(activeEntry.id, {
        tuner: { ...activeEntry.tuner, offsetX: initOffX + dx, offsetY: initOffY + dy },
      });
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
  }, [activeEntry, updateEntry]);

  const updateActiveTuner = (patch: Partial<TunerParams>, nextPreset?: VideoPresetKey) => {
    if (!activeEntry) return;
    updateEntry(activeEntry.id, {
      tuner: { ...activeEntry.tuner, ...patch },
      presetKey: nextPreset ?? activeEntry.presetKey,
    });
  };

  const handleApplyPreset = (key: VideoPresetKey) => {
    if (!activeEntry) return;
    const p = getAdaptiveVideoPreset(key, activeEntry.previewFrame.width, activeEntry.previewFrame.height);
    updateActiveTuner(p, key);
  };

  const handleSyncSettingsToAll = () => {
    if (!activeEntry || entries.length <= 1) return;
    setEntries((prev) =>
      prev.map((it) => ({
        ...it,
        presetKey: activeEntry.presetKey,
        tuner: { ...activeEntry.tuner },
      }))
    );
    onNotify(`Đã đồng bộ thông số Live Tuner cho toàn bộ ${entries.length} video!`);
  };

  const handleAutoDetectAgain = async () => {
    if (!activeEntry) return;
    const { bg96 } = await loadReferenceMasks();
    const det = detectVideoWatermark(
      activeEntry.previewFrame.imageData,
      activeEntry.previewFrame.width,
      activeEntry.previewFrame.height,
      bg96
    );
    updateEntry(activeEntry.id, {
      detection: det,
      presetKey: det.presetKey,
      tuner: {
        gain: det.gain,
        offsetX: det.offsetX,
        offsetY: det.offsetY,
        sizeScale: det.sizeScale,
      },
    });
    onNotify(`Auto-Detect: ${det.name} (${Math.round(det.score * 100)}% khớp)`);
  };

  const handleAutoGain = async () => {
    if (!activeEntry) return;
    const { bg96 } = await loadReferenceMasks();
    const wm = resolveWatermarkBox(
      activeEntry.baseBox,
      activeEntry.previewFrame.width,
      activeEntry.previewFrame.height,
      activeEntry.tuner
    );
    const optimal = estimateOptimalGain(
      activeEntry.previewFrame.imageData,
      activeEntry.previewFrame.width,
      activeEntry.previewFrame.height,
      bg96,
      wm,
      activeEntry.tuner.gain
    );
    updateActiveTuner({ gain: optimal });
    onNotify(`Đã tối ưu Độ mạnh Alpha: ${optimal.toFixed(2)}x`);
  };

  const processListSequentially = async (targets: VideoQueueEntry[]) => {
    if (targets.length === 0) return;
    setIsExportingBatch(true);
    setBatchCounter({ current: 1, total: targets.length });

    const controller = new AbortController();
    abortRef.current = controller;

    let completed = 0;

    for (let i = 0; i < targets.length; i++) {
      if (controller.signal.aborted) break;
      const item = targets[i];
      setBatchCounter({ current: i + 1, total: targets.length });
      setActiveId(item.id);

      // Revoke old result URLs if re-exporting
      if (item.result) {
        URL.revokeObjectURL(item.result.url);
        URL.revokeObjectURL(item.result.originalUrl);
      }

      updateEntry(item.id, {
        status: 'processing',
        progressPct: 0,
        framesDone: 0,
        phaseLabel: 'Đang khởi tạo WebCodecs H.264...',
        errorMessage: undefined,
      });

      try {
        const res = await exportCleanedVideoMp4(
          item.file,
          item.tuner,
          (pct, count, phase) => {
            updateEntry(item.id, {
              progressPct: pct,
              framesDone: count,
              phaseLabel: phase,
            });
          },
          controller.signal
        );
        updateEntry(item.id, {
          status: 'done',
          progressPct: 100,
          result: res,
          phaseLabel: 'Hoàn tất!',
        });
        completed++;
      } catch (err) {
        if (controller.signal.aborted) {
          updateEntry(item.id, { status: 'idle', progressPct: 0, phaseLabel: 'Đã dừng' });
          break;
        }
        updateEntry(item.id, {
          status: 'error',
          errorMessage: err instanceof Error ? err.message : 'Lỗi xử lý video',
          phaseLabel: 'Lỗi xử lý',
        });
      }
    }

    setIsExportingBatch(false);
    setBatchCounter(null);
    abortRef.current = null;

    if (completed > 0) {
      setViewMode('result');
      onNotify(
        targets.length === 1
          ? 'Đã xuất video MP4 sạch thành công (giữ nguyên âm thanh gốc)!'
          : `Đã xử lý xong hàng loạt ${completed}/${targets.length} video MP4 sạch!`
      );
    }
  };

  const handleExportCurrent = () => {
    if (!activeEntry) return;
    void processListSequentially([activeEntry]);
  };

  const handleExportAllPending = () => {
    const pending = entries.filter((e) => e.status !== 'done');
    const targets = pending.length > 0 ? pending : entries;
    void processListSequentially(targets);
  };

  const handleDownloadSingle = (entry: VideoQueueEntry) => {
    if (!entry.result) return;
    const baseName = entry.name.replace(/\.[^.]+$/, '');
    const a = document.createElement('a');
    a.href = entry.result.url;
    a.download = `clean_${baseName}.mp4`;
    a.click();
  };

  const handleDownloadAllZip = async () => {
    const doneEntries = entries.filter((e) => e.status === 'done' && e.result);
    if (doneEntries.length === 0) return;

    setIsZipping(true);
    try {
      const zip = new JSZip();
      for (const entry of doneEntries) {
        const baseName = entry.name.replace(/\.[^.]+$/, '');
        // STORE (no re-compression) makes zipping MP4 videos instantaneous!
        zip.file(`clean_${baseName}.mp4`, entry.result!.blob, { compression: 'STORE' });
      }
      const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `AuraErase_Clean_${doneEntries.length}_Videos.zip`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 6000);
      onNotify(`Đã tải gói ZIP gồm ${doneEntries.length} video MP4 sạch!`);
    } finally {
      setIsZipping(false);
    }
  };

  const handleRemoveEntry = (id: string) => {
    setEntries((prev) => {
      const target = prev.find((e) => e.id === id);
      if (target?.result) {
        URL.revokeObjectURL(target.result.url);
        URL.revokeObjectURL(target.result.originalUrl);
      }
      const next = prev.filter((e) => e.id !== id);
      if (activeId === id) {
        setActiveId(next[0]?.id ?? null);
      }
      if (next.length === 0) setViewMode('tuner');
      return next;
    });
  };

  const doneCount = entries.filter((e) => e.status === 'done').length;

  // Empty Video Dropzone
  if (!activeEntry) {
    return (
      <section className="dropzone-stage">
        <div className="hero-header">
          <div className="hero-pill">
            <Film size={14} />
            <span>Hỗ trợ Hàng Loạt Nhiều Video · WebCodecs H.264 MP4 · Giữ 100% Âm Thanh</span>
          </div>
          <h1 className="hero-title">
            Xóa Logo <span>Video Omni &amp; Veo 3</span> hàng loạt
          </h1>
          <p className="hero-desc">
            Kéo thả <strong>1 hoặc nhiều video cùng lúc</strong> (Gemini Omni, Google Flow, Veo 3).
            Tự động nhận diện logo cho từng video, chỉnh Live Tuner 60fps rồi chạy hàng đợi xuất{' '}
            <strong>MP4 H.264</strong> giữ nguyên âm thanh gốc &amp; tải về trọn bộ <strong>ZIP</strong>.
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
            if (e.dataTransfer.files?.length) void handleVideoFiles(e.dataTransfer.files);
          }}
        >
          <input
            type="file"
            accept="video/*"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files?.length) void handleVideoFiles(e.target.files);
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
                ? analyzingProgress || 'Đang phân tích khung hình & tự nhận diện logo...'
                : 'Kéo thả 1 hoặc nhiều Video AI vào đây'}
            </div>
            <div style={{ fontSize: 13.5, color: 'var(--text-secondary)' }}>
              Chọn cùng lúc nhiều file MP4 / WebM / MOV · Xuất hàng loạt + tải ZIP tức thì
            </div>
          </div>
          <div className="format-chips">
            <span className="format-chip">Batch Multi-Video</span>
            <span className="format-chip">Gemini Omni</span>
            <span className="format-chip">Google Flow / Veo 3</span>
            <span className="format-chip">MP4 H.264 + Audio Passthrough</span>
          </div>
        </label>

        <div className="feature-strip">
          <div className="feature-item">
            <Layers size={15} color="#c084fc" />
            <span>Hàng đợi thông minh — Xử lý liên tục nhiều video</span>
          </div>
          <div className="feature-item">
            <Volume2 size={15} color="#34d399" />
            <span>Giữ nguyên 100% âm thanh gốc</span>
          </div>
          <div className="feature-item">
            <ShieldCheck size={15} color="#38bdf8" />
            <span>
              {isWebCodecsVideoSupported()
                ? 'Trình duyệt đã sẵn sàng tăng tốc WebCodecs'
                : 'Khuyên dùng Chrome / Edge desktop'}
            </span>
          </div>
        </div>
      </section>
    );
  }

  const wm = resolveWatermarkBox(
    activeEntry.baseBox,
    activeEntry.previewFrame.width,
    activeEntry.previewFrame.height,
    activeEntry.tuner
  );
  const offXMin = -Math.round(activeEntry.previewFrame.width * 0.45);
  const offXMax = Math.round(activeEntry.previewFrame.width * 0.25);
  const offYMin = -Math.round(activeEntry.previewFrame.height * 0.45);
  const offYMax = Math.round(activeEntry.previewFrame.height * 0.25);

  return (
    <>
      <input
        ref={addMoreInputRef}
        type="file"
        accept="video/*"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files?.length) void handleVideoFiles(e.target.files);
          e.target.value = '';
        }}
      />

      <div className="studio-grid">
        {/* Left Main Stage: Either Live Tuner OR Completed Side-by-Side Player */}
        <div className="canvas-stage-panel glass-panel">
          <div className="tuner-status-strip">
            <div className="detect-pill">
              <Scan size={14} color={activeEntry.detection.matchFound ? '#34d399' : '#fbbf24'} />
              <span>
                <strong>{activeEntry.name}</strong> ·{' '}
                {activeEntry.detection.matchFound ? (
                  <span style={{ color: '#34d399' }}>
                    {activeEntry.detection.name} ({Math.round(activeEntry.detection.score * 100)}%)
                  </span>
                ) : (
                  <span>{activeEntry.detection.name}</span>
                )}
              </span>
            </div>

            <div className="hud-group">
              {activeEntry.result && (
                <button
                  type="button"
                  className={`hud-btn ${viewMode === 'result' ? 'active' : ''}`}
                  onClick={() => setViewMode((m) => (m === 'result' ? 'tuner' : 'result'))}
                >
                  <Play size={14} />
                  <span>{viewMode === 'result' ? 'Về Live Tuner' : 'Xem Video Đã Xóa'}</span>
                </button>
              )}
              {viewMode === 'tuner' && (
                <button
                  type="button"
                  className={`hud-btn ${showGuideBox ? 'active' : ''}`}
                  onClick={() => setShowGuideBox((v) => !v)}
                >
                  <Focus size={14} />
                  <span>Khung vị trí</span>
                </button>
              )}
              <button
                type="button"
                className="hud-btn"
                disabled={isAnalyzing || isExportingBatch}
                onClick={() => addMoreInputRef.current?.click()}
              >
                <Plus size={14} />
                <span>Thêm video</span>
              </button>
            </div>
          </div>

          {viewMode === 'result' && activeEntry.result ? (
            <div style={{ padding: 20, flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="video-compare-grid">
                <div className="video-result-box">
                  <div className="zoom-card-head">
                    <span className="dot blue" />
                    <span>Video Gốc (Có Logo)</span>
                  </div>
                  <video src={activeEntry.result.originalUrl} controls playsInline />
                </div>
                <div className="video-result-box clean">
                  <div className="zoom-card-head">
                    <span className="dot green" />
                    <span>Video Sau Khi Xóa Logo (MP4 Sạch)</span>
                  </div>
                  <video src={activeEntry.result.url} controls playsInline />
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
                <button
                  type="button"
                  className="btn btn-success"
                  onClick={() => handleDownloadSingle(activeEntry)}
                >
                  <Download size={16} />
                  <span>Tải video này (.MP4)</span>
                </button>
                {doneCount >= 2 && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={isZipping}
                    onClick={() => void handleDownloadAllZip()}
                  >
                    {isZipping ? <Loader2 size={15} className="spin" /> : <Download size={15} />}
                    <span>Tải tất cả {doneCount} video (ZIP)</span>
                  </button>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="canvas-viewport" style={{ padding: 20 }}>
                <div
                  ref={frameBoxRef}
                  className="canvas-frame-wrapper"
                  style={{
                    width: 'min(100%, 840px)',
                    aspectRatio: `${activeEntry.previewFrame.width} / ${activeEntry.previewFrame.height}`,
                  }}
                >
                  {cleanedFrameUrl && (
                    <img
                      src={cleanedFrameUrl}
                      alt={activeEntry.name}
                      className="canvas-img"
                      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                    />
                  )}

                  {showGuideBox && (
                    <div
                      className="roi-box"
                      style={{
                        left: `${(wm.x / activeEntry.previewFrame.width) * 100}%`,
                        top: `${(wm.y / activeEntry.previewFrame.height) * 100}%`,
                        width: `${(wm.width / activeEntry.previewFrame.width) * 100}%`,
                        height: `${(wm.height / activeEntry.previewFrame.height) * 100}%`,
                      }}
                      title="Kéo khung để căn chuẩn vị trí logo video"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        dragRef.current = {
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
            </>
          )}
        </div>

        {/* Right Video Controls */}
        <aside className="inspector-panel glass-panel">
          <div className="inspector-section">
            <div className="section-label">
              <span>Model Preset Video</span>
            </div>
            <div className="algo-list">
              <button
                type="button"
                className={`algo-pill ${activeEntry.presetKey === 'veo' ? 'active' : ''}`}
                onClick={() => handleApplyPreset('veo')}
              >
                <strong>Omni / Veo 3</strong>
                <span>Inset chuẩn</span>
              </button>
              <button
                type="button"
                className={`algo-pill ${activeEntry.presetKey === 'corner' ? 'active' : ''}`}
                onClick={() => handleApplyPreset('corner')}
              >
                <strong>Flow Corner</strong>
                <span>Sát góc</span>
              </button>
              <button
                type="button"
                className={`algo-pill ${activeEntry.presetKey === 'sparkle' ? 'active' : ''}`}
                onClick={() => handleApplyPreset('sparkle')}
              >
                <strong>Sparkle</strong>
                <span>Kiểu ảnh</span>
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: entries.length > 1 ? '1fr 1fr' : '1fr', gap: 8, marginTop: 4 }}>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ padding: '8px 10px', fontSize: 12 }}
                onClick={() => void handleAutoDetectAgain()}
              >
                <Scan size={14} color="var(--accent-2)" />
                <span>Auto-Detect</span>
              </button>

              {entries.length > 1 && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ padding: '8px 10px', fontSize: 12 }}
                  onClick={handleSyncSettingsToAll}
                  title="Áp dụng thông số slider hiện tại cho tất cả video trong hàng đợi"
                >
                  <CopyCheck size={14} color="#34d399" />
                  <span>Đồng bộ tất cả</span>
                </button>
              )}
            </div>
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

          <div className="metrics-card">
            <div className="metrics-row">
              <span>Độ phân giải</span>
              <span>
                {activeEntry.previewFrame.width}×{activeEntry.previewFrame.height} ·{' '}
                {activeEntry.previewFrame.duration.toFixed(1)}s
              </span>
            </div>
            <div className="metrics-row">
              <span>Tiến độ hàng đợi</span>
              <span>
                {doneCount}/{entries.length} video sạch
              </span>
            </div>
          </div>

          {isExportingBatch && (
            <div className="inspector-section">
              <div className="slider-header">
                <span style={{ fontSize: 11.5 }}>
                  {batchCounter && batchCounter.total > 1
                    ? `Video ${batchCounter.current}/${batchCounter.total} · `
                    : ''}
                  {activeEntry.phaseLabel || 'Đang xử lý...'}
                </span>
                <span className="slider-val">{activeEntry.progressPct}%</span>
              </div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${activeEntry.progressPct}%` }} />
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                Đã khử {activeEntry.framesDone} khung hình · Giữ tab mở để đạt tốc độ tối đa
              </div>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 'auto' }}>
            {!isExportingBatch ? (
              <>
                {entries.length > 1 ? (
                  <button
                    type="button"
                    className="btn btn-primary btn-lg"
                    onClick={handleExportAllPending}
                  >
                    <Zap size={17} />
                    <span>
                      {doneCount === entries.length
                        ? `Xuất lại toàn bộ (${entries.length} video)`
                        : `Xóa Logo Hàng Loạt (${entries.length - doneCount} video)`}
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary btn-lg"
                    onClick={handleExportCurrent}
                  >
                    <Sparkles size={17} />
                    <span>
                      {activeEntry.result ? 'Xuất lại Video này (.MP4)' : 'Xuất Video MP4 Sạch'}
                    </span>
                  </button>
                )}

                {entries.length > 1 && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-lg"
                    onClick={handleExportCurrent}
                  >
                    <Sparkles size={15} />
                    <span>Chỉ xuất video đang chọn</span>
                  </button>
                )}
              </>
            ) : (
              <button
                type="button"
                className="btn btn-ghost btn-lg"
                onClick={() => abortRef.current?.abort()}
              >
                <StopCircle size={17} color="#f87171" />
                <span>Dừng hàng đợi</span>
              </button>
            )}

            {activeEntry.result && !isExportingBatch && (
              <button
                type="button"
                className="btn btn-success btn-lg"
                onClick={() => handleDownloadSingle(activeEntry)}
              >
                <Download size={16} />
                <span>Tải Video Này (.MP4)</span>
              </button>
            )}

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                fontSize: 11,
                color: 'var(--text-muted)',
              }}
            >
              <Wand2 size={12} />
              <span>Hàng đợi tự chạy lần lượt để không tràn RAM/GPU</span>
            </div>
          </div>
        </aside>
      </div>

      {/* Multi-Video Queue Filmstrip Bar */}
      <div className="filmstrip-bar glass-panel">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <Layers size={16} color="var(--accent-2)" />
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600 }}>Hàng đợi Video ({entries.length})</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
              Hoàn tất: {doneCount}/{entries.length}
            </div>
          </div>
        </div>

        <div className="filmstrip-list">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className={`thumb-item video-thumb-item ${entry.id === activeEntry.id ? 'active' : ''}`}
              onClick={() => {
                setActiveId(entry.id);
                if (!entry.result && viewMode === 'result') setViewMode('tuner');
              }}
              title={`${entry.name} (${entry.previewFrame.width}×${entry.previewFrame.height})`}
            >
              <img src={entry.thumbUrl} alt={entry.name} />
              <span className="video-thumb-dur">{entry.previewFrame.duration.toFixed(0)}s</span>

              {!isExportingBatch && (
                <button
                  type="button"
                  className="thumb-remove"
                  title="Xóa khỏi hàng đợi"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveEntry(entry.id);
                  }}
                >
                  <X size={11} />
                </button>
              )}

              {entry.status === 'done' && (
                <span className="thumb-status">
                  <CheckCircle2 size={13} color="#34d399" />
                </span>
              )}
              {entry.status === 'processing' && (
                <span className="thumb-status" style={{ width: 'auto', padding: '0 5px', fontSize: 9.5, fontWeight: 700, color: '#38bdf8' }}>
                  {entry.progressPct}%
                </span>
              )}
            </div>
          ))}

          <button
            type="button"
            className="thumb-add-btn"
            disabled={isAnalyzing || isExportingBatch}
            onClick={() => addMoreInputRef.current?.click()}
            title="Thêm nhiều video vào hàng đợi"
          >
            {isAnalyzing ? <Loader2 size={16} className="spin" /> : <Plus size={18} />}
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {doneCount >= 2 && !isExportingBatch && (
            <button
              type="button"
              className="btn btn-success"
              disabled={isZipping}
              onClick={() => void handleDownloadAllZip()}
            >
              {isZipping ? <Loader2 size={15} className="spin" /> : <Download size={15} />}
              <span>Tải tất cả ZIP ({doneCount})</span>
            </button>
          )}
        </div>
      </div>
    </>
  );
};
