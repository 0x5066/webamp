export interface Vis {
  canvas?: HTMLCanvasElement;
  colors: string[];
  analyser?: AnalyserNode;
  audioContext?: AudioContext; //butterchurn need it
  oscStyle?: "dots" | "solid" | "lines";
  bandwidth?: "wide" | "thin";
  coloring?: "fire" | "line" | "normal";
  peaks?: boolean;
}
import { out_spectraldata } from "./Vis";

type ColorTriplet = string;

/**
 * Base class of AVS (animation frame renderer engine)
 */
export class VisPaintHandler {
  _vis: Vis;
  _ctx: CanvasRenderingContext2D | null;

  constructor(vis: Vis) {
    this._vis = vis;
    this._ctx = vis.canvas!.getContext("2d");
    // this.prepare();
  }

  /**
   * Attemp to build cached bitmaps for later use while render a frame.
   * Purpose: fast rendering in animation loop
   */
  prepare() {}

  /**
   * Called once per frame rendiring
   */
  paintFrame() {}

  /**
   * Attemp to cleanup cached bitmaps
   */
  dispose() {}

  /**
   * called if it is an AVS.
   * @param action vis_prev | vis_next | vis_f5 (fullscreen) |
   */
  doAction(action: string, param: string) {}
}

//? =============================== VIS.TEST PAINTER (fake) ===============================
export class FakeBarPaintHandler extends VisPaintHandler {
  prepare() {}

  paintFrame() {
    if (!this._ctx) return;
    const ctx = this._ctx;
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    ctx.clearRect(0, 0, width, height);
    ctx.lineWidth = 5;
    for (let i = 0; i < 30; i += 1) {
      const r = Math.floor(Math.random() * 255);
      const g = Math.floor(Math.random() * 255);
      const b = Math.floor(Math.random() * 255);

      ctx.beginPath();
      ctx.moveTo(Math.random() * width, Math.random() * height);
      ctx.lineTo(Math.random() * width, Math.random() * height);
      ctx.strokeStyle = `rgba(${r},${g},${b},1)`;
      ctx.stroke();
    }
  }
}
export class FakeWavePaintHandler extends VisPaintHandler {
  prepare() {}

  paintFrame() {
    if (!this._ctx) return;
    const ctx = this._ctx;
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    ctx.clearRect(0, 0, width, height);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#fff";
    for (let i = 0; i < 30; i += 1) {
      ctx.beginPath();
      ctx.moveTo(Math.random() * width, Math.random() * height);
      ctx.lineTo(Math.random() * width, Math.random() * height);
      ctx.stroke();
    }
  }
}
//? =============================== BAR PAINTER ===============================
const NUM_BARS = 20;
const PIXEL_DENSITY = 1;
const BAR_PEAK_DROP_RATE = 0.01;
type PaintFrameFunction = () => void;
type PaintBarFunction = (
  ctx: CanvasRenderingContext2D,
  // barIndex: number,
  x1: number,
  x2: number,
  barHeight: number,
  peakHeight: number
) => void;

function octaveBucketsForBufferLength(
  bufferLength: number,
  barCount: number = NUM_BARS
): number[] {
  const octaveBuckets = new Array(barCount).fill(0);
  const minHz = 80;
  const maxHz = 22050;
  const octaveStep = Math.pow(maxHz / minHz, 1 / barCount);

  octaveBuckets[0] = 0;
  octaveBuckets[1] = minHz;
  for (let i = 2; i < barCount - 1; i++) {
    octaveBuckets[i] = octaveBuckets[i - 1] * octaveStep;
  }
  octaveBuckets[barCount - 1] = maxHz;

  for (let i = 0; i < barCount; i++) {
    const octaveIdx = Math.floor((octaveBuckets[i] / maxHz) * bufferLength);
    octaveBuckets[i] = octaveIdx;
  }

  return octaveBuckets;
}

