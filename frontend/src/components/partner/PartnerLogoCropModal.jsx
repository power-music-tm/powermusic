import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Modal } from '../ui';
import {
  clampCropPosition,
  DEFAULT_CROP_SIZE,
  exportCircularCrop,
  getDisplayedSize,
  getInitialCropState,
} from '../../utils/cropPartnerLogo';

function CropViewport({
  imageSrc,
  imageSize,
  cropSize,
  zoom,
  position,
  onPositionChange,
  onZoomChange,
}) {
  const viewportRef = useRef(null);
  const dragRef = useRef(null);

  const minZoom = useMemo(
    () => (imageSize ? Math.max(cropSize / imageSize.width, cropSize / imageSize.height) : 1),
    [cropSize, imageSize],
  );
  const displayed = useMemo(
    () => (imageSize ? getDisplayedSize(imageSize, minZoom, zoom) : null),
    [imageSize, minZoom, zoom],
  );

  const clampPosition = useCallback(
    (next) => clampCropPosition(next, displayed ?? { width: 0, height: 0 }, cropSize),
    [cropSize, displayed],
  );

  const handlePointerDown = (event) => {
    if (!displayed) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: { ...position },
    };
  };

  const handlePointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    onPositionChange(
      clampPosition({
        x: drag.origin.x + event.clientX - drag.startX,
        y: drag.origin.y + event.clientY - drag.startY,
      }),
    );
  };

  const handlePointerUp = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const handleWheel = (event) => {
    event.preventDefault();
    const delta = event.deltaY > 0 ? -0.08 : 0.08;
    onZoomChange(Math.min(3, Math.max(1, zoom + delta)));
  };

  if (!imageSrc || !imageSize || !displayed) {
    return (
      <div
        className="mx-auto flex items-center justify-center rounded-2xl bg-[#1a1a1a]"
        style={{ width: cropSize, height: cropSize }}
      >
        <Loader2 className="h-6 w-6 animate-spin text-white/70" aria-hidden="true" />
      </div>
    );
  }

  const imageLeft = cropSize / 2 - displayed.width / 2 + position.x;
  const imageTop = cropSize / 2 - displayed.height / 2 + position.y;

  return (
    <div className="mx-auto select-none">
      <div
        ref={viewportRef}
        className="relative touch-none overflow-hidden rounded-2xl bg-[#1a1a1a]"
        style={{ width: cropSize, height: cropSize }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
        role="presentation"
      >
        <img
          src={imageSrc}
          alt=""
          draggable={false}
          className="absolute max-w-none"
          style={{
            width: displayed.width,
            height: displayed.height,
            left: imageLeft,
            top: imageTop,
          }}
        />
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 rounded-full border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.58)]"
          style={{
            width: cropSize,
            height: cropSize,
            transform: 'translate(-50%, -50%)',
          }}
          aria-hidden="true"
        />
      </div>

      <label className="mt-5 block">
        <span className="sr-only">Zoom</span>
        <input
          type="range"
          min={1}
          max={3}
          step={0.01}
          value={zoom}
          onChange={(event) => onZoomChange(Number(event.target.value))}
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[var(--color-border-default)] accent-[var(--color-brand-primary)]"
        />
      </label>
      <p className="mt-2 text-center text-xs text-[var(--color-text-muted)]">
        Drag to reposition · Scroll or slide to zoom
      </p>
    </div>
  );
}

export default function PartnerLogoCropModal({
  isOpen,
  imageSrc,
  onCancel,
  onConfirm,
  busy = false,
}) {
  const [imageSize, setImageSize] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!isOpen || !imageSrc) {
      setImageSize(null);
      setZoom(1);
      setPosition({ x: 0, y: 0 });
      return undefined;
    }

    let active = true;
    const img = new Image();
    img.onload = () => {
      if (!active) return;
      const size = { width: img.naturalWidth, height: img.naturalHeight };
      setImageSize(size);
      const initial = getInitialCropState(size, DEFAULT_CROP_SIZE);
      setZoom(initial.zoom);
      setPosition(initial.position);
    };
    img.onerror = () => {
      if (active) setImageSize(null);
    };
    img.src = imageSrc;

    return () => {
      active = false;
    };
  }, [isOpen, imageSrc]);

  const handleZoomChange = (nextZoom) => {
    setZoom(nextZoom);
    if (!imageSize) return;
    const minZoom = Math.max(
      DEFAULT_CROP_SIZE / imageSize.width,
      DEFAULT_CROP_SIZE / imageSize.height,
    );
    const displayed = getDisplayedSize(imageSize, minZoom, nextZoom);
    setPosition((prev) => clampCropPosition(prev, displayed, DEFAULT_CROP_SIZE));
  };

  const handleConfirm = async () => {
    if (!imageSrc || !imageSize || exporting || busy) return;
    setExporting(true);
    try {
      const cropped = await exportCircularCrop(imageSrc, {
        imageSize,
        zoom,
        position,
      });
      await onConfirm(cropped);
    } finally {
      setExporting(false);
    }
  };

  const confirmDisabled = !imageSrc || !imageSize || exporting || busy;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title="Edit profile photo"
      footer={
        <>
          <button
            type="button"
            onClick={onCancel}
            disabled={exporting || busy}
            className="inline-flex h-10 items-center justify-center rounded-lg px-5 text-sm font-semibold text-[var(--color-text-primary)] ring-1 ring-[var(--color-border-default)] transition-colors hover:bg-[var(--color-surface-highlight)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={confirmDisabled}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[var(--color-brand-primary)] px-5 text-sm font-semibold text-white transition-colors hover:bg-[var(--color-surface-sidebar-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {exporting || busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Done
          </button>
        </>
      }
    >
      <CropViewport
        imageSrc={imageSrc}
        imageSize={imageSize}
        cropSize={DEFAULT_CROP_SIZE}
        zoom={zoom}
        position={position}
        onPositionChange={setPosition}
        onZoomChange={handleZoomChange}
      />
    </Modal>
  );
}
