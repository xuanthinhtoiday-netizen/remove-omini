/**
 * Pixel-perfect Reverse Alpha Blending & Fused Multi-Scale / Gradient / Dual-Polarity
 * Auto-Detection engine matching ishara-madu/gemini-watermark-remover (MIT).
 *
 * Supports:
 * - Google Gemini & Nano Banana images (Adaptive Inset 12.5% + Classic Corner)
 * - Gemini Omni, Google Flow & Veo 3 videos (Adaptive Inset, Corner, Sparkle Video)
 * - Real-time live tuning (gain, sizeScale, offsetX, offsetY) with 1px fine-lock auto-detect
 */

export interface WatermarkBox {
  size: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RoiBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TunerParams {
  gain: number;
  offsetX: number;
  offsetY: number;
  sizeScale: number;
}

export type ImagePresetKey = 'new' | 'classic';
export type VideoPresetKey = 'veo' | 'corner' | 'sparkle';

export interface DetectionResult<P extends string = string> {
  matchFound: boolean;
  score: number;
  presetKey: P;
  name: string;
  offsetX: number;
  offsetY: number;
  sizeScale: number;
  gain: number;
}

const ALPHA_THRESHOLD = 0.002;
const MAX_ALPHA = 0.99;
const LOGO_VALUE = 255;

/**
 * Exact algebraic inverse of forward white alpha compositing:
 *   Original = (Watermarked - alpha * 255) / (1 - alpha)
 */
export function removeWatermarkExact(
  imageData: ImageData,
  alphaMap: Float32Array,
  position: { x: number; y: number; width: number; height: number },
  alphaGain = 1.0
): void {
  const { x, y, width, height } = position;
  const gain = Number.isFinite(alphaGain) && alphaGain > 0 ? alphaGain : 1.0;
  const imgW = imageData.width;
  const data = imageData.data;

  for (let row = 0; row < height; row++) {
    const imgRowOffset = (y + row) * imgW + x;
    const alphaRowOffset = row * width;
    for (let col = 0; col < width; col++) {
      let alpha = alphaMap[alphaRowOffset + col] * gain;
      if (alpha < ALPHA_THRESHOLD) continue;
      if (alpha > MAX_ALPHA) alpha = MAX_ALPHA;

      const invOneMinusA = 1.0 / (1.0 - alpha);
      const imgIdx = (imgRowOffset + col) * 4;

      for (let c = 0; c < 3; c++) {
        const watermarked = data[imgIdx + c];
        const original = (watermarked - alpha * LOGO_VALUE) * invOneMinusA;
        data[imgIdx + c] = Math.max(0, Math.min(255, Math.round(original)));
      }
    }
  }
}

/**
 * Canonical image watermark geometry (scaled to minDim / 1536).
 */
export function getImageWatermarkBase(width: number, height: number): WatermarkBox {
  const minDim = Math.min(width, height);
  const ratio = minDim / 1536;
  const size = Math.max(16, Math.round(96 * ratio));
  const margin = Math.max(8, Math.round(64 * ratio));
  return {
    size,
    x: Math.max(0, width - margin - size),
    y: Math.max(0, height - margin - size),
    width: size,
    height: size,
  };
}

/**
 * Canonical Gemini Omni / Google Flow / Veo 3 video watermark geometry.
 */
export function getVideoWatermarkBase(width: number, height: number): WatermarkBox {
  const base = Math.min(width, height);
  const size = Math.max(24, Math.min(Math.round(base / 15), base));
  const margin = Math.round(base / 10);
  return {
    size,
    x: Math.max(0, width - margin - size),
    y: Math.max(0, height - margin - size),
    width: size,
    height: size,
  };
}

/**
 * Padded Region of Interest around the watermark box (used for zoomed comparison & fast frame ROI).
 */
export function getPaddedRoi(width: number, height: number, wm: WatermarkBox): RoiBox {
  const pad = Math.round(wm.size * 0.6);
  const rx = Math.max(0, Math.min(width - 1, wm.x - pad));
  const ry = Math.max(0, Math.min(height - 1, wm.y - pad));
  const rw = Math.max(1, Math.min(width - rx, wm.width + pad * 2));
  const rh = Math.max(1, Math.min(height - ry, wm.height + pad * 2));
  return { x: rx, y: ry, width: rw, height: rh };
}

/**
 * Applies sizeScale & (offsetX, offsetY) to a base WatermarkBox, clamped inside frame bounds.
 */
export function resolveWatermarkBox(
  base: WatermarkBox,
  width: number,
  height: number,
  tuner: Partial<TunerParams> = {}
): WatermarkBox {
  const sizeScale = tuner.sizeScale || 1;
  const size = Math.max(8, Math.min(Math.round(base.size * sizeScale), Math.min(width, height)));
  const x = Math.max(0, Math.min(base.x + Math.round(tuner.offsetX || 0), width - size));
  const y = Math.max(0, Math.min(base.y + Math.round(tuner.offsetY || 0), height - size));
  return { size, x, y, width: size, height: size };
}

/**
 * Builds an ROI-sized Float32 alpha map from the captured Google sparkle PNG (bg48 or bg96).
 */
export function buildRoiAlphaMap(
  bgImg: HTMLImageElement,
  roi: RoiBox,
  wm: WatermarkBox,
  gain: number
): Float32Array {
  const count = roi.width * roi.height;
  const alphaMap = new Float32Array(count);
  const offX = wm.x - roi.x;
  const offY = wm.y - roi.y;

  const c = document.createElement('canvas');
  c.width = wm.size;
  c.height = wm.size;
  const cx = c.getContext('2d', { willReadFrequently: true })!;
  cx.imageSmoothingEnabled = true;
  cx.imageSmoothingQuality = 'high';
  cx.drawImage(bgImg, 0, 0, wm.size, wm.size);
  const data = cx.getImageData(0, 0, wm.size, wm.size).data;

  for (let row = 0; row < wm.size; row++) {
    const targetRow = offY + row;
    if (targetRow < 0 || targetRow >= roi.height) continue;
    const rBase = targetRow * roi.width + offX;
    const sBase = row * wm.size;
    for (let col = 0; col < wm.size; col++) {
      const targetCol = offX + col;
      if (targetCol < 0 || targetCol >= roi.width) continue;
      const o = (sBase + col) * 4;
      const a = (Math.max(data[o], data[o + 1], data[o + 2]) / 255.0) * gain;
      alphaMap[rBase + col] = a > 0 ? Math.min(a, MAX_ALPHA) : 0;
    }
  }
  return alphaMap;
}

/**
 * Cleans a full ImageData frame in-place using exact reverse-alpha subtraction.
 */
export function cleanFrameExact(
  bgImg: HTMLImageElement,
  imageData: ImageData,
  width: number,
  height: number,
  base: WatermarkBox,
  tuner: TunerParams
): { wm: WatermarkBox; roi: RoiBox } {
  const wm = resolveWatermarkBox(base, width, height, tuner);
  const roi = getPaddedRoi(width, height, wm);
  const alpha = buildRoiAlphaMap(bgImg, roi, wm, tuner.gain);
  removeWatermarkExact(imageData, alpha, {
    x: roi.x,
    y: roi.y,
    width: roi.width,
    height: roi.height,
  });
  return { wm, roi };
}

/**
 * Adaptive Image Presets:
 * - 'new': Gemini & Nano Banana (12.5% Inset, gain 0.6)
 * - 'classic': Classic Corner (4.16% Margin, gain 1.0)
 */
export function getAdaptiveImagePreset(
  presetKey: ImagePresetKey,
  width = 1536,
  height = 1536
): TunerParams {
  if (presetKey === 'classic') {
    return { gain: 1.0, offsetX: 0, offsetY: 0, sizeScale: 1.0 };
  }
  const minDim = Math.min(width, height || width);
  const scaleRatio = Math.max(0.25, Math.min(1.5, minDim / 1536));
  const adaptiveOffset = Math.round(-128 * scaleRatio);
  return {
    gain: 0.6,
    offsetX: adaptiveOffset,
    offsetY: adaptiveOffset,
    sizeScale: 1.0,
  };
}

/**
 * Adaptive Video Presets:
 * - 'veo': Gemini Omni & Google Flow / Veo 3 (Adaptive Inset)
 * - 'corner': Veo / Flow Classic Corner
 * - 'sparkle': Gemini Sparkle Video
 */
export function getAdaptiveVideoPreset(
  presetKey: VideoPresetKey,
  width = 720,
  height = 720
): TunerParams {
  if (presetKey === 'corner') {
    return { gain: 0.6, offsetX: 0, offsetY: 0, sizeScale: 1.0 };
  }
  if (presetKey === 'sparkle') {
    const minDim = Math.min(width, height || width);
    const m = Math.max(16, Math.round(192 * (minDim / 1536)));
    const s = Math.max(24, Math.round(96 * (minDim / 1536)));
    const veoBase = getVideoWatermarkBase(width, height);
    return {
      gain: 0.6,
      offsetX: Math.max(0, width - m - s) - veoBase.x,
      offsetY: Math.max(0, height - m - s) - veoBase.y,
      sizeScale: Math.max(0.5, Math.min(2.5, Math.round((s / veoBase.size) * 100) / 100)),
    };
  }
  const minDim = Math.min(width, height || width);
  const scaleRatio = Math.max(0.3, Math.min(1.5, minDim / 720));
  const adaptiveOffset = Math.round(-24 * scaleRatio);
  return {
    gain: 0.6,
    offsetX: adaptiveOffset,
    offsetY: adaptiveOffset,
    sizeScale: 1.0,
  };
}

// ── Fused Multi-Scale, Gradient & Dual-Polarity Auto-Detection Engine ──

interface AlphaTemplate {
  alphas: Float32Array;
  gradMag: Float32Array;
  size: number;
}

const templateCache = new Map<number, AlphaTemplate>();

function getAlphaTemplate(bgImg: HTMLImageElement, size: number): AlphaTemplate {
  const existing = templateCache.get(size);
  if (existing) return existing;

  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const cx = c.getContext('2d', { willReadFrequently: true })!;
  cx.imageSmoothingEnabled = true;
  cx.imageSmoothingQuality = 'high';
  cx.drawImage(bgImg, 0, 0, size, size);
  const raw = cx.getImageData(0, 0, size, size).data;

  const alphas = new Float32Array(size * size);
  for (let i = 0; i < alphas.length; i++) {
    const o = i * 4;
    alphas[i] = Math.max(raw[o], raw[o + 1], raw[o + 2]) / 255.0;
  }

  const gradMag = new Float32Array(size * size);
  for (let r = 1; r < size - 1; r++) {
    for (let col = 1; col < size - 1; col++) {
      const idx = r * size + col;
      const gx = alphas[idx + 1] - alphas[idx - 1];
      const gy = alphas[(r + 1) * size + col] - alphas[(r - 1) * size + col];
      gradMag[idx] = Math.sqrt(gx * gx + gy * gy);
    }
  }

  const tpl: AlphaTemplate = { alphas, gradMag, size };
  templateCache.set(size, tpl);
  return tpl;
}

function evaluateCandidateMatch(
  imageData: ImageData,
  width: number,
  height: number,
  bgImg: HTMLImageElement,
  box: { x: number; y: number; size: number }
): { score: number; variance: number } {
  const { x, y, size } = box;
  if (x < 0 || y < 0 || x + size > width || y + size > height || size <= 0) {
    return { score: -1, variance: 0 };
  }

  const { alphas, gradMag } = getAlphaTemplate(bgImg, size);
  const data = imageData.data;

  let sumL = 0,
    sumA = 0,
    sumL2 = 0,
    sumA2 = 0,
    sumLA = 0;
  let sumInvL = 0,
    sumInvL2 = 0,
    sumInvLA = 0;
  let sumG = 0,
    sumGA = 0,
    sumG2 = 0,
    sumGA2 = 0,
    sumGGA = 0;
  let n = 0;
  let nGrad = 0;

  const step = size > 80 ? 2 : 1;

  for (let r = 0; r < size; r += step) {
    const imgRow = y + r;
    for (let col = 0; col < size; col += step) {
      const imgCol = x + col;
      const imgIdx = (imgRow * width + imgCol) * 4;
      const alphaIdx = r * size + col;

      const lum = 0.299 * data[imgIdx] + 0.587 * data[imgIdx + 1] + 0.114 * data[imgIdx + 2];
      const invLum = 255.0 - lum;
      const alpha = alphas[alphaIdx];

      sumL += lum;
      sumA += alpha;
      sumL2 += lum * lum;
      sumA2 += alpha * alpha;
      sumLA += lum * alpha;

      sumInvL += invLum;
      sumInvL2 += invLum * invLum;
      sumInvLA += invLum * alpha;
      n++;

      if (
        r > 0 &&
        r < size - 1 &&
        col > 0 &&
        col < size - 1 &&
        imgRow > 0 &&
        imgRow < height - 1 &&
        imgCol > 0 &&
        imgCol < width - 1
      ) {
        const leftIdx = (imgRow * width + (imgCol - 1)) * 4;
        const rightIdx = (imgRow * width + (imgCol + 1)) * 4;
        const upIdx = ((imgRow - 1) * width + imgCol) * 4;
        const downIdx = ((imgRow + 1) * width + imgCol) * 4;

        const lumLeft =
          0.299 * data[leftIdx] + 0.587 * data[leftIdx + 1] + 0.114 * data[leftIdx + 2];
        const lumRight =
          0.299 * data[rightIdx] + 0.587 * data[rightIdx + 1] + 0.114 * data[rightIdx + 2];
        const lumUp = 0.299 * data[upIdx] + 0.587 * data[upIdx + 1] + 0.114 * data[upIdx + 2];
        const lumDown =
          0.299 * data[downIdx] + 0.587 * data[downIdx + 1] + 0.114 * data[downIdx + 2];

        const gx = lumRight - lumLeft;
        const gy = lumDown - lumUp;
        const imgGrad = Math.sqrt(gx * gx + gy * gy);
        const aGrad = gradMag[alphaIdx];

        sumG += imgGrad;
        sumGA += aGrad;
        sumG2 += imgGrad * imgGrad;
        sumGA2 += aGrad * aGrad;
        sumGGA += imgGrad * aGrad;
        nGrad++;
      }
    }
  }

  if (n === 0) return { score: -1, variance: 0 };

  const meanL = sumL / n;
  const meanA = sumA / n;
  const varL = Math.max(0, sumL2 / n - meanL * meanL);
  const varA = Math.max(0, sumA2 / n - meanA * meanA);

  if (varA <= 0.0001) return { score: 0, variance: varL };

  let nccWhite = 0;
  if (varL > 0.5) {
    const covLA = sumLA / n - meanL * meanA;
    nccWhite = covLA / Math.sqrt(varL * varA);
  }

  let nccDark = 0;
  const meanInvL = sumInvL / n;
  const varInvL = Math.max(0, sumInvL2 / n - meanInvL * meanInvL);
  if (varInvL > 0.5 && meanL > 160) {
    const covInvLA = sumInvLA / n - meanInvL * meanA;
    nccDark = covInvLA / Math.sqrt(varInvL * varA);
  }

  const nccLum = Math.max(nccWhite, nccDark);

  let nccGrad = 0;
  if (nGrad > 10) {
    const meanG = sumG / nGrad;
    const meanGA = sumGA / nGrad;
    const varG = Math.max(0, sumG2 / nGrad - meanG * meanG);
    const varGA = Math.max(0, sumGA2 / nGrad - meanGA * meanGA);
    if (varG > 0.5 && varGA > 0.0001) {
      const covGGA = sumGGA / nGrad - meanG * meanGA;
      nccGrad = Math.max(0, covGGA / Math.sqrt(varG * varGA));
    }
  }

  let fusedScore = nccLum * 0.65 + nccGrad * 0.35;
  if (varL < 20) {
    fusedScore = Math.max(fusedScore, nccLum * 0.4 + nccGrad * 0.6);
  }

  return { score: Math.max(0, fusedScore), variance: varL };
}

/**
 * Estimates the optimal Reverse-Alpha gain by minimizing residual correlation
 * between the unblended patch and the sparkle alpha template (binary/grid search).
 */
export function estimateOptimalGain(
  imageData: ImageData,
  width: number,
  height: number,
  bgImg: HTMLImageElement,
  box: { x: number; y: number; size: number },
  fallbackGain: number
): number {
  const { x, y, size } = box;
  if (x < 0 || y < 0 || x + size > width || y + size > height) return fallbackGain;

  const { alphas } = getAlphaTemplate(bgImg, size);
  const data = imageData.data;

  // Test candidate gains from 0.35 to 1.25 in steps of 0.05 and pick the gain
  // where the residual luminance inside the sparkle has minimum absolute covariance with alpha!
  let bestGain = fallbackGain;
  let bestResidual = Infinity;

  for (let g = 0.35; g <= 1.251; g += 0.05) {
    let sumL = 0;
    let sumA = 0;
    let sumLA = 0;
    let n = 0;

    for (let r = 0; r < size; r += 2) {
      const rowOff = (y + r) * width + x;
      const aRow = r * size;
      for (let col = 0; col < size; col += 2) {
        const rawA = alphas[aRow + col];
        const a = Math.min(MAX_ALPHA, rawA * g);
        const idx = (rowOff + col) * 4;
        const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
        const origLum = a >= ALPHA_THRESHOLD ? Math.max(0, Math.min(255, (lum - a * 255) / (1 - a))) : lum;
        sumL += origLum;
        sumA += rawA;
        sumLA += origLum * rawA;
        n++;
      }
    }

    if (n > 0) {
      const cov = Math.abs(sumLA / n - (sumL / n) * (sumA / n));
      if (cov < bestResidual) {
        bestResidual = cov;
        bestGain = Math.round(g * 100) / 100;
      }
    }
  }

  return bestGain;
}

export function detectImageWatermark(
  imageData: ImageData,
  width: number,
  height: number,
  bgImg: HTMLImageElement
): DetectionResult<ImagePresetKey> {
  const minDim = Math.min(width, height);
  const baseRatio = minDim / 1536;
  const base = getImageWatermarkBase(width, height);

  const layoutFamilies: Array<{
    presetKey: ImagePresetKey;
    name: string;
    baseSize: number;
    calcPos: (s: number) => { x: number; y: number };
    gain: number;
    prior: number;
  }> = [
    {
      presetKey: 'new',
      name: 'Gemini & Nano Banana (Inset)',
      baseSize: base.size,
      calcPos: (s) => {
        const m = Math.max(8, Math.round(192 * baseRatio));
        return { x: Math.max(0, width - m - s), y: Math.max(0, height - m - s) };
      },
      gain: 0.6,
      prior: 1.08,
    },
    {
      presetKey: 'classic',
      name: 'Gemini Classic Corner',
      baseSize: base.size,
      calcPos: (s) => {
        const m = Math.max(8, Math.round(64 * baseRatio));
        return { x: Math.max(0, width - m - s), y: Math.max(0, height - m - s) };
      },
      gain: 1.0,
      prior: 1.04,
    },
    {
      presetKey: 'new',
      name: 'Gemini & Nano Banana (Fixed 96px)',
      baseSize: 96,
      calcPos: (s) => {
        const m = minDim >= 1400 ? 192 : Math.round(128 * Math.max(0.5, minDim / 1024));
        return { x: Math.max(0, width - m - s), y: Math.max(0, height - m - s) };
      },
      gain: 0.6,
      prior: 1.02,
    },
    {
      presetKey: 'classic',
      name: 'Classic Corner (Fixed 96px/48px)',
      baseSize: width > 1024 && height > 1024 ? 96 : 48,
      calcPos: (s) => {
        const m = width > 1024 && height > 1024 ? 64 : 32;
        return { x: Math.max(0, width - m - s), y: Math.max(0, height - m - s) };
      },
      gain: 1.0,
      prior: 1.03,
    },
  ];

  const scalePyramid = [0.55, 0.7, 0.85, 1.0, 1.15, 1.3, 1.5, 1.7];

  let bestMatch: {
    layout: (typeof layoutFamilies)[number];
    size: number;
    x: number;
    y: number;
    score: number;
  } | null = null;
  let bestScore = -1;

  for (const layout of layoutFamilies) {
    for (const scale of scalePyramid) {
      const s = Math.max(
        16,
        Math.min(Math.round(layout.baseSize * scale), Math.min(width, height) - 8)
      );
      const pos = layout.calcPos(s);
      const { score } = evaluateCandidateMatch(imageData, width, height, bgImg, {
        x: pos.x,
        y: pos.y,
        size: s,
      });
      const weightedScore = score * layout.prior;
      if (weightedScore > bestScore) {
        bestScore = weightedScore;
        bestMatch = { layout, size: s, x: pos.x, y: pos.y, score: weightedScore };
      }
    }
  }

  if (bestMatch && bestMatch.score > 0.05) {
    let refinedX = bestMatch.x;
    let refinedY = bestMatch.y;
    let refinedSize = bestMatch.size;
    let refinedScore = bestMatch.score;

    const fineSizes = [
      ...new Set([
        Math.max(16, Math.round(bestMatch.size * 0.9)),
        Math.max(16, Math.round(bestMatch.size * 0.95)),
        bestMatch.size,
        Math.min(minDim - 8, Math.round(bestMatch.size * 1.05)),
        Math.min(minDim - 8, Math.round(bestMatch.size * 1.1)),
      ]),
    ];

    // Coarse ±16px step 4
    for (const testSize of fineSizes) {
      for (let dy = -16; dy <= 16; dy += 4) {
        for (let dx = -16; dx <= 16; dx += 4) {
          const testX = Math.max(0, Math.min(width - testSize, bestMatch.x + dx));
          const testY = Math.max(0, Math.min(height - testSize, bestMatch.y + dy));
          const { score } = evaluateCandidateMatch(imageData, width, height, bgImg, {
            x: testX,
            y: testY,
            size: testSize,
          });
          const weightedScore = score * bestMatch.layout.prior;
          if (weightedScore > refinedScore) {
            refinedScore = weightedScore;
            refinedX = testX;
            refinedY = testY;
            refinedSize = testSize;
          }
        }
      }
    }

    // Ultra-fine 1px micro-lock (±3px) for razor-sharp alignment!
    const anchorX = refinedX;
    const anchorY = refinedY;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const testX = Math.max(0, Math.min(width - refinedSize, anchorX + dx));
        const testY = Math.max(0, Math.min(height - refinedSize, anchorY + dy));
        const { score } = evaluateCandidateMatch(imageData, width, height, bgImg, {
          x: testX,
          y: testY,
          size: refinedSize,
        });
        const weightedScore = score * bestMatch.layout.prior;
        if (weightedScore > refinedScore) {
          refinedScore = weightedScore;
          refinedX = testX;
          refinedY = testY;
        }
      }
    }

