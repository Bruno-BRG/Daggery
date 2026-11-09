import { useEffect, useRef, type RefObject } from 'react';
import { Application } from 'pixi.js';
import { MapView, type ViewState } from './view';

/** Hosts the Pixi canvas. The view is created once; every render pushes the latest state into it. */
export function MapStage({ state, handle }: { state: ViewState; handle: RefObject<MapView | null> }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const latest = useRef(state);
  latest.current = state;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let view: MapView | null = null;
    let observer: ResizeObserver | null = null;
    const app = new Application();

    void app
      .init({
        resizeTo: host,
        backgroundAlpha: 0,
        antialias: true,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
        // MapView draws when its state changes (requestRender). The ticker runs only while pings animate.
        autoStart: false,
      })
      .then(() => {
        if (disposed) {
          app.destroy(true, { children: true });
          return;
        }
        host.appendChild(app.canvas);
        view = new MapView(app);
        handle.current = view;
        view.update(latest.current);
        observer = new ResizeObserver(() => {
          app.resize();
          view?.requestRender();
        });
        observer.observe(host);
      });

    return () => {
      disposed = true;
      observer?.disconnect();
      handle.current = null;
      if (view) {
        view.destroy();
        app.destroy(true, { children: true });
      }
    };
  }, [handle]);

  useEffect(() => {
    handle.current?.update(state);
  });

  return <div ref={hostRef} className="absolute inset-0 overflow-hidden" />;
}
