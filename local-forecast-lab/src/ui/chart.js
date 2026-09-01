function extent(values) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return [0, 1];
  let min = Math.min(...finite);
  let max = Math.max(...finite);
  if (min === max) {
    min -= Math.abs(min || 1) * 0.1;
    max += Math.abs(max || 1) * 0.1;
  }
  return [min, max];
}

export function drawForecastChart(canvas, series, options = {}) {
  const context = canvas.getContext('2d');
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 900;
  const height = canvas.clientHeight || 360;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  if (!series) return;
  const history = series.history.slice(-Math.min(series.history.length, options.historyPoints ?? 180));
  const forecast = series.forecast;
  const q10 = forecast.map((row) => row.quantiles['0.1']);
  const q90 = forecast.map((row) => row.quantiles['0.9']);
  const point = forecast.map((row) => row.point);
  const values = [...history, ...q10, ...q90, ...point];
  const [min, max] = extent(values);
  const padding = { left: 56, right: 18, top: 22, bottom: 34 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const total = history.length + forecast.length;
  const x = (index) => padding.left + (index / Math.max(1, total - 1)) * plotWidth;
  const y = (value) => padding.top + (1 - (value - min) / (max - min)) * plotHeight;

  context.strokeStyle = '#d7dce3';
  context.lineWidth = 1;
  context.fillStyle = '#5b6573';
  context.font = '12px system-ui';
  for (let grid = 0; grid <= 4; grid += 1) {
    const value = min + ((max - min) * grid) / 4;
    const yy = y(value);
    context.beginPath();
    context.moveTo(padding.left, yy);
    context.lineTo(width - padding.right, yy);
    context.stroke();
    context.fillText(value.toFixed(2), 4, yy + 4);
  }

  if (forecast.length) {
    context.fillStyle = 'rgba(55, 104, 222, 0.14)';
    context.beginPath();
    q90.forEach((value, index) => {
      const xx = x(history.length + index);
      if (index === 0) context.moveTo(xx, y(value));
      else context.lineTo(xx, y(value));
    });
    for (let index = q10.length - 1; index >= 0; index -= 1) context.lineTo(x(history.length + index), y(q10[index]));
    context.closePath();
    context.fill();
  }

  const line = (valuesToDraw, startIndex, strokeStyle, lineWidth) => {
    context.strokeStyle = strokeStyle;
    context.lineWidth = lineWidth;
    context.beginPath();
    let started = false;
    valuesToDraw.forEach((value, index) => {
      if (!Number.isFinite(value)) {
        started = false;
        return;
      }
      const xx = x(startIndex + index);
      const yy = y(value);
      if (!started) {
        context.moveTo(xx, yy);
        started = true;
      } else context.lineTo(xx, yy);
    });
    context.stroke();
  };

  line(history, 0, '#222b38', 1.8);
  if (history.length && point.length) line([history.at(-1), ...point], history.length - 1, '#3768de', 2.2);

  const boundary = x(history.length - 0.5);
  context.strokeStyle = '#8a95a5';
  context.setLineDash([5, 5]);
  context.beginPath();
  context.moveTo(boundary, padding.top);
  context.lineTo(boundary, height - padding.bottom);
  context.stroke();
  context.setLineDash([]);
  context.fillStyle = '#5b6573';
  context.fillText('forecast', boundary + 7, padding.top + 14);
}
