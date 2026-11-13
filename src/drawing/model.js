export const drawingTools = ['pointer', 'pen', 'highlighter', 'eraser', 'text', 'rectangle', 'ellipse', 'line', 'arrow'];
export const drawingDefaults = { tool: 'pen', color: '#7C5CFC', width: 5, opacity: 1, visible: true };

export function sanitizeDrawingConfig(value = {}, previous = drawingDefaults) {
  return {
    tool: drawingTools.includes(value.tool) ? value.tool : previous.tool,
    color: /^#[\da-f]{6}$/i.test(value.color) ? value.color : previous.color,
    width: Number.isFinite(value.width) ? Math.max(1, Math.min(40, value.width)) : previous.width,
    opacity: Number.isFinite(value.opacity) ? Math.max(0.05, Math.min(1, value.opacity)) : previous.opacity,
    visible: typeof value.visible === 'boolean' ? value.visible : previous.visible,
  };
}

export function paintOperation(context, operation) {
  const { tool, points, color, width, opacity } = operation;
  const start = points[0];
  const end = points[points.length - 1];
  context.save();
  context.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
  context.globalAlpha = tool === 'eraser' ? 1 : opacity * (tool === 'highlighter' ? 0.35 : 1);
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = width * (tool === 'highlighter' ? 4 : tool === 'eraser' ? 3 : 1);
  context.lineCap = 'round';
  context.lineJoin = 'round';

  if (tool === 'text') {
    const size = Math.max(12, width * 4);
    context.font = `500 ${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    context.textBaseline = 'top';
    operation.text.split('\n').forEach((line, index) => {
      context.fillText(line, start.x, start.y + index * size * 1.25);
    });
  } else if (tool === 'rectangle') {
    context.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
  } else if (tool === 'ellipse') {
    context.beginPath();
    context.ellipse((start.x + end.x) / 2, (start.y + end.y) / 2, Math.max(0.5, Math.abs(end.x - start.x) / 2), Math.max(0.5, Math.abs(end.y - start.y) / 2), 0, 0, Math.PI * 2);
    context.stroke();
  } else {
    context.beginPath();
    context.moveTo(start.x, start.y);

    if (tool === 'line' || tool === 'arrow') {
      context.lineTo(end.x, end.y);
    } else if (points.length === 1) {
      context.lineTo(start.x + 0.01, start.y);
    } else {
      for (const point of points.slice(1)) {
        context.lineTo(point.x, point.y);
      }
    }

    context.stroke();

    if (tool === 'arrow') {
      const angle = Math.atan2(end.y - start.y, end.x - start.x);
      const length = Math.max(14, width * 4);
      context.beginPath();
      context.moveTo(end.x - length * Math.cos(angle - Math.PI / 6), end.y - length * Math.sin(angle - Math.PI / 6));
      context.lineTo(end.x, end.y);
      context.lineTo(end.x - length * Math.cos(angle + Math.PI / 6), end.y - length * Math.sin(angle + Math.PI / 6));
      context.stroke();
    }
  }

  context.restore();
}
