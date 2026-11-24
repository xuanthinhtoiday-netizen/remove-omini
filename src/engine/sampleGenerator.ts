import { getAdaptiveImagePreset, getImageWatermarkBase, resolveWatermarkBox } from './coreRemover';
import { loadReferenceMasks } from './referenceMasks';

/**
 * Generates realistic high-res sample images stamped using the ACTUAL captured
 * Google Gemini / Nano Banana / Omni sparkle alpha mask (bg_96.png) so users
 * can test 100% lossless pixel-perfect reverse-alpha recovery immediately!
 */
export async function generateAuthenticSample(kind: 'gemini-new' | 'gemini-classic'): Promise<{
  file: File;
  dataUrl: string;
  name: string;
  width: number;
  height: number;
}> {
  const width = 1536;
  const height = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  if (kind === 'gemini-new') {
    drawCyberpunkNeonScene(ctx, width, height);
  } else {
    drawAuroraMountainScene(ctx, width, height);
  }

  // Stamp real captured bg_96 mask using exact forward alpha compositing:
  // Watermarked = alpha * 255 + (1 - alpha) * Original
  const { bg96 } = await loadReferenceMasks();
  const base = getImageWatermarkBase(width, height);
  const preset = getAdaptiveImagePreset(kind === 'gemini-new' ? 'new' : 'classic', width, height);
  const wm = resolveWatermarkBox(base, width, height, preset);

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = wm.size;
  maskCanvas.height = wm.size;
  const mCtx = maskCanvas.getContext('2d', { willReadFrequently: true })!;
  mCtx.imageSmoothingEnabled = true;
  mCtx.imageSmoothingQuality = 'high';
  mCtx.drawImage(bg96, 0, 0, wm.size, wm.size);
  const maskData = mCtx.getImageData(0, 0, wm.size, wm.size).data;

  const targetData = ctx.getImageData(wm.x, wm.y, wm.size, wm.size);
  const d = targetData.data;

  for (let i = 0; i < wm.size * wm.size; i++) {
    const o = i * 4;
    const rawA = Math.max(maskData[o], maskData[o + 1], maskData[o + 2]) / 255.0;
    const alpha = Math.min(0.99, rawA * preset.gain);
    if (alpha <= 0.002) continue;
    d[o] = Math.round(alpha * 255 + (1 - alpha) * d[o]);
    d[o + 1] = Math.round(alpha * 255 + (1 - alpha) * d[o + 1]);
    d[o + 2] = Math.round(alpha * 255 + (1 - alpha) * d[o + 2]);
  }
  ctx.putImageData(targetData, wm.x, wm.y);

  const name =
    kind === 'gemini-new' ? 'gemini_nano_banana_sample.png' : 'gemini_omni_classic_sample.png';
  const blob = await new Promise<Blob>((resolve) =>
    canvas.toBlob((b) => resolve(b!), 'image/png')
  );
  const file = new File([blob], name, { type: 'image/png' });
  const dataUrl = canvas.toDataURL('image/png');

  return { file, dataUrl, name, width, height };
}

