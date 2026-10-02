const DEFAULT_CROP_SIZE = 280;
const DEFAULT_OUTPUT_SIZE = 512;

function loadImageElement(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load image'));
    img.src = dataUrl;
  });
}

export function getCoverMinZoom(imageSize, cropSize = DEFAULT_CROP_SIZE) {
  if (!imageSize?.width || !imageSize?.height) return 1;
  return Math.max(cropSize / imageSize.width, cropSize / imageSize.height);
}

export function getDisplayedSize(imageSize, minZoom, zoom) {
  const scale = minZoom * zoom;
  return {
    width: imageSize.width * scale,
    height: imageSize.height * scale,
    scale,
  };
}

export function clampCropPosition(position, displayedSize, cropSize = DEFAULT_CROP_SIZE) {
  const { width, height } = displayedSize;
  const clampAxis = (value, displayed, crop) => {
    if (displayed <= crop) return 0;
    const min = crop / 2 - displayed / 2;
    const max = displayed / 2 - crop / 2;
    return Math.min(max, Math.max(min, value));
  };

  return {
    x: clampAxis(position.x, width, cropSize),
    y: clampAxis(position.y, height, cropSize),
  };
}

export function getInitialCropState(imageSize, cropSize = DEFAULT_CROP_SIZE) {
  const minZoom = getCoverMinZoom(imageSize, cropSize);
  return {
    zoom: 1,
    minZoom,
    position: { x: 0, y: 0 },
  };
}

/**
 * Export a circular avatar PNG from pan/zoom crop state (Instagram-style).
 */
export async function exportCircularCrop(
  imageSrc,
  {
    imageSize,
    zoom,
    position,
    cropSize = DEFAULT_CROP_SIZE,
    outputSize = DEFAULT_OUTPUT_SIZE,
  },
) {
  const img = await loadImageElement(imageSrc);
  const minZoom = getCoverMinZoom(imageSize, cropSize);
  const { width: displayedWidth, height: displayedHeight, scale } = getDisplayedSize(
    imageSize,
    minZoom,
    zoom,
  );

  const sourceX = (0 - cropSize / 2 + displayedWidth / 2 - position.x) / scale;
  const sourceY = (0 - cropSize / 2 + displayedHeight / 2 - position.y) / scale;
  const sourceSize = cropSize / scale;

  const canvas = document.createElement('canvas');
  canvas.width = outputSize;
  canvas.height = outputSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create canvas');

  ctx.save();
  ctx.beginPath();
  ctx.arc(outputSize / 2, outputSize / 2, outputSize / 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, outputSize, outputSize);
  ctx.drawImage(img, sourceX, sourceY, sourceSize, sourceSize, 0, 0, outputSize, outputSize);
  ctx.restore();

  return canvas.toDataURL('image/png');
}

export function dataUrlToBlob(dataUrl) {
  return fetch(dataUrl).then((res) => res.blob());
}

export async function exportCircularCropBlob(
  imageSrc,
  options,
) {
  const dataUrl = await exportCircularCrop(imageSrc, options);
  return dataUrlToBlob(dataUrl);
}

export { DEFAULT_CROP_SIZE, DEFAULT_OUTPUT_SIZE };
