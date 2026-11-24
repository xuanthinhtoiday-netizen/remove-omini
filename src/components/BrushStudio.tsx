import {
  Download,
  Eye,
  Loader2,
  Paintbrush,
  RotateCcw,
  Sparkles,
  Trash2,
  Undo2,
  UploadCloud,
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { inpaintMaskRegion } from '../engine/inpaintEngine';
import type { BrushStroke } from '../types';

interface BrushStudioProps {
  onNotify: (msg: string) => void;
}

export const BrushStudio: React.FC<BrushStudioProps> = ({ onNotify }) => {
  const [source, setSource] = useState<{ url: string; name: string; width: number; height: number } | null>(null);
  const [cleanedUrl, setCleanedUrl] = useState<string | null>(null);
  const [strokes, setStrokes] = useState<BrushStroke[]>([]);
  const [brushSize, setBrushSize] = useState(28);
  const [textureRefine, setTextureRefine] = useState(true);
  const [peeking, setPeeking] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);
  const activeStrokeRef = useRef<BrushStroke | null>(null);

  const handleFile = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      if (source) URL.revokeObjectURL(source.url);
      setSource({ url, name: file.name, width: img.naturalWidth, height: img.naturalHeight });
      setCleanedUrl(null);
      setStrokes([]);
    };
    img.src = url;
  };

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !source) return;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(244, 63, 94, 0.56)';
    ctx.fillStyle = 'rgba(244, 63, 94, 0.56)';

    for (const st of strokes) {
      if (st.points.length === 0) continue;
      if (st.points.length === 1) {
        ctx.beginPath();
        ctx.arc(st.points[0].x, st.points[0].y, st.radius, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.lineWidth = st.radius * 2;
        ctx.beginPath();
        ctx.moveTo(st.points[0].x, st.points[0].y);
        for (let i = 1; i < st.points.length; i++) ctx.lineTo(st.points[i].x, st.points[i].y);
        ctx.stroke();
      }
    }
  }, [strokes, source]);

  const toImgCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * (source?.width ?? 1),
      y: ((e.clientY - rect.top) / rect.height) * (source?.height ?? 1),
    };
  };

  const handleErase = async () => {
    if (!source || strokes.length === 0) return;
    setIsProcessing(true);
    await new Promise((r) => requestAnimationFrame(r));

    try {
      const img = new Image();
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej();
        img.src = cleanedUrl ?? source.url;
      });

      const work = document.createElement('canvas');
      work.width = source.width;
      work.height = source.height;
      const ctx = work.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0);

      let minX = source.width,
        minY = source.height,
        maxX = 0,
        maxY = 0;
      for (const s of strokes) {
        for (const p of s.points) {
          minX = Math.min(minX, Math.floor(p.x - s.radius - 4));
          minY = Math.min(minY, Math.floor(p.y - s.radius - 4));
          maxX = Math.max(maxX, Math.ceil(p.x + s.radius + 4));
          maxY = Math.max(maxY, Math.ceil(p.y + s.radius + 4));
        }
      }
      minX = Math.max(0, minX);
      minY = Math.max(0, minY);
      maxX = Math.min(source.width, maxX);
      maxY = Math.min(source.height, maxY);

      const rw = Math.max(1, maxX - minX);
      const rh = Math.max(1, maxY - minY);

      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = rw;
      maskCanvas.height = rh;
      const mCtx = maskCanvas.getContext('2d')!;
      mCtx.fillStyle = '#000';
      mCtx.fillRect(0, 0, rw, rh);
      mCtx.strokeStyle = '#fff';
      mCtx.fillStyle = '#fff';
      mCtx.lineCap = 'round';
      mCtx.lineJoin = 'round';

      for (const s of strokes) {
        if (s.points.length === 1) {
          mCtx.beginPath();
          mCtx.arc(s.points[0].x - minX, s.points[0].y - minY, s.radius, 0, Math.PI * 2);
          mCtx.fill();
        } else if (s.points.length > 1) {
          mCtx.lineWidth = s.radius * 2;
          mCtx.beginPath();
          mCtx.moveTo(s.points[0].x - minX, s.points[0].y - minY);
          for (let i = 1; i < s.points.length; i++) {
            mCtx.lineTo(s.points[i].x - minX, s.points[i].y - minY);
          }
          mCtx.stroke();
        }
      }

      const mData = mCtx.getImageData(0, 0, rw, rh).data;
      const mask = new Uint8Array(rw * rh);
      for (let i = 0; i < rw * rh; i++) {
        if (mData[i * 4] > 100) mask[i] = 1;
      }

      const imgData = ctx.getImageData(0, 0, source.width, source.height);
      inpaintMaskRegion(imgData, { x: minX, y: minY, width: rw, height: rh }, mask, {
        textureRefine,
        featherRadius: 2,
      });
      ctx.putImageData(imgData, 0, 0);

      setCleanedUrl(work.toDataURL('image/png'));
      setStrokes([]);
      onNotify('Đã tẩy sạch vùng đã tô!');
    } finally {
      setIsProcessing(false);
    }
  };

  if (!source) {
    return (
      <section className="dropzone-stage">
        <div className="hero-header">
          <div className="hero-pill">
            <Paintbrush size={14} />
            <span>Magic Brush · Tái tạo vân ảnh thông minh</span>
          </div>
          <h1 className="hero-title">
            Tẩy <span>Logo &amp; Chữ Ký</span> bất kỳ bằng cọ vẽ
          </h1>
          <p className="hero-desc">
            Dùng cho các watermark đặc biệt (chữ mờ, logo góc lạ, vật thể thừa). Tô lên vùng muốn xóa
            và để thuật toán tái tạo nền tự nhiên xử lý ngay trên máy.
          </p>
        </div>

        <label className="dropzone-card glass-panel">
          <input
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = '';
            }}
          />
          <div className="dropzone-visual">
            <UploadCloud size={34} color="var(--accent-2)" />
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>
              Chọn ảnh cần tẩy tự do
            </div>
            <div style={{ fontSize: 13.5, color: 'var(--text-secondary)' }}>
              Hỗ trợ PNG · JPG · WebP
            </div>
          </div>
        </label>
      </section>
    );
  }

  return (
    <div className="studio-grid">
      <div className="canvas-stage-panel glass-panel">
        <div className="canvas-viewport">
          <div
            className="canvas-frame-wrapper"
            style={{
              width: 'min(100%, 880px)',
              aspectRatio: `${source.width} / ${source.height}`,
            }}
          >
            <img
              src={peeking || !cleanedUrl ? source.url : cleanedUrl}
              alt={source.name}
              className="canvas-img"
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
            <canvas
              ref={canvasRef}
              width={source.width}
              height={source.height}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                cursor: 'crosshair',
                touchAction: 'none',
              }}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                isDrawingRef.current = true;
                const st: BrushStroke = { points: [toImgCoords(e)], radius: brushSize };
                activeStrokeRef.current = st;
                setStrokes((p) => [...p, st]);
              }}
              onPointerMove={(e) => {
                if (!isDrawingRef.current || !activeStrokeRef.current) return;
                const next: BrushStroke = {
                  ...activeStrokeRef.current,
                  points: [...activeStrokeRef.current.points, toImgCoords(e)],
                };
                activeStrokeRef.current = next;
                setStrokes((p) => [...p.slice(0, -1), next]);
              }}
              onPointerUp={() => {
                isDrawingRef.current = false;
                activeStrokeRef.current = null;
              }}
            />
          </div>
        </div>

        <div className="canvas-hud">
          <div className="hud-group">
            <button
              type="button"
              className="hud-btn"
              disabled={strokes.length === 0}
              onClick={() => setStrokes((p) => p.slice(0, -1))}
            >
              <Undo2 size={14} />
              <span>Hoàn tác nét</span>
            </button>
            <button
              type="button"
              className="hud-btn"
              disabled={strokes.length === 0}
              onClick={() => setStrokes([])}
            >
              <Trash2 size={14} />
              <span>Xóa nét</span>
            </button>
          </div>
          <div className="hud-group">
            {cleanedUrl && (
              <>
                <button
                  type="button"
                  className={`hud-btn ${peeking ? 'active' : ''}`}
                  onPointerDown={() => setPeeking(true)}
                  onPointerUp={() => setPeeking(false)}
                  onPointerLeave={() => setPeeking(false)}
                >
                  <Eye size={14} />
                  <span>Giữ xem gốc</span>
                </button>
                <button type="button" className="hud-btn" onClick={() => setCleanedUrl(null)}>
                  <RotateCcw size={14} />
                  <span>Làm lại</span>
                </button>
              </>
            )}
            <label className="hud-btn" style={{ cursor: 'pointer' }}>
              <UploadCloud size={14} />
              <span>Ảnh khác</span>
              <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
        </div>
      </div>

      <aside className="inspector-panel glass-panel">
        <div className="mode-info-banner">
          <Paintbrush size={18} color="var(--accent-2)" style={{ marginTop: 2 }} />
          <div>
            <h4>Tẩy Logo Tự Do</h4>
            <p>Tô phủ kín lên chữ hoặc logo cần xóa trên ảnh, sau đó bấm Xóa Vùng Đã Tô.</p>
          </div>
        </div>

        <div className="inspector-section">
          <div className="slider-row">
            <div className="slider-header">
              <span>Kích thước cọ</span>
              <span className="slider-val">{brushSize}px</span>
            </div>
            <input
              type="range"
              min={8}
              max={90}
              value={brushSize}
              className="studio-slider"
              onChange={(e) => setBrushSize(Number(e.target.value))}
            />
          </div>

          <div className="toggle-row" style={{ marginTop: 6 }}>
            <span>Tái tạo vân ảnh (Patch Texture)</span>
            <button
              type="button"
              role="switch"
              aria-checked={textureRefine}
              className={`switch ${textureRefine ? 'on' : ''}`}
              onClick={() => setTextureRefine((v) => !v)}
            >
              <span className="switch-knob" />
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 'auto' }}>
          <button
            type="button"
            className="btn btn-primary btn-lg"
            disabled={isProcessing || strokes.length === 0}
            onClick={() => void handleErase()}
          >
            {isProcessing ? <Loader2 size={17} className="spin" /> : <Sparkles size={17} />}
            <span>{isProcessing ? 'Đang tẩy...' : 'Xóa Vùng Đã Tô'}</span>
          </button>

          {cleanedUrl && (
            <a
              href={cleanedUrl}
              download={`clean_${source.name.replace(/\.[^.]+$/, '')}.png`}
              className="btn btn-success btn-lg"
              style={{ textDecoration: 'none' }}
            >
              <Download size={16} />
              <span>Tải Ảnh Sạch (.PNG)</span>
            </a>
          )}
        </div>
      </aside>
    </div>
  );
};
