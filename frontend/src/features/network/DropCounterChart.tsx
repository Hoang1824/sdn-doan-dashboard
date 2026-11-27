import { useMemo } from 'react'
import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { DropCounterPoint } from '../../types/dashboard'

const colors = ['#43d5c7', '#648dff', '#f4b65b', '#c084fc', '#fb7185', '#34d399']

function timeLabel(value: number) {
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date(value))
}

export default function DropCounterChart({ points }: { points: readonly DropCounterPoint[] }) {
  const series = useMemo(() => {
    const groups = new Map<string, Array<DropCounterPoint & { time: number }>>()
    for (const point of points) {
      const key = `${point.dpid}:${point.cookie}`
      const time = Date.parse(point.timestamp)
      if (!Number.isFinite(time)) continue
      const group = groups.get(key) ?? []
      group.push({ ...point, time })
      groups.set(key, group)
    }
    return [...groups.entries()].map(([key, data]) => ({ key, data }))
  }, [points])

  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <ScatterChart margin={{ top: 12, right: 12, bottom: 4, left: 4 }}>
        <CartesianGrid stroke="#233043" strokeDasharray="3 6" />
        <XAxis
          dataKey="time"
          type="number"
          domain={['dataMin', 'dataMax']}
          tickFormatter={timeLabel}
          tick={{ fill: '#8b9ab0', fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          minTickGap={35}
        />
        <YAxis
          dataKey="packetCount"
          type="number"
          tickFormatter={(value: number) => value.toLocaleString('en-US')}
          tick={{ fill: '#8b9ab0', fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          width={58}
        />
        <Tooltip
          labelFormatter={(value) => timeLabel(Number(value))}
          formatter={(value, name) => [`${String(value)} packets`, String(name)]}
          contentStyle={{ background: '#141e2d', border: '1px solid #344359', borderRadius: 8, color: '#e8eef7' }}
        />
        {series.map((item, index) => (
          <Scatter
            key={item.key}
            name={item.key}
            data={item.data}
            fill={colors[index % colors.length]}
            line={{ stroke: colors[index % colors.length], strokeWidth: 1.5 }}
            lineType="joint"
          />
        ))}
      </ScatterChart>
    </ResponsiveContainer>
  )
}
