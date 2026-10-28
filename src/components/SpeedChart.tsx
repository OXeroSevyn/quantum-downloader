import React, { useEffect, useRef } from 'react';

interface Props {
  currentSpeed: number; // in bytes/sec
}

export const SpeedChart: React.FC<Props> = ({ currentSpeed }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const historyRef = useRef<number[]>(new Array(30).fill(0));

  useEffect(() => {
    const speedMB = currentSpeed / (1024 * 1024);
    historyRef.current.push(speedMB);
    if (historyRef.current.length > 30) {
      historyRef.current.shift();
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    const history = historyRef.current;
    const maxVal = Math.max(...history, 5); // at least 5 MB scale

    // Draw grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    // Draw path
    ctx.beginPath();
    const step = width / (history.length - 1);
    history.forEach((val, i) => {
      const x = i * step;
      const y = height - (val / maxVal) * (height - 8);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    ctx.strokeStyle = '#00f2fe';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Fill gradient
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, 'rgba(0, 242, 254, 0.25)');
    grad.addColorStop(1, 'rgba(0, 242, 254, 0.0)');
    ctx.fillStyle = grad;
    ctx.fill();
  }, [currentSpeed]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <canvas
        ref={canvasRef}
        width={100}
        height={32}
        style={{ borderRadius: '4px', background: 'rgba(0,0,0,0.2)' }}
      />
    </div>
  );
};