export class BarPaintHandler extends VisPaintHandler {
  _analyser: AnalyserNode;
  _barWidth: number;
  _color: string = "rgb(255,255,255)";
  _colorPeak: string = "rgb(255,255,255)";
  // Off-screen canvas for pre-rendering a single bar gradient
  _bar: HTMLCanvasElement = document.createElement("canvas");
  _peak: HTMLCanvasElement = document.createElement("canvas");
  _16h: HTMLCanvasElement = document.createElement("canvas"); // non-stretched
  _barPeaks: number[] = new Array(NUM_BARS).fill(0);
  _barPeakFrames: number[] = new Array(NUM_BARS).fill(0);
  _bufferLength: number;
  _octaveBuckets: number[];
  _dataArray: Uint8Array;
  // _ctx: CanvasRenderingContext2D;
  paintBar: PaintBarFunction;
  paintFrame: PaintFrameFunction;

  constructor(vis: Vis) {
    super(vis);
    this._analyser = this._vis.analyser!;
    this._bufferLength = this._analyser.frequencyBinCount;
    this._octaveBuckets = octaveBucketsForBufferLength(this._bufferLength);
    this._dataArray = new Uint8Array(this._bufferLength);
    this._barWidth = Math.ceil(vis.canvas!.width / NUM_BARS);

    this._16h.width = 1;
    this._16h.height = 16;
    this._16h.setAttribute("width", "75");
    this._16h.setAttribute("height", "16");
    if (this._vis.bandwidth === "wide") {
      this.paintFrame = this.paintFrameWide.bind(this);
      this._octaveBuckets = octaveBucketsForBufferLength(this._bufferLength);
    } else {
      // thin
      this.paintFrame = this.paintFrameThin.bind(this);
      const w = this._vis.canvas!.width;
      this._barPeaks = new Array(w).fill(0);
      this._barPeakFrames = new Array(w).fill(0);
      this._octaveBuckets = octaveBucketsForBufferLength(this._bufferLength, w);
    }

    if (this._vis.coloring === "fire") {
      this.paintBar = this.paintBarFire.bind(this);
    } else if (this._vis.coloring === "line") {
      this.paintBar = this.paintBarLine.bind(this);
    } else {
      this.paintBar = this.paintBarNormal.bind(this);
    }
  }

  prepare() {
    const vis = this._vis;
    if (!vis.canvas) return;
    // const groupId = vis._gammagroup;
    // const gammaGroup = this._vis._uiRoot._getGammaGroup(groupId);
    // this._barWidth = Math.ceil(vis.canvas.width / NUM_BARS);

    //? paint peak
    this._peak.height = 1;
    this._peak.width = 1;
    let ctx = this._peak.getContext("2d")!;
    // ctx.fillStyle = gammaGroup.transformColor(vis._colorBandPeak);
    ctx.fillStyle = vis.colors[23];
    ctx.fillRect(0, 0, 1, 1);

    //? paint bar
    this._bar.height = 16;
    this._bar.width = 1;
    this._bar.setAttribute("width", "1");
    this._bar.setAttribute("height", "16");
    ctx = this._bar.getContext("2d")!;
    // const grd = ctx.createLinearGradient(0, 0, 0, vis.canvas.height);
    // for (let i = 0; i < vis._colorBands.length; i++) {
    //   grd.addColorStop(
    //     (1 / (vis._colorBands.length - 1)) * i,
    //     gammaGroup.transformColor(vis._colorBands[i])
    //   );
    // }
    // ctx.strokeStyle = this._color;
    // ctx.fillStyle = grd;
    // ctx.fillRect(0, 0, 1, vis.canvas.height);
    // ctx.imageSmoothingEnabled = false;
    for (let y = 0; y < 16; y++) {
      // ctx.fillStyle = gammaGroup.transformColor(vis._colorBands[15 - y]);
      ctx.fillStyle = vis.colors[2 - -y];
      ctx.fillRect(0, y, 1, y + 1);
    }

    // this._ctx = this._vis.canvas.getContext("2d");
  }