function drawCyberpunkNeonScene(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#070b1e');
  sky.addColorStop(0.45, '#19143a');
  sky.addColorStop(0.78, '#38184c');
  sky.addColorStop(1, '#12182b');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  const orb = ctx.createRadialGradient(w * 0.68, h * 0.34, 15, w * 0.68, h * 0.34, 280);
  orb.addColorStop(0, 'rgba(255, 196, 155, 0.95)');
  orb.addColorStop(0.35, 'rgba(255, 92, 168, 0.65)');
  orb.addColorStop(0.7, 'rgba(116, 62, 255, 0.18)');
  orb.addColorStop(1, 'rgba(116, 62, 255, 0)');
  ctx.fillStyle = orb;
  ctx.fillRect(0, 0, w, h);

  const cornerGlow = ctx.createRadialGradient(w * 0.86, h * 0.86, 20, w * 0.86, h * 0.86, 420);
  cornerGlow.addColorStop(0, 'rgba(34, 211, 238, 0.42)');
  cornerGlow.addColorStop(0.55, 'rgba(99, 102, 241, 0.2)');
  cornerGlow.addColorStop(1, 'rgba(15, 23, 42, 0)');
  ctx.fillStyle = cornerGlow;
  ctx.fillRect(0, 0, w, h);

  for (let i = 0; i < 150; i++) {
    const sx = ((i * 197.3) % 1) * w;
    const sy = ((i * 83.7) % 1) * h * 0.52;
    ctx.fillStyle = `rgba(255,255,255,${0.25 + (i % 5) * 0.14})`;
    ctx.beginPath();
    ctx.arc(sx, sy, (i % 3) * 0.6 + 0.6, 0, Math.PI * 2);
    ctx.fill();
  }

  const horizonY = h * 0.72;
  for (let bx = 0; bx < w; bx += 135) {
    const bw = 115 + ((bx * 31) % 45);
    const bh = 250 + ((bx * 73) % 240);
    const topY = horizonY - bh;
    const bGrad = ctx.createLinearGradient(bx, topY, bx, horizonY);
    bGrad.addColorStop(0, '#141730');
    bGrad.addColorStop(1, '#090c1a');
    ctx.fillStyle = bGrad;
    ctx.fillRect(bx, topY, bw, bh);

    ctx.fillStyle = 'rgba(56, 189, 248, 0.28)';
    ctx.fillRect(bx, topY, 2, bh);

    for (let wy = topY + 20; wy < horizonY - 22; wy += 20) {
      for (let wx = bx + 14; wx < bx + bw - 18; wx += 18) {
        const hash = Math.sin(wx * 12.9898 + wy * 78.233) * 43758.5453;
        const frac = hash - Math.floor(hash);
        if (frac > 0.56) {
          ctx.fillStyle =
            frac > 0.88
              ? 'rgba(244, 114, 182, 0.8)'
              : frac > 0.72
              ? 'rgba(56, 189, 248, 0.76)'
              : 'rgba(253, 224, 71, 0.54)';
          ctx.fillRect(wx, wy, 8, 10);
        }
      }
    }
  }

  const roadGrad = ctx.createLinearGradient(0, horizonY, 0, h);
  roadGrad.addColorStop(0, '#13162b');
  roadGrad.addColorStop(0.5, '#1a2040');
  roadGrad.addColorStop(1, '#0d1328');
  ctx.fillStyle = roadGrad;
  ctx.fillRect(0, horizonY, w, h - horizonY);

  for (let y = horizonY + 8; y < h; y += 8) {
    ctx.fillStyle = `rgba(56, 189, 248, ${0.07 + 0.08 * Math.sin(y * 0.19)})`;
    ctx.fillRect(0, y, w, 2.5);
    ctx.fillStyle = `rgba(236, 72, 153, ${0.06 + 0.06 * Math.cos(y * 0.15)})`;
    ctx.fillRect(w * 0.3, y + 3, w * 0.7, 2);
  }

  ctx.lineWidth = 3;
  for (let i = -5; i <= 5; i++) {
    const grad = ctx.createLinearGradient(w * 0.5, horizonY, w * 0.5 + i * 280, h);
    grad.addColorStop(0, 'rgba(244, 114, 182, 0.08)');
    grad.addColorStop(1, i % 2 === 0 ? 'rgba(56, 189, 248, 0.58)' : 'rgba(192, 132, 252, 0.52)');
    ctx.strokeStyle = grad;
    ctx.beginPath();
    ctx.moveTo(w * 0.5 + i * 32, horizonY);
    ctx.lineTo(w * 0.5 + i * 310, h);
    ctx.stroke();
  }
}

function drawAuroraMountainScene(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#040b18');
  sky.addColorStop(0.5, '#072238');
  sky.addColorStop(0.75, '#0c2d42');
  sky.addColorStop(1, '#081524');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  for (let band = 0; band < 4; band++) {
    const grad = ctx.createLinearGradient(0, h * 0.06, w, h * 0.55);
    grad.addColorStop(0, 'rgba(16, 185, 129, 0)');
    grad.addColorStop(
      0.3,
      band % 2 === 0 ? 'rgba(52, 211, 153, 0.36)' : 'rgba(56, 189, 248, 0.3)'
    );
    grad.addColorStop(0.65, 'rgba(129, 140, 248, 0.28)');
    grad.addColorStop(1, 'rgba(16, 185, 129, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, h * (0.28 + band * 0.05));
    for (let x = 0; x <= w; x += 40) {
      const y =
        h * (0.2 + band * 0.055) +
        Math.sin(x * 0.0045 + band * 1.4) * 65 +
        Math.cos(x * 0.009 - band) * 26;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h * 0.62);
    ctx.lineTo(0, h * 0.62);
    ctx.closePath();
    ctx.fill();
  }

  for (let i = 0; i < 160; i++) {
    const sx = ((i * 271.1) % 1) * w;
    const sy = ((i * 113.3) % 1) * h * 0.56;
    ctx.fillStyle = `rgba(224, 242, 254, ${0.22 + (i % 4) * 0.18})`;
    ctx.beginPath();
    ctx.arc(sx, sy, 0.8 + (i % 3) * 0.45, 0, Math.PI * 2);
    ctx.fill();
  }

  const drawRange = (baseY: number, amp: number, freq: number, phase: number, fill: string) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += 16) {
      const ridge =
        Math.abs(Math.sin(x * freq + phase)) * amp +
        Math.sin(x * freq * 2.3 + phase * 1.7) * (amp * 0.3);
      ctx.lineTo(x, baseY - ridge);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
  };

  drawRange(h * 0.68, 210, 0.0038, 0.8, '#0c2338');
  drawRange(h * 0.74, 155, 0.005, 2.2, '#0a1c2e');

  const lakeY = h * 0.72;
  const lake = ctx.createLinearGradient(0, lakeY, 0, h);
  lake.addColorStop(0, '#0a253a');
  lake.addColorStop(0.5, '#0e364f');
  lake.addColorStop(1, '#071a2b');
  ctx.fillStyle = lake;
  ctx.fillRect(0, lakeY, w, h - lakeY);

  for (let y = lakeY + 6; y < h; y += 7) {
    ctx.fillStyle = `rgba(52, 211, 153, ${0.07 + 0.06 * Math.sin(y * 0.2)})`;
    ctx.fillRect(w * 0.08, y, w * 0.88, 2);
    ctx.fillStyle = `rgba(125, 211, 252, ${0.05 + 0.05 * Math.cos(y * 0.16)})`;
    ctx.fillRect(w * 0.38, y + 3, w * 0.6, 1.8);
  }
}
