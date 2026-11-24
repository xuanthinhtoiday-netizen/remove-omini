import type { RectROI } from '../types';

/**
 * High-quality multi-stage inpainting engine for removing logos, watermarks,
 * text badges, and user-painted brush masks cleanly without muddy rectangular blurs.
 *
 * Stage 1: Distance-ordered Fast Marching directional diffusion (Telea-inspired)
 *          that propagates colors smoothly inward from known boundary pixels.
 * Stage 2: Optional exemplar patch texture synthesis (5x5 patch matching against
 *          a surrounding clean ring) to restore realistic grain & micro-texture.
 * Stage 3: Smooth boundary feathering to eliminate any seam transition.
 */
export function inpaintMaskRegion(
  imgData: ImageData,
  roi: RectROI,
  mask: Uint8Array,
  options: {
    textureRefine?: boolean;
    featherRadius?: number;
  } = {}
): number {
  const { textureRefine = true, featherRadius = 2 } = options;
  const { width: imgW, height: imgH, data } = imgData;

  const ox = Math.max(0, Math.round(roi.x));
  const oy = Math.max(0, Math.round(roi.y));
  const rw = Math.min(imgW - ox, Math.round(roi.width));
  const rh = Math.min(imgH - oy, Math.round(roi.height));
  if (rw <= 0 || rh <= 0) return 0;

  // Expand working canvas with a clean border ring for boundary sampling & patch lookup
  const pad = textureRefine ? 18 : 8;
  const wx0 = Math.max(0, ox - pad);
  const wy0 = Math.max(0, oy - pad);
  const wx1 = Math.min(imgW, ox + rw + pad);
  const wy1 = Math.min(imgH, oy + rh + pad);
  const ww = wx1 - wx0;
  const wh = wy1 - wy0;

  // Working float RGB buffer and state flags: 0 = known, 1 = band/unknown
  const bufR = new Float32Array(ww * wh);
  const bufG = new Float32Array(ww * wh);
  const bufB = new Float32Array(ww * wh);
  const state = new Uint8Array(ww * wh); // 0 = KNOWN, 1 = UNKNOWN
  const origMask = new Uint8Array(ww * wh);

  let maskedCount = 0;

  for (let y = 0; y < wh; y++) {
    const gy = wy0 + y;
    const gRow = gy * imgW;
    const wRow = y * ww;
    for (let x = 0; x < ww; x++) {
      const gx = wx0 + x;
      const gIdx = (gRow + gx) * 4;
      const wIdx = wRow + x;
      bufR[wIdx] = data[gIdx];
      bufG[wIdx] = data[gIdx + 1];
      bufB[wIdx] = data[gIdx + 2];

      const rx = gx - ox;
      const ry = gy - oy;
      if (rx >= 0 && rx < rw && ry >= 0 && ry < rh && mask[ry * rw + rx] > 0) {
        state[wIdx] = 1;
        origMask[wIdx] = 1;
        maskedCount++;
      }
    }
  }

  if (maskedCount === 0) return 0;

  // --- STAGE 1: Onion-Peel Multi-Ring Directional Diffusion ---
  // Compute distance transform via BFS from all known boundary pixels
  const dist = new Int16Array(ww * wh);
  dist.fill(-1);
  const queueX = new Int16Array(ww * wh);
  const queueY = new Int16Array(ww * wh);
  let qHead = 0;
  let qTail = 0;

  for (let y = 0; y < wh; y++) {
    const row = y * ww;
    for (let x = 0; x < ww; x++) {
      const idx = row + x;
      if (state[idx] === 0) {
        dist[idx] = 0;
      } else {
        // Check if adjacent to a known pixel
        const hasKnown =
          (x > 0 && state[idx - 1] === 0) ||
          (x < ww - 1 && state[idx + 1] === 0) ||
          (y > 0 && state[idx - ww] === 0) ||
          (y < wh - 1 && state[idx + ww] === 0);
        if (hasKnown) {
          dist[idx] = 1;
          queueX[qTail] = x;
          queueY[qTail] = y;
          qTail++;
        }
      }
    }
  }

  const dirs = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];

  // Expand BFS layers so we process pixels strictly from outermost boundary inward
  while (qHead < qTail) {
    const cx = queueX[qHead];
    const cy = queueY[qHead];
    qHead++;
    const cDist = dist[cy * ww + cx];

    for (let d = 0; d < 4; d++) {
      const nx = cx + dirs[d][0];
      const ny = cy + dirs[d][1];
      if (nx < 0 || ny < 0 || nx >= ww || ny >= wh) continue;
      const nIdx = ny * ww + nx;
      if (state[nIdx] === 1 && dist[nIdx] === -1) {
        dist[nIdx] = cDist + 1;
        queueX[qTail] = nx;
        queueY[qTail] = ny;
        qTail++;
      }
    }
  }

  // Fill pixels in ascending distance order using Telea-like inverse-distance + gradient-guided weights
  const rad = 3;
  for (let i = 0; i < qTail; i++) {
    const x = queueX[i];
    const y = queueY[i];
    const idx = y * ww + x;

    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let sumW = 0;

    // Estimate local distance gradient (normal pointing inward)
    const dL = x > 0 ? dist[idx - 1] : dist[idx];
    const dR = x < ww - 1 ? dist[idx + 1] : dist[idx];
    const dU = y > 0 ? dist[idx - ww] : dist[idx];
    const dD = y < wh - 1 ? dist[idx + ww] : dist[idx];
    const nx = dR - dL;
    const ny = dD - dU;
    const nLen = Math.hypot(nx, ny) || 1;
    const ux = nx / nLen;
    const uy = ny / nLen;

    const yMin = Math.max(0, y - rad);
    const yMax = Math.min(wh - 1, y + rad);
    const xMin = Math.max(0, x - rad);
    const xMax = Math.min(ww - 1, x + rad);

    for (let ky = yMin; ky <= yMax; ky++) {
      const dy = ky - y;
      const kRow = ky * ww;
      for (let kx = xMin; kx <= xMax; kx++) {
        const kIdx = kRow + kx;
        if (state[kIdx] !== 0) continue; // Only use already known/filled pixels

        const dx = kx - x;
        const d2 = dx * dx + dy * dy;
        if (d2 === 0 || d2 > rad * rad + 1) continue;

        const dLen = Math.sqrt(d2);
        // Directional alignment with normal + inverse square distance
        const dirW = Math.abs((dx * ux + dy * uy) / dLen) + 0.15;
        const distW = 1 / (d2 * dLen);
        // Prefer original clean pixels slightly over synthesized pixels
        const origBoost = origMask[kIdx] === 0 ? 1.45 : 1.0;
        const w = dirW * distW * origBoost;

        sumR += bufR[kIdx] * w;
        sumG += bufG[kIdx] * w;
        sumB += bufB[kIdx] * w;
        sumW += w;
      }
    }

    if (sumW > 0) {
      bufR[idx] = sumR / sumW;
      bufG[idx] = sumG / sumW;
      bufB[idx] = sumB / sumW;
      state[idx] = 0; // Now known for deeper layers
    }
  }

  // Smooth harmonic relaxation (4 Jacobi iterations inside mask) to remove directional streaks
  const tmpR = new Float32Array(bufR);
  const tmpG = new Float32Array(bufG);
  const tmpB = new Float32Array(bufB);

  for (let iter = 0; iter < 5; iter++) {
    for (let i = 0; i < qTail; i++) {
      const x = queueX[i];
      const y = queueY[i];
      if (x <= 0 || y <= 0 || x >= ww - 1 || y >= wh - 1) continue;
      const idx = y * ww + x;
      tmpR[idx] =
        0.2 * (bufR[idx - 1] + bufR[idx + 1] + bufR[idx - ww] + bufR[idx + ww] + bufR[idx]);
      tmpG[idx] =
        0.2 * (bufG[idx - 1] + bufG[idx + 1] + bufG[idx - ww] + bufG[idx + ww] + bufG[idx]);
      tmpB[idx] =
        0.2 * (bufB[idx - 1] + bufB[idx + 1] + bufB[idx - ww] + bufB[idx + ww] + bufB[idx]);
    }
    for (let i = 0; i < qTail; i++) {
      const idx = queueY[i] * ww + queueX[i];
      bufR[idx] = tmpR[idx];
      bufG[idx] = tmpG[idx];
      bufB[idx] = tmpB[idx];
    }
  }

  // --- STAGE 2: Exemplar Patch Texture Refinement ---
  // Restores real local grain/noise/texture from clean surround into the diffused region
  if (textureRefine && maskedCount <= 65000) {
    const patchR = 2; // 5x5 patch
    // Pre-collect clean candidate patch centers from the surrounding border
    const candidates: Array<{ x: number; y: number; meanR: number; meanG: number; meanB: number }> =
      [];
    const stride = ww * wh > 18000 ? 2 : 1;

    for (let y = patchR; y < wh - patchR; y += stride) {
      for (let x = patchR; x < ww - patchR; x += stride) {
        // Ensure entire 5x5 candidate patch is clean (origMask === 0)
        let clean = true;
        let mr = 0;
        let mg = 0;
        let mb = 0;
        for (let py = -patchR; py <= patchR && clean; py++) {
          const pRow = (y + py) * ww;
          for (let px = -patchR; px <= patchR; px++) {
            const pIdx = pRow + x + px;
            if (origMask[pIdx] === 1) {
              clean = false;
              break;
            }
            mr += bufR[pIdx];
            mg += bufG[pIdx];
            mb += bufB[pIdx];
          }
        }
        if (clean) {
          candidates.push({ x, y, meanR: mr / 25, meanG: mg / 25, meanB: mb / 25 });
        }
      }
    }

    if (candidates.length > 8) {
      // Subsample candidate list if very large to keep latency < 90ms
      const maxCand = 160;
      const step = Math.max(1, Math.floor(candidates.length / maxCand));
      const sampledCands = candidates.filter((_, idx) => idx % step === 0);

      const texR = new Float32Array(bufR);
      const texG = new Float32Array(bufG);
      const texB = new Float32Array(bufB);

      // Process masked pixels in stride-2 blocks and blend patch residuals
      const accR = new Float32Array(ww * wh);
      const accG = new Float32Array(ww * wh);
      const accB = new Float32Array(ww * wh);
      const accW = new Float32Array(ww * wh);

      for (let y = patchR; y < wh - patchR; y += 2) {
        for (let x = patchR; x < ww - patchR; x += 2) {
          if (origMask[y * ww + x] === 0) continue;

          // Target diffused patch mean
          let tr = 0;
          let tg = 0;
          let tb = 0;
          for (let py = -patchR; py <= patchR; py++) {
            const pRow = (y + py) * ww;
            for (let px = -patchR; px <= patchR; px++) {
              const pIdx = pRow + x + px;
              tr += bufR[pIdx];
              tg += bufG[pIdx];
              tb += bufB[pIdx];
            }
          }
          tr /= 25;
          tg /= 25;
          tb /= 25;

          // Find best matching clean patch by color similarity + spatial proximity
          let bestCand = sampledCands[0];
          let bestCost = Infinity;
          for (let c = 0; c < sampledCands.length; c++) {
            const cand = sampledCands[c];
            const dc =
              Math.abs(cand.meanR - tr) +
              Math.abs(cand.meanG - tg) +
              Math.abs(cand.meanB - tb);
            const distPenalty = (Math.abs(cand.x - x) + Math.abs(cand.y - y)) * 0.28;
            const cost = dc + distPenalty;
            if (cost < bestCost) {
              bestCost = cost;
              bestCand = cand;
            }
          }

          // Transfer high-frequency texture detail from bestCand while keeping smooth color match
          const shiftR = (tr - bestCand.meanR) * 0.72;
          const shiftG = (tg - bestCand.meanG) * 0.72;
          const shiftB = (tb - bestCand.meanB) * 0.72;

          for (let py = -patchR; py <= patchR; py++) {
            const dstRow = (y + py) * ww;
            const srcRow = (bestCand.y + py) * ww;
            for (let px = -patchR; px <= patchR; px++) {
              const dIdx = dstRow + x + px;
              if (origMask[dIdx] === 0) continue;
              const sIdx = srcRow + bestCand.x + px;
              const w = 1 / (1 + px * px + py * py);
              accR[dIdx] += (bufR[sIdx] + shiftR) * w;
              accG[dIdx] += (bufG[sIdx] + shiftG) * w;
              accB[dIdx] += (bufB[sIdx] + shiftB) * w;
              accW[dIdx] += w;
            }
          }
        }
      }

      for (let i = 0; i < qTail; i++) {
        const idx = queueY[i] * ww + queueX[i];
        if (accW[idx] > 0) {
          // Blend 58% exemplar texture + 42% smooth diffusion to avoid harsh artifacts
          texR[idx] = 0.58 * (accR[idx] / accW[idx]) + 0.42 * bufR[idx];
          texG[idx] = 0.58 * (accG[idx] / accW[idx]) + 0.42 * bufG[idx];
          texB[idx] = 0.58 * (accB[idx] / accW[idx]) + 0.42 * bufB[idx];
        }
      }

      bufR.set(texR);
      bufG.set(texG);
      bufB.set(texB);
    }
  }

  // --- STAGE 3: Write back with subtle boundary feathering ---
  const feather = Math.max(0, Math.min(6, featherRadius));
  for (let y = 0; y < rh; y++) {
    const gy = oy + y;
    const wy = gy - wy0;
    const gRow = gy * imgW;
    const wRow = wy * ww;
    for (let x = 0; x < rw; x++) {
      const gx = ox + x;
      const wx = gx - wx0;
      const wIdx = wRow + wx;
      if (origMask[wIdx] === 0) continue;

      const d = dist[wIdx];
      // Feather blend near the outermost 1-feather pixels for seamless integration
      let blend = 1.0;
      if (feather > 0 && d <= feather) {
        blend = Math.min(1.0, (d + 0.5) / (feather + 0.85));
        // Still keep high blend (>= 0.65) so watermark edge doesn't bleed back
        blend = 0.68 + 0.32 * blend;
      }

      const gIdx = (gRow + gx) * 4;
      data[gIdx] = Math.max(
        0,
        Math.min(255, Math.round(bufR[wIdx] * blend + data[gIdx] * (1 - blend)))
      );
      data[gIdx + 1] = Math.max(
        0,
        Math.min(255, Math.round(bufG[wIdx] * blend + data[gIdx + 1] * (1 - blend)))
      );
      data[gIdx + 2] = Math.max(
        0,
        Math.min(255, Math.round(bufB[wIdx] * blend + data[gIdx + 2] * (1 - blend)))
      );
    }
  }

  return maskedCount;
}