  /**
   * ⬜⬜⬜ ⬜⬜⬜
   * 🟧🟧🟧
   * 🟫🟫🟫 🟧🟧🟧
   * 🟫🟫🟫 🟫🟫🟫
   * 🟫🟫🟫 🟫🟫🟫 ⬜⬜⬜
   * 🟫🟫🟫 🟫🟫🟫 🟧🟧🟧
   * 🟫🟫🟫 🟫🟫🟫 🟫🟫🟫
   * 1 bar = multiple pixels
   */
  paintFrameWide() {
    if (!this._ctx) return;
    const ctx = this._ctx;
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = this._color;

    this._analyser.getByteFrequencyData(this._dataArray);
    const heightMultiplier = h / 256;

    let sapeaks = new Float32Array(76).fill(0);
    let sadata2 = new Float32Array(76).fill(0);
    let sadata = new Int8Array(76).fill(0);
    let safalloff = new Float32Array(76).fill(0);  
    let sample = new Float32Array(76).fill(0);

    let maxFreqIndex = 512;
    let logMaxFreqIndex = Math.log10(maxFreqIndex);
    let logMinFreqIndex = 0;

    // This factor controls the scaling from linear to logarithmic.
    // scale = 0.0 -> fully linear scaling
    // scale = 1.0 -> fully logarithmic scaling
    let scale = 0.95;  // Adjust this value between 0.0 and 1.0

    let targetSize = 75;

    for (let x = 0; x < targetSize; x++) {
        // Linear interpolation between linear and log scaling
        let linearIndex = x / (targetSize - 1) * (maxFreqIndex - 1);
        let logScaledIndex = logMinFreqIndex + (logMaxFreqIndex - logMinFreqIndex) * x / (targetSize - 1);
        let logIndex = Math.pow(10, logScaledIndex);
        
        // Interpolating between linear and logarithmic scaling
        let scaledIndex = (1.0 - scale) * linearIndex + scale * logIndex;

        let index1 = Math.floor(scaledIndex);
        let index2 = Math.ceil(scaledIndex);

        if (index1 >= maxFreqIndex) {
            index1 = maxFreqIndex - 1;
        }
        if (index2 >= maxFreqIndex) {
            index2 = maxFreqIndex - 1;
        }

        if (index1 == index2) {
            sample[x] = out_spectraldata[index1];
        } else {
            let frac2 = scaledIndex - index1;
            let frac1 = 1.0 - frac2;
            sample[x] = (frac1 * out_spectraldata[index1] + frac2 * out_spectraldata[index2]);
        }
    }

    for (let x = 0; x < 76; x++) {
      let i: number;
      let uVar12: number;

      i = (i = x & 0xfffffffc);
        uVar12 = (sample[i + 3] + sample[i + 2] + sample[i + 1] + sample[i]) / 64;
      sadata[x] = uVar12;

      if (sadata[x] >= 15) {
        sadata[x] = 15;
      }
      safalloff[i] -= 24 / 16.0;

      if (safalloff[x] <= sadata[x]) {
        safalloff[x] = sadata[x];
      }

      if (sapeaks[x] <= (safalloff[x] * 256)) {
        sapeaks[x] = safalloff[x] * 256;
        sadata2[i] = 3.0;
      }

      const barPeak = sapeaks[x] / 256;
      sapeaks[x] -= sadata2[x];
      sadata2[x] *= 1.05;
      if (sapeaks[x] <= 0) {
          sapeaks[x] = 0;
      }

      //console.log(safalloff[0]);

      if (!(x == i + 3)) {
        this.paintBar(
          ctx,
          x,
          x,
          safalloff[x],
          barPeak
        );
      }
    }
  }

  /**
   * ⬜⬜
   * 🟧
   * 🟫🟧
   * 🟫🟫⬜⬜
   * 🟫🟫🟧
   * 🟫🟫🟫🟧⬜
   * 🟫🟫🟫🟫🟧
   * drawing 1pixel width bars
   */
  paintFrameThin() {
    if (!this._ctx) return;
    const ctx = this._ctx;
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = this._color;

    this._analyser.getByteFrequencyData(this._dataArray);
    const heightMultiplier = h / 256;
    for (let j = 0; j < w - 1; j++) {
      // const start = Math.round(j/w * this._dataArray.length);
      // const end = Math.round((j+1)/w * this._dataArray.length );
      const start = this._octaveBuckets[j];
      const end = this._octaveBuckets[j + 1];
      let amplitude = 0;
      //let weightingnum = 0;
      amplitude /= end - start;
      for (let i = start; i < end; i++) {
        //weightingnum += 6.6; //adds "weighting" to the analyzer
      }
      for (let k = start; k < end; k++) {
        amplitude = Math.max(
          amplitude,
          this._dataArray[k]/* * 3.4 - 600 + weightingnum*/
        ); //weightingnum used to try to correct the bias of the analyzer, but the last bar
        //kept being shot up high
      }

      // The drop rate should probably be normalized to the rendering FPS, for now assume 60 FPS
      let barPeak =
        this._barPeaks[j] -
        BAR_PEAK_DROP_RATE * Math.pow(this._barPeakFrames[j], 2);
      if (barPeak < amplitude) {
        barPeak = amplitude;
        this._barPeakFrames[j] = 0;
      } else {
        this._barPeakFrames[j] += 1;
      }
      if (barPeak < 10) {
        barPeak = 10;
        this._barPeakFrames[j] = 0;
      }
      if (barPeak > 255) {
        barPeak = 255;
        this._barPeakFrames[j] += 1;
      }
      this._barPeaks[j] = barPeak;

      // var x1 = Math.round(this._barWidth * j);
      // var x2 = Math.round(this._barWidth * (j + 1)) - 2;

      this.paintBar(
        ctx,
        // j /* * xOffset */,
        j,
        j,
        Math.round(amplitude * heightMultiplier),
        Math.round(barPeak * heightMultiplier)
      );
    }
  }

