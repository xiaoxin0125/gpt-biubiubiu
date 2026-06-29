import { useEffect, useState } from 'react';

const getScrollAncestors = (target) => {
  if (typeof document === 'undefined' || !target) return [];

  const ancestors = [];
  let parent = target.parentElement;
  while (parent) {
    ancestors.push(parent);
    parent = parent.parentElement;
  }

  const root = document.scrollingElement || document.documentElement;
  return root ? [...ancestors, root] : ancestors;
};

const getTargets = (targetRef, targetRefs) => {
  const refs = targetRefs?.length ? targetRefs : targetRef ? [targetRef] : [];
  const elements = refs.map((ref) => ref?.current).filter(Boolean);
  return Array.from(new Set(elements.flatMap((element) => [element, ...getScrollAncestors(element)])));
};

const canScroll = (target) => target.scrollHeight > target.clientHeight + 8;

const getActiveTarget = (targets, threshold) => (
  targets.find((target) => canScroll(target) && target.scrollTop > threshold)
  || targets.find(canScroll)
  || null
);

export default function ScrollTopButton({
  targetRef,
  targetRefs,
  className = '',
  label = '返回顶部',
  refreshKey = '',
  threshold = 80,
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let frame = 0;

    const update = () => {
      const activeTarget = getActiveTarget(getTargets(targetRef, targetRefs), threshold);
      setVisible(Boolean(activeTarget && activeTarget.scrollTop > threshold));
    };

    const requestUpdate = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(update);
    };

    const targets = getTargets(targetRef, targetRefs);
    requestUpdate();

    if (!targets.length) {
      return () => window.cancelAnimationFrame(frame);
    }

    targets.forEach((target) => target.addEventListener('scroll', requestUpdate, { passive: true }));
    window.addEventListener('resize', requestUpdate);

    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(requestUpdate);
    targets.forEach((target) => resizeObserver?.observe(target));

    return () => {
      window.cancelAnimationFrame(frame);
      targets.forEach((target) => target.removeEventListener('scroll', requestUpdate));
      window.removeEventListener('resize', requestUpdate);
      resizeObserver?.disconnect();
    };
  }, [refreshKey, targetRef, targetRefs, threshold]);

  const scrollToTop = () => {
    const activeTarget = getActiveTarget(getTargets(targetRef, targetRefs), 0);
    activeTarget?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <button
      type="button"
      className={`scroll-top-button${visible ? ' is-visible' : ''}${className ? ` ${className}` : ''}`}
      onClick={scrollToTop}
      aria-label={label}
      title={label}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 19V5" />
        <path d="m5 12 7-7 7 7" />
      </svg>
    </button>
  );
}