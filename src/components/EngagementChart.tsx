import { useEffect, useRef, useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { cn } from '@/lib/utils';

export type EngagementChartPoint = {
  name: string;
  ig: number;
  fb: number;
  tiktok?: number;
  total?: number;
};

const fmt = (n: number) => n.toLocaleString('id-ID');

export default function EngagementChart({ data }: { data: EngagementChartPoint[] }) {
  const hasData = data.some((d) => (d.ig || 0) + (d.fb || 0) + (d.tiktok || 0) > 0);
  // Only show the TikTok bar/legend key when there is TikTok data to display.
  const hasTiktok = data.some((d) => (d.tiktok || 0) > 0);

  // Recharts mengukur container saat mount; pada render pertama ukurannya bisa
  // -1 sehingga memunculkan peringatan. Tunggu ukuran valid sebelum render chart.
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      const width = Math.floor(r.width);
      const height = Math.floor(r.height);
      if (width > 0 && height > 0) setSize((prev) =>
        prev.width === width && prev.height === height ? prev : { width, height }
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={wrapRef} className="relative h-full min-h-[200px] w-full">
      {size.width > 0 && size.height > 0 && (
      <ResponsiveContainer width={size.width} height={size.height} minWidth={0}>
        <BarChart data={data} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
          <XAxis
            dataKey="name"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 10, fontWeight: 600, fill: '#64748b' }}
            dy={10}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 10, fontWeight: 600, fill: '#64748b' }}
            width={64}
            allowDecimals={false}
            tickFormatter={fmt}
            label={{
              value: 'Jumlah interaksi',
              angle: -90,
              position: 'insideLeft',
              offset: 6,
              style: { fontSize: 10, fontWeight: 600, fill: '#64748b', textAnchor: 'middle' },
            }}
          />
          <Tooltip
            cursor={{ fill: 'rgba(226, 232, 240, 0.4)' }}
            contentStyle={{
              borderRadius: 'var(--radius)',
              border: '1px solid hsl(var(--border))',
              boxShadow: 'var(--shadow-lg)',
              backgroundColor: '#ffffff',
              color: '#0f172a',
              fontSize: 12,
            }}
            formatter={(value, name) => [fmt(Number(value)), String(name ?? '')]}
          />
          <Legend
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 11, fontWeight: 600, color: '#64748b', paddingTop: 8 }}
          />
          <Bar dataKey="ig" name="Instagram" stackId="a" fill="#ec4899" barSize={32} />
          <Bar
            dataKey="fb"
            name="Facebook"
            stackId="a"
            fill="#3b82f6"
            barSize={32}
            radius={!hasTiktok ? [4, 4, 0, 0] : undefined}
          />
          {hasTiktok && (
            <Bar dataKey="tiktok" name="TikTok" stackId="a" fill="#0f172a" radius={[4, 4, 0, 0]} barSize={32} />
          )}
        </BarChart>
      </ResponsiveContainer>
      )}
      {!hasData && (
        <div className={cn(
          "absolute inset-0 flex flex-col items-center justify-center gap-1 text-center",
          "bg-white/80 backdrop-blur-[1px] rounded-xl"
        )}>
          <p className="text-sm font-semibold text-slate-500">Belum ada data 7 hari</p>
          <p className="text-[11px] text-slate-400">Isi rekap untuk melihat tren interaksi</p>
        </div>
      )}
    </div>
  );
}