  /**
   * 🟥
   * 🟧🟧
   * 🟨🟨🟨
   * 🟩🟩🟩🟩
   */
  paintBarNormal(
    ctx: CanvasRenderingContext2D,
    // barIndex: number,
    x: number,
    x2: number,
    barHeight: number,
    peakHeight: number
  ) {
    // const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    // var x = Math.round(this._barWidth * barIndex);
    // var r = this._barWidth - 2;
    // var x2 = Math.round(this._barWidth * (barIndex + 1)) - 2;
    const y = h - barHeight;
    // var y = barHeight;

    // ctx.drawImage(this._bar, 0, y, 1, h - y, x, y, x2 - x + 1, h - y);
    ctx.drawImage(this._bar, 0, y, 1, h - y, x, y, x2 - x + 1, h - y);

    if (this._vis.peaks) {
      const peakY = h - peakHeight;
      ctx.drawImage(this._peak, 0, 0, 1, 1, x, peakY, x2 - x + 1, 1);
    }
  }

  /**
   * 🟥
   * 🟧🟥
   * 🟨🟧🟥
   * 🟩🟨🟧🟥
   */
  paintBarFire(
    ctx: CanvasRenderingContext2D,
    // barIndex: number,
    x: number,
    x2: number,
    barHeight: number,
    peakHeight: number
  ) {
    // const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    // var x = Math.round(this._barWidth * barIndex);
    // var r = this._barWidth - 2;
    // var x2 = Math.round(this._barWidth * (barIndex + 1)) - 2;
    let y = h - barHeight;

    // ctx.drawImage(this._bar, x, y, x2 - x + 1, h - y);
    ctx.drawImage(
      this._bar,
      0,
      0,
      this._bar.width,
      h - y,
      x,
      y,
      x2 - x + 1,
      h - y
    );

    if (this._vis.peaks) {
      const peakY = h - peakHeight;
      ctx.drawImage(this._peak, 0, 0, 1, 1, x, peakY, x2 - x + 1, 1);
    }
  }

  /**
   * 🟥
   * 🟥🟧
   * 🟥🟧🟨
   * 🟥🟧🟨🟩
   */
  paintBarLine(
    ctx: CanvasRenderingContext2D,
    // barIndex: number,
    x: number,
    x2: number,
    barHeight: number,
    peakHeight: number
  ) {
    // const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    // var x = Math.round(this._barWidth * barIndex);
    // var r = this._barWidth - 2;
    // var x2 = Math.round(this._barWidth * (barIndex + 1)) - 2;
    let y = h - barHeight;

    // ctx.drawImage(this._bar, x, y, x2 - x + 1, h - y);
    ctx.drawImage(
      this._bar,
      0, // sx
      0, // sy
      this._bar.width, // sw
      h - y, // sh
      x,
      y, //  dx,dy
      x2 - x + 1, //dw
      h - y //dh
    );

    if (this._vis.peaks) {
      const peakY = h - peakHeight;
      ctx.drawImage(this._peak, 0, 0, 1, 1, x, peakY, x2 - x + 1, 1);
    }
  }
}

//? =============================== OSCILOSCOPE PAINTER ===============================