    const calculatedScale = Math.round((refinedSize / base.size) * 100) / 100;
    const autoGain =
      refinedScore >= 0.25
        ? estimateOptimalGain(
            imageData,
            width,
            height,
            bgImg,
            { x: refinedX, y: refinedY, size: refinedSize },
            bestMatch.layout.gain
          )
        : bestMatch.layout.gain;

    return {
      matchFound: refinedScore >= 0.1,
      score: Math.min(1.0, refinedScore),
      presetKey: bestMatch.layout.presetKey,
      name: `${bestMatch.layout.name} (${refinedSize}px)`,
      offsetX: refinedX - base.x,
      offsetY: refinedY - base.y,
      sizeScale: Math.max(0.5, Math.min(2.5, calculatedScale)),
      gain: autoGain,
    };
  }

  const fallbackOffset = Math.round(-128 * baseRatio);
  return {
    matchFound: false,
    score: Math.max(0, bestScore),
    presetKey: 'new',
    name: 'Gemini & Nano Banana (Adaptive)',
    offsetX: fallbackOffset,
    offsetY: fallbackOffset,
    sizeScale: 1.0,
    gain: 0.6,
  };
}

export function detectVideoWatermark(
  imageData: ImageData,
  width: number,
  height: number,
  bgImg: HTMLImageElement
): DetectionResult<VideoPresetKey> {
  const baseDim = Math.min(width, height);
  const veoBase = getVideoWatermarkBase(width, height);

  const layoutFamilies: Array<{
    presetKey: VideoPresetKey;
    name: string;
    baseSize: number;
    calcPos: (s: number) => { x: number; y: number };
    gain: number;
    prior: number;
  }> = [
    {
      presetKey: 'veo',
      name: 'Gemini Omni & Google Flow (Veo 3)',
      baseSize: veoBase.size,
      calcPos: (s) => {
        const adaptiveOffset = Math.round(-24 * (baseDim / 720));
        return {
          x: Math.max(0, Math.min(width - s, veoBase.x + adaptiveOffset)),
          y: Math.max(0, Math.min(height - s, veoBase.y + adaptiveOffset)),
        };
      },
      gain: 0.6,
      prior: 1.06,
    },
    {
      presetKey: 'corner',
      name: 'Gemini Veo & Flow (Corner)',
      baseSize: veoBase.size,
      calcPos: (s) => ({
        x: Math.max(0, Math.min(width - s, veoBase.x)),
        y: Math.max(0, Math.min(height - s, veoBase.y)),
      }),
      gain: 0.6,
      prior: 1.02,
    },
    {
      presetKey: 'sparkle',
      name: 'Gemini Sparkle (Video)',
      baseSize: Math.max(24, Math.round(96 * (baseDim / 1536))),
      calcPos: (s) => {
        const m = Math.max(16, Math.round(192 * (baseDim / 1536)));
        return {
          x: Math.max(0, width - m - s),
          y: Math.max(0, height - m - s),
        };
      },
      gain: 0.6,
      prior: 1.01,
    },
  ];

  const scalePyramid = [0.65, 0.85, 1.0, 1.2, 1.45];

  let bestMatch: {
    layout: (typeof layoutFamilies)[number];
    size: number;
    x: number;
    y: number;
    score: number;
  } | null = null;
  let bestScore = -1;

  for (const layout of layoutFamilies) {
    for (const scale of scalePyramid) {
      const s = Math.max(16, Math.min(Math.round(layout.baseSize * scale), baseDim - 8));
      const pos = layout.calcPos(s);
      const { score } = evaluateCandidateMatch(imageData, width, height, bgImg, {
        x: pos.x,
        y: pos.y,
        size: s,
      });
      const weightedScore = score * layout.prior;
      if (weightedScore > bestScore) {
        bestScore = weightedScore;
        bestMatch = { layout, size: s, x: pos.x, y: pos.y, score: weightedScore };
      }
    }
  }

  if (bestMatch && bestMatch.score > 0.05) {
    let refinedX = bestMatch.x;
    let refinedY = bestMatch.y;
    let refinedSize = bestMatch.size;
    let refinedScore = bestMatch.score;

    const fineSizes = [
      ...new Set([
        Math.max(16, Math.round(bestMatch.size * 0.92)),
        bestMatch.size,
        Math.min(baseDim - 8, Math.round(bestMatch.size * 1.08)),
      ]),
    ];

    for (const testSize of fineSizes) {
      for (let dy = -16; dy <= 16; dy += 4) {
        for (let dx = -16; dx <= 16; dx += 4) {
          const testX = Math.max(0, Math.min(width - testSize, bestMatch.x + dx));
          const testY = Math.max(0, Math.min(height - testSize, bestMatch.y + dy));
          const { score } = evaluateCandidateMatch(imageData, width, height, bgImg, {
            x: testX,
            y: testY,
            size: testSize,
          });
          const weightedScore = score * bestMatch.layout.prior;
          if (weightedScore > refinedScore) {
            refinedScore = weightedScore;
            refinedX = testX;
            refinedY = testY;
            refinedSize = testSize;
          }
        }
      }
    }

    // 1px micro-lock
    const anchorX = refinedX;
    const anchorY = refinedY;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const testX = Math.max(0, Math.min(width - refinedSize, anchorX + dx));
        const testY = Math.max(0, Math.min(height - refinedSize, anchorY + dy));
        const { score } = evaluateCandidateMatch(imageData, width, height, bgImg, {
          x: testX,
          y: testY,
          size: refinedSize,
        });
        const weightedScore = score * bestMatch.layout.prior;
        if (weightedScore > refinedScore) {
          refinedScore = weightedScore;
          refinedX = testX;
          refinedY = testY;
        }
      }
    }

    const calculatedScale = Math.round((refinedSize / veoBase.size) * 100) / 100;
    const autoGain =
      refinedScore >= 0.22
        ? estimateOptimalGain(
            imageData,
            width,
            height,
            bgImg,
            { x: refinedX, y: refinedY, size: refinedSize },
            bestMatch.layout.gain
          )
        : bestMatch.layout.gain;

    return {
      matchFound: refinedScore >= 0.08,
      score: Math.min(1.0, refinedScore),
      presetKey: bestMatch.layout.presetKey,
      name: `${bestMatch.layout.name} (${refinedSize}px)`,
      offsetX: refinedX - veoBase.x,
      offsetY: refinedY - veoBase.y,
      sizeScale: Math.max(0.5, Math.min(2.5, calculatedScale)),
      gain: autoGain,
    };
  }

  const fallbackOffset = Math.round(-24 * (baseDim / 720));
  return {
    matchFound: false,
    score: Math.max(0, bestScore),
    presetKey: 'veo',
    name: 'Gemini Omni & Google Flow (Veo 3)',
    offsetX: fallbackOffset,
    offsetY: fallbackOffset,
    sizeScale: 1.0,
    gain: 0.6,
  };
}
