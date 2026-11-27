import { useId, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react'
import { Link2, Maximize2, Minimize2, Monitor, Network, Router, X } from 'lucide-react'
import '@xyflow/react/dist/style.css'
import './topology.css'

interface TopologyPanelProps {
  /** Omitted inputs display the documented static B8 reference topology. */
  nodes?: Node[]
  edges?: Edge[]
}

const emptyNodes: Node[] = []
const emptyEdges: Edge[] = []

const b8ReferenceNodes: Node[] = [
  { id: 'h1', position: { x: 0, y: 0 }, data: { kind: 'host', label: 'h1 · 10.0.0.1' } },
  { id: 'h2', position: { x: 0, y: 70 }, data: { kind: 'host', label: 'h2 · 10.0.0.2' } },
  { id: 'h3', position: { x: 0, y: 140 }, data: { kind: 'host', label: 'h3 · 10.0.0.3' } },
  { id: 'h4', position: { x: 0, y: 210 }, data: { kind: 'host', label: 'h4 · 10.0.0.4' } },
  { id: 's1', position: { x: 190, y: 105 }, data: { kind: 'switch', label: 's1' } },
  { id: 'a1', position: { x: 390, y: 35 }, data: { kind: 'host', label: 'a1 · 10.0.0.10' } },
  { id: 'a2', position: { x: 390, y: 105 }, data: { kind: 'host', label: 'a2 · 10.0.0.11' } },
  { id: 'a3', position: { x: 390, y: 175 }, data: { kind: 'host', label: 'a3 · 10.0.0.12' } },
  { id: 's2', position: { x: 580, y: 105 }, data: { kind: 'switch', label: 's2' } },
  { id: 'hsrv', position: { x: 780, y: 105 }, data: { kind: 'host', label: 'hsrv · 10.0.0.100' } },
  { id: 'score', position: { x: 980, y: 105 }, data: { kind: 'switch', label: 'score · DPID 3' } },
]

const b8ReferenceEdges: Edge[] = [
  { id: 'h1-s1', source: 'h1', target: 's1' },
  { id: 'h2-s1', source: 'h2', target: 's1' },
  { id: 'h3-s1', source: 'h3', target: 's1' },
  { id: 'h4-s1', source: 'h4', target: 's1' },
  { id: 'a1-s2', source: 'a1', target: 's2' },
  { id: 'a2-s2', source: 'a2', target: 's2' },
  { id: 'a3-s2', source: 'a3', target: 's2' },
  { id: 'hsrv-score', source: 'hsrv', target: 'score' },
]

export function TopologyPanel({ nodes, edges }: TopologyPanelProps) {
  const [expanded, setExpanded] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const headingId = useId()
  const canvasId = useId()
  const referenceMode = nodes === undefined && edges === undefined
  const topologyNodes = nodes ?? (referenceMode ? b8ReferenceNodes : emptyNodes)
  const topologyEdges = edges ?? (referenceMode ? b8ReferenceEdges : emptyEdges)
  const selectedNode = topologyNodes.find((node) => node.id === selectedNodeId)
  const hasKnownKinds = topologyNodes.every((node) =>
    node.data.kind === 'host' || node.data.kind === 'switch',
  )
  const hosts = hasKnownKinds ? topologyNodes.filter((node) => node.data.kind === 'host').length : '—'
  const switches = hasKnownKinds ? topologyNodes.filter((node) => node.data.kind === 'switch').length : '—'

  return (
    <section
      id="topology"
      className={`panel topology-panel${expanded ? ' topology-panel-expanded' : ''}`}
      aria-labelledby={headingId}
    >
      <div className="panel-header">
        <div>
          <p className="topology-kicker">HẠ TẦNG MẠNG</p>
          <h2 id={headingId}>SDN Topology</h2>
          <p className="panel-subtitle">{referenceMode ? 'Topology tham chiếu tĩnh B8 · không phải discovery live Ryu' : 'Cấu trúc và kết nối trong mạng SDN'}</p>
        </div>
        <button
          type="button"
          className="topology-expand"
          aria-label={expanded ? 'Thu gọn sơ đồ' : 'Mở rộng sơ đồ'}
          title={expanded ? 'Thu gọn sơ đồ' : 'Mở rộng sơ đồ'}
          aria-expanded={expanded}
          aria-controls={canvasId}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
        </button>
      </div>

      <div className="topology-legend" aria-label="Thống kê thiết bị mạng">
        <span><Monitor size={13} aria-hidden="true" /> Hosts <strong>{hosts}</strong></span>
        <span><Router size={13} aria-hidden="true" /> Switches <strong>{switches}</strong></span>
        <span><Link2 size={13} aria-hidden="true" /> Links <strong>{topologyEdges.length}</strong></span>
      </div>

      <div id={canvasId} className="topology-canvas">
        <ReactFlow
          nodes={topologyNodes}
          edges={topologyEdges}
          colorMode="dark"
          nodesDraggable={false}
          nodesConnectable={false}
          edgesReconnectable={false}
          deleteKeyCode={null}
          minZoom={0.25}
          maxZoom={2}
          fitView
          onNodeClick={(_, node) => setSelectedNodeId(node.id)}
          onSelectionChange={({ nodes: selection }) => setSelectedNodeId(selection[0]?.id ?? null)}
          onPaneClick={() => setSelectedNodeId(null)}
          aria-label="Sơ đồ topology mạng SDN"
          ariaLabelConfig={{
            'controls.ariaLabel': 'Điều khiển sơ đồ',
            'controls.zoomIn.ariaLabel': 'Phóng to',
            'controls.zoomOut.ariaLabel': 'Thu nhỏ',
            'controls.fitView.ariaLabel': 'Vừa khung nhìn',
            'node.a11yDescription.default': 'Nhấn Enter hoặc dấu cách để chọn thiết bị.',
            'node.a11yDescription.keyboardDisabled': 'Nhấn Enter hoặc dấu cách để chọn thiết bị.',
            'edge.a11yDescription.default': 'Kết nối giữa các thiết bị trong mạng.',
          }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#2b3a4b" />
          <Controls showInteractive={false} position="bottom-left" />
        </ReactFlow>

        {topologyNodes.length === 0 && (
          <div className="topology-empty">
            <div className="topology-empty-icon"><Network size={27} strokeWidth={1.4} aria-hidden="true" /></div>
            <h3>{nodes === undefined ? 'Chưa có dữ liệu topology' : 'Chưa có thiết bị trong topology'}</h3>
            <p>Sơ đồ sẽ hiển thị khi nhận được thông tin từ nguồn topology đã cấu hình.</p>
          </div>
        )}

        {selectedNode && (
          <aside className="topology-detail" aria-label="Chi tiết thiết bị">
            <div className="topology-detail-header">
              <strong>Chi tiết thiết bị</strong>
              <button type="button" aria-label="Đóng chi tiết thiết bị" onClick={() => setSelectedNodeId(null)}>
                <X size={14} aria-hidden="true" />
              </button>
            </div>
            <dl>
              <div><dt>ID</dt><dd>{selectedNode.id}</dd></div>
              <div><dt>Loại</dt><dd>{typeof selectedNode.data.kind === 'string' ? selectedNode.data.kind : 'Chưa xác định'}</dd></div>
            </dl>
          </aside>
        )}
      </div>

      <div className="topology-footer">
        <span><span className="topology-source-dot" />{referenceMode ? 'Tham chiếu tĩnh theo handoff B8 · không phải topology live Ryu' : 'Topology từ nguồn dữ liệu được truyền vào'}</span>
        <span>Kéo để di chuyển · Cuộn để thu phóng</span>
      </div>
    </section>
  )
}