type PaintWavFunction = (x: number, y: number, colorIndex: number) => void;
// Return the average value in a slice of dataArray
function sliceAverage(
  dataArray: Uint8Array,
  sliceWidth: number,
  sliceNumber: number
): number {
  const start = sliceWidth * sliceNumber;
  const end = start + sliceWidth;
  let sum = 0;
  for (let i = start; i < end; i++) {
    sum += dataArray[i];
  }
  return sum / sliceWidth;
}

function slice1st(
  dataArray: Uint8Array,
  sliceWidth: number,
  sliceNumber: number
): number {
  const start = sliceWidth * sliceNumber;
  // const end = start + sliceWidth;
  // let sum = 0;
  // for (let i = start; i < end; i++) {
  //   sum += dataArray[i];
  // }
  return dataArray[start];
}

export class WavePaintHandler extends VisPaintHandler {
  _analyser: AnalyserNode;
  _bufferLength: number;
  _lastX: number = 0;
  _lastY: number = 0;
  _dataArray: Uint8Array;
  _pixelRatio: number; // 1 or 2
  // Off-screen canvas for drawing perfect pixel (no blured lines)
  _bar: HTMLCanvasElement = document.createElement("canvas");
  _16h: HTMLCanvasElement = document.createElement("canvas"); // non-stretched
  paintWav: PaintWavFunction;
  _datafetched: boolean = false;
  // _colors2: string[];

  constructor(vis: Vis) {
    super(vis);
    this._analyser = this._vis.analyser!;
    this._bufferLength = this._analyser.fftSize;
    // this._octaveBuckets = octaveBucketsForBufferLength(this._bufferLength);
    this._dataArray = new Uint8Array(this._bufferLength);

    this._16h.width = 1;
    this._16h.height = 16;
    this._16h.setAttribute("width", "75");
    this._16h.setAttribute("height", "16");

    //* see https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio#monitoring_screen_resolution_or_zoom_level_changes
    this._pixelRatio = window.devicePixelRatio || 1;

    if (this._vis.oscStyle === "dots") {
      this.paintWav = this.paintWavDot.bind(this);
    } else if (this._vis.oscStyle === "solid") {
      this.paintWav = this.paintWavSolid.bind(this);
    } else {
      this.paintWav = this.paintWavLine.bind(this);
    }
  }

  prepare() {
    if (!this._ctx) {
      console.log("ctx not set!");
      return;
    }
    const vis = this._vis;
    // const groupId = vis._gammagroup;
    // const gammaGroup = this._vis._uiRoot._getGammaGroup(groupId);

    //? paint bar
    this._bar.width = 1;
    this._bar.height = 5;
    this._bar.setAttribute("width", "1");
    this._bar.setAttribute("height", "5");
    const ctx = this._bar.getContext("2d");
    if (ctx) {
      for (let y = 0; y < 5; y++) {
        // ctx.fillStyle = gammaGroup.transformColor(vis._colorOsc[y]);
        ctx.fillStyle = vis.colors[18 + y];
        ctx.fillRect(0, y, 1, y + 1);
      }
    }

    // this._ctx = vis.canvas.getContext("2d");
    this._ctx.imageSmoothingEnabled = false;
    // @ts-ignore
    this._ctx.mozImageSmoothingEnabled = false;
    // @ts-ignore
    this._ctx.webkitImageSmoothingEnabled = false;
    // @ts-ignore
    this._ctx.msImageSmoothingEnabled = false;

    this._datafetched = false;
  }

  paintFrame() {
    if (!this._ctx) return;
    this._analyser.getByteTimeDomainData(this._dataArray);
    // this._analyser.getFloatTimeDomainData(this._dataArray);
    this._dataArray = this._dataArray.slice(0, 576);
    const bandwidth = this._dataArray.length;

    //* to save and see in excel (bar chart)
    if (!this._datafetched) {
      // console.log(JSON.stringify(Array.from(this._dataArray)))
      this._datafetched = true;
    }

    const using16temporaryCanvas = this._vis.canvas!.height !== 16;

    if (using16temporaryCanvas) {
      this._ctx = this._16h.getContext("2d");
    }
    const width = this._ctx!.canvas.width;
    const height = this._ctx!.canvas.height;
    this._ctx!.clearRect(0, 0, width, height);

    const sliceWidth = Math.floor(/* this._bufferLength */ bandwidth / width);

    // Iterate over the width of the canvas in fixed 75 pixels.
    for (let j = 0; j <= width; j++) {
      // const amplitude = sliceAverage(this._dataArray, sliceWidth, j);
      const amplitude = slice1st(this._dataArray, sliceWidth, j);
      // -4 is set to off center the oscilloscope
      // because completely centered looks a bit weird
      const [y, colorIndex] = this.rangeByAmplitude(amplitude+4);
      const x = j; /* * PIXEL_DENSITY */

      this.paintWav(x, y, colorIndex);
    }

    if (using16temporaryCanvas) {
      const canvas = this._vis.canvas!;
      const visCtx = canvas.getContext("2d")!;
      visCtx.clearRect(0, 0, canvas.width, canvas.height);
      visCtx.drawImage(
        this._16h,
        0,
        0, // sx,sy
        75,
        16, // sw,sh
        0,
        0, //dx,dy
        canvas.width,
        canvas.height //dw,dh
      );
    }
  }

