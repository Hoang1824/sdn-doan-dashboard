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
  /** Populated by a future adapter; omitted means no snapshot has been received. */
  nodes?: Node[]
  edges?: Edge[]
}

const emptyNodes: Node[] = []
const emptyEdges: Edge[] = []

export function TopologyPanel({ nodes, edges }: TopologyPanelProps) {
  const [expanded, setExpanded] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const headingId = useId()
  const canvasId = useId()
  const topologyNodes = nodes ?? emptyNodes
  const selectedNode = topologyNodes.find((node) => node.id === selectedNodeId)
  const hasKnownKinds = nodes !== undefined && nodes.every((node) =>
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
          <p className="panel-subtitle">Cấu trúc và kết nối trong mạng SDN</p>
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
        <span><Link2 size={13} aria-hidden="true" /> Links <strong>{edges === undefined ? '—' : edges.length}</strong></span>
      </div>

      <div id={canvasId} className="topology-canvas">
        <ReactFlow
          nodes={topologyNodes}
          edges={edges ?? emptyEdges}
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
            <p>Sơ đồ sẽ hiển thị khi nhận được thông tin từ Ryu.</p>
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
        <span><span className="topology-source-dot" />Nguồn: Ryu Controller</span>
        <span>Kéo để di chuyển · Cuộn để thu phóng</span>
      </div>
    </section>
  )
}
