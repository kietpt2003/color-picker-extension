export const drawingExportModes = ['drawing', 'web', 'screen'];

export function downloadDrawing(data, mode = 'drawing') {
  const link = document.createElement('a');
  link.href = data;
  link.download = `color-picker-${drawingExportModes.includes(mode) ? mode : 'drawing'}.png`;
  link.click();
}

export async function compositeDrawing(background, drawing, { x = 0, y = 0, width, height, crop = null } = {}) {
  const images = [];
  try {
    const load = async (source) => {
      try {
        // NOTE: Decode local bytes directly; webpage img-src policies must not block a screenshot composite.
        const bytes = Uint8Array.from(atob(source.split(',')[1]), (character) => { return character.charCodeAt(0); });
        const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        images.push(image);
        return image;
      } catch {
        throw new Error('drawExportError');
      }
    };
    const [base, layer] = await Promise.all([load(background), load(drawing)]);
    const canvas = document.createElement('canvas');
    canvas.width = base.width;
    canvas.height = base.height;
    const context = canvas.getContext('2d');
    context.drawImage(base, 0, 0);
    context.drawImage(layer, x, y, width ?? canvas.width, height ?? canvas.height);

    if (!crop) {
      return canvas.toDataURL('image/png');
    }

    const left = Math.max(0, Math.min(canvas.width - 1, Math.round(crop.x)));
    const top = Math.max(0, Math.min(canvas.height - 1, Math.round(crop.y)));
    const result = document.createElement('canvas');
    result.width = Math.max(1, Math.min(canvas.width - left, Math.round(crop.width)));
    result.height = Math.max(1, Math.min(canvas.height - top, Math.round(crop.height)));
    result.getContext('2d').drawImage(canvas, left, top, result.width, result.height, 0, 0, result.width, result.height);
    return result.toDataURL('image/png');
  } catch (error) {
    throw error;
  } finally {
    images.forEach((image) => { image.close(); });
  }
}