  /**
   *
   * @param amplitude 0..255
   * @returns xy.Y(top to bottom), colorOscIndex
   */
  rangeByAmplitude(amplitude: number): [number, number] {
    //odjasdjflasjdf;lasjdf;asjd;fjasd;fsajdf
    if (amplitude >= 184) {
      return [0, 3];
    }
    if (amplitude >= 176) {
      return [1, 3];
    }
    if (amplitude >= 168) {
      return [2, 2];
    }
    if (amplitude >= 160) {
      return [3, 2];
    }
    if (amplitude >= 152) {
      return [4, 1];
    }
    if (amplitude >= 144) {
      return [5, 1];
    }
    if (amplitude >= 136) {
      return [6, 0];
    }
    if (amplitude >= 128) {
      return [7, 0];
    }
    if (amplitude >= 120) {
      return [8, 1];
    }
    if (amplitude >= 112) {
      return [9, 1];
    }
    if (amplitude >= 104) {
      return [10, 2];
    }
    if (amplitude >= 96) {
      return [11, 2];
    }
    if (amplitude >= 88) {
      return [12, 3];
    }
    if (amplitude >= 80) {
      return [13, 3];
    }
    if (amplitude >= 72) {
      return [14, 4];
    }
    // if(amplitude>=56){return [15, 4]}
    return [15, 4];
  }

  paintWavLine(x: number, y: number, colorIndex: number) {
    if (x === 0) this._lastY = y;

    let top = y;
    let bottom = this._lastY;
    this._lastY = y;

    if (bottom < top) {
      [bottom, top] = [top, bottom];
      top++; //top++, that emulates Winamp's/WACUP's OSC behavior correctly
    }
    // const h = bottom - top + 1;

    for (y = top; y <= bottom; y++) {
      this._ctx!.drawImage(
        this._bar,
        0,
        colorIndex, // sx,sy
        1,
        1, // sw,sh
        x, y, //dx,dy, dy is upside down because Winamp3/Winamp5 does it, so we have to emulate it
        //set to x, y, for Winamp Classic behavior
        1,
        1 //dw,dh
      );
    }
  }

  paintWavDot(x: number, y: number, colorIndex: number) {
    this._ctx!.drawImage(
      this._bar,
      0,
      colorIndex, // sx,sy
      1,
      1, // sw,sh
      x, y, //dx,dy, dy is upside down because Winamp3/Winamp5 does it, so we have to emulate it
      //set to x, y, for Winamp Classic behavior
      1,
      1 //dw,dh
    );
  }

  paintWavSolid(x: number, y: number, colorIndex: number) {
    let top, bottom;
    if (y >= 8) {
      top = 8;
      bottom = y;
    } else {
      top = y;
      bottom = 7;
    }
    // const h = bottom - top + 1;
    for (y = top; y <= bottom; y++) {
      this._ctx!.drawImage(
        this._bar,
        0,
        colorIndex, // sx,sy
        1,
        1, // sw,sh
        x, y, //dx,dy, dy is upside down because Winamp3/Winamp5 does it, so we have to emulate it
        //set to x, y, for Winamp Classic behavior
        1,
        1 //dw,dh
      );
    }
  }
}

export class NoVisualizerHandler extends VisPaintHandler {
  cleared: boolean = false;
  prepare() {
    this.cleared = false;
  }

  paintFrame() {
    if (!this._ctx) return;
    const ctx = this._ctx;
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    this.cleared = true;
  }
}
