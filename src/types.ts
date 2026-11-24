export type RemovalMode = 'gemini' | 'omni' | 'brush' | 'video';

export type EngineAlgorithm = 'hybrid' | 'reverse-alpha' | 'inpaint';

export type CornerPreset =
  | 'bottom-right'
  | 'bottom-left'
  | 'top-right'
  | 'top-left'
  | 'custom';

export interface RectROI {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrushStroke {
  points: Array<{ x: number; y: number }>;
  radius: number;
}

export interface RemovalSettings {
  mode: RemovalMode;
  algorithm: EngineAlgorithm;
  corner: CornerPreset;
  /** Auto-detect Gemini 48/96px or Omni badge position */
  autoDetect: boolean;
  /** Reverse alpha strength multiplier (0.5 - 1.5, default 1.0) */
  alphaStrength: number;
  /** Estimated peak logo opacity override (0 = auto, else 0.15 - 0.95) */
  manualOpacity: number;
  /** Edge feather & halo smoothing radius (0 - 6) */
  featherRadius: number;
  /** Texture patch synthesis refinement enabled */
  textureRefine: boolean;
  /** Omni stroke detection sensitivity (0.1 - 0.9, default 0.42) */
  omniSensitivity: number;
  /** Custom or adjusted ROI in image pixel coordinates */
  roi: RectROI | null;
  /** Brush size in image pixels */
  brushSize: number;
  /** Output format */
  exportFormat: 'png' | 'jpeg' | 'webp';
  /** Output quality (0.7 - 1.0) */
  exportQuality: number;
}

export interface ProcessResult {
  cleanedDataUrl: string;
  cleanedCanvas: HTMLCanvasElement;
  appliedRoi: RectROI;
  elapsedMs: number;
  detectedScaleLabel: string;
  estimatedOpacity: number;
  maskedPixelCount: number;
}

export interface BatchImageItem {
  id: string;
  name: string;
  originalUrl: string;
  width: number;
  height: number;
  status: 'idle' | 'processing' | 'done' | 'error';
  cleanedUrl?: string;
  appliedRoi?: RectROI;
  elapsedMs?: number;
  detectedScaleLabel?: string;
  estimatedOpacity?: number;
  errorMessage?: string;
  suggestedMode?: 'gemini' | 'omni';
}
