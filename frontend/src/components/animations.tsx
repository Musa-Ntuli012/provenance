/**
 * Lottie feedback states, the app's four shared animations:
 *   sandy-loading    → loading states
 *   no-data          → empty states / data that cannot be seen or received
 *   Failed           → failed states (actions that didn't go through)
 *   success-animation→ successful results & state changes
 *
 * Accessibility: under `prefers-reduced-motion` the animations hold a static
 * frame instead of looping (loading falls back to a quiet pulse), per the
 * design system's reduced-motion rule.
 */
import { useEffect, useRef } from 'react';
import lottie, { AnimationItem } from 'lottie-web';

import failedJson from '../assets/animations/Failed.json';
import noDataJson from '../assets/animations/no-data.json';
import sandyLoadingJson from '../assets/animations/sandy-loading.json';
import successJson from '../assets/animations/success-animation.json';

export const ANIMATIONS = { failedJson, noDataJson, sandyLoadingJson, successJson };

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function Animation({
  data,
  width,
  height,
  loop = true,
  className,
  label,
  reducedFrame = 'first',
}: {
  data: unknown;
  width?: number | string;
  height?: number | string;
  loop?: boolean;
  className?: string;
  label?: string;
  reducedFrame?: 'first' | 'last' | number;
}) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!host.current) return;
    let item: AnimationItem | null = null;
    const reduced = prefersReducedMotion();
    try {
      item = lottie.loadAnimation({
        container: host.current,
        renderer: 'svg',
        loop: reduced ? false : loop,
        autoplay: !reduced,
        animationData: JSON.parse(JSON.stringify(data)),
      });
      if (reduced) {
        item.addEventListener('DOMLoaded', () => {
          const frame =
            reducedFrame === 'last'
              ? Math.max(0, (item?.totalFrames ?? 1) - 1)
              : typeof reducedFrame === 'number'
                ? reducedFrame
                : 0;
          item?.goToAndStop(frame, true);
        });
      }
    } catch (err) {
      // A broken animation must never break the screen around it.
      console.error('animation failed to load', err instanceof Error ? err.message : err);
    }
    return () => item?.destroy();
  }, [data, loop, reducedFrame]);

  return (
    <div
      ref={host}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={className}
      style={{ width: width ?? 160, height: height ?? 120, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}
    />
  );
}

/* ========================= Loading (sandy-loading) ======================= */

export function Loading({ label = 'Loading', size = 140 }: { label?: string; size?: number }) {
  if (prefersReducedMotion()) {
    return (
      <div className="loading-block" role="status" aria-label={label}>
        <span className="skeleton" style={{ width: size, height: size / 3 }} />
      </div>
    );
  }
  return (
    <div className="loading-block" role="status" aria-label={label}>
      <Animation data={sandyLoadingJson} width={size} height={size} label={label} reducedFrame="first" />
    </div>
  );
}

/* ============= Empty / data unavailable (no-data, tumbleweed) ============ */

export function NoData({ size = 220 }: { size?: number }) {
  return <Animation data={noDataJson} width={size} height={Math.round(size * 0.405)} reducedFrame="first" />;
}

/** Fetch failed / data cannot be received right now. */
export function LoadError({ onRetry, message = 'We couldn’t load this right now.' }: { onRetry?: () => void; message?: string }) {
  return (
    <div className="empty">
      <NoData />
      <h3>Nothing came back</h3>
      <p className="fine" style={{ margin: 0, maxWidth: '44ch' }}>{message}</p>
      {onRetry ? (
        <button className="btn secondary sm" onClick={onRetry}>Try again</button>
      ) : null}
    </div>
  );
}

/* =========================== Failed (action errors) ======================= */

/** Inline banner for a failed action (submit rejected, save failed, …). */
export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="error-banner" role="alert">
      <Animation data={failedJson} width={54} height={54} loop={false} reducedFrame="last" />
      <span>{message}</span>
    </div>
  );
}

/* ========================= Success (state changes) ======================== */

/** Full celebration for a completed action, rendered by the toast provider. */
export function SuccessFlash({ message }: { message: string }) {
  return (
    <div className="success-flash" role="status">
      <Animation data={successJson} width={170} height={153} loop={false} reducedFrame="last" />
      <span className="success-flash-msg">{message}</span>
    </div>
  );
}
