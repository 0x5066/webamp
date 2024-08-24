import React, {
  useMemo,
  useCallback,
  useState,
  useLayoutEffect,
  useEffect,
} from "react";

import * as Actions from "../actionCreators";
import * as Selectors from "../selectors";
import { useTypedSelector, useActionCreator } from "../hooks";
// import { usePaintOscilloscopeFrame } from "./useOscilloscopeVisualizer";
// import { usePaintBarFrame, usePaintBar } from "./useBarVisualizer";
import { VISUALIZERS, MEDIA_STATUS } from "../constants";

import {
  Vis as IVis,
  VisPaintHandler,
  BarPaintHandler,
  WavePaintHandler,
  NoVisualizerHandler,
  processFFT,
} from "./VisPainter";

type Props = {
  analyser: AnalyserNode;
};

export let PIXEL_DENSITY = 1;
export let renderHeight: number;
export let windowShade: boolean | undefined;
export let doubled: boolean | undefined;

// Pre-render the background grid
function preRenderBg(
  width: number,
  height: number,
  bgColor: string,
  fgColor: string,
  windowShade: boolean
): HTMLCanvasElement {
  // Off-screen canvas for pre-rendering the background
  const bgCanvas = document.createElement("canvas");
  bgCanvas.width = width;
  bgCanvas.height = height;
  const distance = 2 * PIXEL_DENSITY;

  const bgCanvasCtx = bgCanvas.getContext("2d");
  if (bgCanvasCtx == null) {
    throw new Error("Could not construct canvas context");
  }
  bgCanvasCtx.fillStyle = bgColor;
  bgCanvasCtx.fillRect(0, 0, width, height);
  if (!windowShade) {
    bgCanvasCtx.fillStyle = fgColor;
    for (let x = 0; x < width; x += distance) {
      for (let y = PIXEL_DENSITY; y < height; y += distance) {
        bgCanvasCtx.fillRect(x, y, PIXEL_DENSITY, PIXEL_DENSITY);
      }
    }
  }
  return bgCanvas;
}

export default function Vis({ analyser }: Props) {
  useLayoutEffect(() => {
    analyser.fftSize = 1024;
  }, [analyser, analyser.fftSize]);
  const colors = useTypedSelector(Selectors.getSkinColors);
  const mode = useTypedSelector(Selectors.getVisualizerStyle);
  const audioStatus = useTypedSelector(Selectors.getMediaStatus);
  const getWindowShade = useTypedSelector(Selectors.getWindowShade);
  doubled = useTypedSelector(Selectors.getDoubled);
  const dummyVizData = useTypedSelector(Selectors.getDummyVizData);

  const dataArray = new Uint8Array(1024);
  analyser.getByteTimeDomainData(dataArray);

  const toggleVisualizerStyle = useActionCreator(Actions.toggleVisualizerStyle);
  windowShade = getWindowShade("main");
  // BUG: windowshade does not take into account if the main window is visible (small vis is in pledit)
  // how can i know the state of individual windows?
  const renderWidth = windowShade ? 38 : 75;
  renderHeight = windowShade ? 5 : 16;
  PIXEL_DENSITY = doubled && windowShade ? 2 : 1;

  const width = renderWidth * PIXEL_DENSITY;
  const height = renderHeight * PIXEL_DENSITY;

  const bgCanvas = useMemo(() => {
    return preRenderBg(
      width,
      height,
      colors[0],
      colors[1],
      Boolean(windowShade)
    );
  }, [colors, height, width, windowShade]);

  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);

  //? painter administration
  const [painter, setPainter] = useState<VisPaintHandler | null>(null);

  useEffect(() => {
    if (!canvas) return;
    const _setPainter = (PainterType: typeof VisPaintHandler) => {
      const _vis: IVis = {
        canvas,
        colors,
        analyser,
        oscStyle: "lines",
        bandwidth: "wide",
        coloring: "normal",
        peaks: true,
        safalloff: "moderate",
        sa_peak_falloff: "slow",
        sa: "analyzer",
      };
      const newPainter = new PainterType(_vis);
      setPainter(newPainter);
    };
    switch (mode) {
      case VISUALIZERS.OSCILLOSCOPE:
        _setPainter(WavePaintHandler);
        break;
      case VISUALIZERS.BAR:
        _setPainter(BarPaintHandler);
        break;
      case VISUALIZERS.NONE:
        _setPainter(NoVisualizerHandler);
        break;
      default:
        _setPainter(NoVisualizerHandler);
    }
  }, [analyser, canvas, mode, colors]);

  useEffect(() => {
    if (canvas == null || painter == null) {
      return;
    }

    const canvasCtx = canvas.getContext("2d");
    if (canvasCtx == null) {
      return;
    }
    canvasCtx.imageSmoothingEnabled = false;

    let animationRequest: number | null = null;

    const loop = () => {
      painter.prepare();
      processFFT(analyser);
      painter.paintFrame();
      animationRequest = window.requestAnimationFrame(loop);
    };

    if (audioStatus === MEDIA_STATUS.PLAYING) {
      loop();
    } else if (animationRequest !== null) {
      // Clean up the animation frame request if the status is not PLAYING
      window.cancelAnimationFrame(animationRequest);
      animationRequest = null;
    }

    return () => {
      if (animationRequest !== null) {
        window.cancelAnimationFrame(animationRequest);
      }
    };
  }, [audioStatus, canvas, painter]);

  if (audioStatus === MEDIA_STATUS.STOPPED) {
    return null;
  }
  // @ts-ignore

  // @ts-ignore
  return (
    <canvas
      id="visualizer"
      ref={setCanvas}
      style={{ width: renderWidth, height: renderHeight }}
      width={width}
      height={height}
      onClick={toggleVisualizerStyle}
    />
  );
}
