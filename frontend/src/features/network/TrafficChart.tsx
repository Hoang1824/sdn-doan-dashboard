import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { TrafficPoint } from '../../types/dashboard'

const timeLabel = (value: string) => Number.isFinite(Date.parse(value))
  ? new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(value)) : '—'

export default function TrafficChart({ points }: { points: readonly TrafficPoint[] }) {
  return <ResponsiveContainer width="100%" height="100%" minWidth={0}>
    <AreaChart data={[...points]} margin={{ top: 15, right: 8, bottom: 0, left: -20 }}>
      <defs><linearGradient id="ingress-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#43d5c7" stopOpacity={0.22} /><stop offset="100%" stopColor="#43d5c7" stopOpacity={0} /></linearGradient></defs>
      <CartesianGrid stroke="#233043" strokeDasharray="3 6" vertical={false} />
      <XAxis dataKey="timestamp" tickFormatter={timeLabel} tick={{ fill: '#8b9ab0', fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={40} />
      <YAxis tick={{ fill: '#8b9ab0', fontSize: 11 }} axisLine={false} tickLine={false} />
      <Tooltip labelFormatter={value => timeLabel(String(value))} contentStyle={{ background: '#141e2d', border: '1px solid #344359', borderRadius: 8, color: '#e8eef7' }} />
      <Area type="linear" dataKey="ingressMbps" name="Inbound (Mbps)" stroke="#43d5c7" strokeWidth={2} fill="url(#ingress-fill)" isAnimationActive={false} connectNulls={false} />
      <Area type="linear" dataKey="egressMbps" name="Outbound (Mbps)" stroke="#648dff" strokeWidth={2} fill="transparent" isAnimationActive={false} connectNulls={false} />
    </AreaChart>
  </ResponsiveContainer>
}
