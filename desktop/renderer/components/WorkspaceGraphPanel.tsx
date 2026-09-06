"use client";

import React, { useState, useRef, useEffect, useMemo } from "react";
import { 
  Network, ZoomIn, ZoomOut, RotateCcw, Filter, FileText, 
  Sparkles, AlertTriangle, ShieldCheck, ArrowRight, Activity, X, Layers, Search
} from "lucide-react";

export interface GraphNode {
  id: string;
  file: string;
  symbol: string;
  line: number;
  kind: "definition" | "ghost_operation" | "use" | "return_sink" | string;
  code?: string;
  label: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
}

export interface WorkspaceGraph {
  workspace: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  error?: string;
}

interface WorkspaceGraphPanelProps {
  graph: WorkspaceGraph | null;
  loading: boolean;
  onRefresh: () => void;
  onNodeClick: (node: GraphNode) => void;
  onClose?: () => void;
  impactRadiusResult?: any;
  blastRadiusResult?: any;
  counterfactualResult?: any;
}

export default function WorkspaceGraphPanel({
  graph,
  loading,
  onRefresh,
  onNodeClick,
  onClose,
  impactRadiusResult,
  blastRadiusResult,
  counterfactualResult,
}: WorkspaceGraphPanelProps) {
  const [selectedFile, setSelectedFile] = useState<string>("ALL");
  const [selectedKind, setSelectedKind] = useState<string>("ALL");
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Pan and Zoom transform state
  const [transform, setTransform] = useState({ x: 60, y: 80, scale: 1.0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement | null>(null);

  const files = useMemo(() => {
    if (!graph || !graph.nodes) return [];
    return Array.from(new Set(graph.nodes.map((n) => n.file)));
  }, [graph]);

  // Filter nodes & edges
  const filteredNodes = useMemo(() => {
    if (!graph || !graph.nodes) return [];
    return graph.nodes.filter((n) => {
      if (selectedFile !== "ALL" && n.file !== selectedFile) return false;
      if (selectedKind !== "ALL" && n.kind !== selectedKind) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesLabel = (n.label || "").toLowerCase().includes(q);
        const matchesCode = (n.code || "").toLowerCase().includes(q);
        const matchesFile = (n.file || "").toLowerCase().includes(q);
        if (!matchesLabel && !matchesCode && !matchesFile) return false;
      }
      return true;
    });
  }, [graph, selectedFile, selectedKind, searchQuery]);

  const filteredNodeIds = useMemo(() => {
    return new Set(filteredNodes.map((n) => n.id));
  }, [filteredNodes]);

  const filteredEdges = useMemo(() => {
    if (!graph || !graph.edges) return [];
    return graph.edges.filter(
      (e) => filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target)
    );
  }, [graph, filteredNodeIds]);

  // Map impact radius classifications to nodes
  const impactNodeMap = useMemo(() => {
    if (!impactRadiusResult || !impactRadiusResult.impacted_nodes) return new Map();
    const map = new Map<string, any>();

    if (impactRadiusResult.root_function && impactRadiusResult.root_function.name) {
      const rootKey = `${impactRadiusResult.root_function.name}`.toLowerCase();
      map.set(rootKey, {
        classification: "ROOT_CHANGE",
        severity: impactRadiusResult.root_function.severity || "HIGH",
        distance: 0,
      });
    }

    for (const node of impactRadiusResult.impacted_nodes) {
      if (node && node.symbol) {
        const symKey = `${node.symbol}`.toLowerCase();
        map.set(symKey, node);
      }
      if (node && node.id) {
        map.set(node.id, node);
      }
    }
    return map;
  }, [impactRadiusResult]);

  // Compute 2D node coordinates grouped by file in vertical lanes
  const nodePositions = useMemo(() => {
    const positions: Record<string, { x: number; y: number; width: number; height: number }> = {};
    const fileGroups: Record<string, GraphNode[]> = {};

    filteredNodes.forEach((node) => {
      if (!fileGroups[node.file]) fileGroups[node.file] = [];
      fileGroups[node.file].push(node);
    });

    const fileList = Object.keys(fileGroups);
    const laneWidth = 320;
    const nodeHeight = 54;
    const verticalGap = 24;

    fileList.forEach((file, fileIdx) => {
      const startX = fileIdx * laneWidth + 40;
      const nodesInFile = fileGroups[file];

      // Sort: definition -> ghost_operation -> use -> return_sink
      const kindOrder: Record<string, number> = {
        definition: 1,
        ghost_operation: 2,
        use: 3,
        return_sink: 4,
      };

      nodesInFile.sort((a, b) => {
        const orderA = kindOrder[a.kind] || 5;
        const orderB = kindOrder[b.kind] || 5;
        if (orderA !== orderB) return orderA - orderB;
        return a.line - b.line;
      });

      nodesInFile.forEach((node, nodeIdx) => {
        const y = nodeIdx * (nodeHeight + verticalGap) + 60;
        positions[node.id] = {
          x: startX,
          y: y,
          width: 240,
          height: nodeHeight,
        };
      });
    });

    return positions;
  }, [filteredNodes]);

  // Mouse pan handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.target !== svgRef.current && (e.target as HTMLElement).tagName !== "svg") return;
    setIsPanning(true);
    setPanStart({ x: e.clientX - transform.x, y: e.clientY - transform.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isPanning) return;
    setTransform((prev) => ({
      ...prev,
      x: e.clientX - panStart.x,
      y: e.clientY - panStart.y,
    }));
  };

  const handleMouseUp = () => setIsPanning(false);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
    setTransform((prev) => ({
      ...prev,
      scale: Math.max(0.3, Math.min(2.5, prev.scale * zoomFactor)),
    }));
  };

  const resetView = () => setTransform({ x: 60, y: 80, scale: 1.0 });

  const getNodeColors = (kind: string) => {
    switch (kind) {
      case "definition":
        return {
          bg: "fill-[#042f2e]",
          border: "stroke-cyan-400",
          text: "text-cyan-300",
          badgeBg: "bg-cyan-950 text-cyan-300 border-cyan-500/40",
          edgeStroke: "#22d3ee",
        };
      case "ghost_operation":
        return {
          bg: "fill-[#451a03]",
          border: "stroke-amber-400",
          text: "text-amber-300",
          badgeBg: "bg-amber-950 text-amber-300 border-amber-500/40",
          edgeStroke: "#f59e0b",
        };
      case "use":
        return {
          bg: "fill-[#2e1065]",
          border: "stroke-purple-400",
          text: "text-purple-300",
          badgeBg: "bg-purple-950 text-purple-300 border-purple-500/40",
          edgeStroke: "#a855f7",
        };
      case "return_sink":
        return {
          bg: "fill-[#064e3b]",
          border: "stroke-emerald-400",
          text: "text-emerald-300",
          badgeBg: "bg-emerald-950 text-emerald-300 border-emerald-500/40",
          edgeStroke: "#10b981",
        };
      case "clone":
        return {
          bg: "fill-[#3b0764]",
          border: "stroke-purple-400",
          text: "text-purple-300",
          badgeBg: "bg-purple-950 text-purple-300 border-purple-500/40",
          edgeStroke: "#a855f7",
        };
      case "semantic_clone":
        return {
          bg: "fill-[#431407]",
          border: "stroke-amber-500",
          text: "text-amber-300",
          badgeBg: "bg-amber-950 text-amber-300 border-amber-500/40",
          edgeStroke: "#f97316",
        };
      default:
        return {
          bg: "fill-[#18181b]",
          border: "stroke-zinc-500",
          text: "text-zinc-300",
          badgeBg: "bg-zinc-900 text-zinc-300 border-zinc-700",
          edgeStroke: "#71717a",
        };
    }
  };

  const cloneCount = useMemo(() => {
    return filteredNodes.filter((n) => n.kind === "clone").length;
  }, [filteredNodes]);

  const semanticCloneCount = useMemo(() => {
    return filteredNodes.filter((n) => n.kind === "semantic_clone").length;
  }, [filteredNodes]);

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0A0B0D] text-[#E6E8EB] font-sans select-none overflow-hidden relative">
      
      {/* 1. Header Toolbar */}
      <div className="p-3 bg-[#0E1013] border-b border-[#22252B] flex items-center justify-between gap-3 shrink-0 z-10">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Network className="w-4 h-4 text-[#4CC2DE]" />
            <h2 className="font-semibold text-sm text-[#E6E8EB]">
              Cross-File Provenance Graph
            </h2>
          </div>

          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-[#14161B] rounded-md border border-[#22252B] text-xs text-[#9AA1AC]">
            <span>{filteredNodes.length} nodes</span>
            <span>•</span>
            <span>{filteredEdges.length} edges</span>
            {cloneCount > 0 && (
              <>
                <span>•</span>
                <span className="text-[#E6E8EB] font-medium">{cloneCount} clones</span>
              </>
            )}
            {semanticCloneCount > 0 && (
              <>
                <span>•</span>
                <span className="text-[#D9A441] font-medium">{semanticCloneCount} semantic clones</span>
              </>
            )}
          </div>
        </div>

        {/* Filters and Search Controls */}
        <div className="flex items-center gap-2">
          
          {/* Search Box */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#14161B] border border-[#22252B] text-xs">
            <Search className="w-3.5 h-3.5 text-[#6B7280]" />
            <input
              type="text"
              placeholder="Search symbol / code..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-transparent border-none outline-none text-[#E6E8EB] text-xs w-36 placeholder:text-[#6B7280]"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery("")} className="text-[#9AA1AC] hover:text-[#E6E8EB]">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* File Filter Dropdown */}
          <select
            value={selectedFile}
            onChange={(e) => setSelectedFile(e.target.value)}
            className="px-2.5 py-1 rounded-md bg-[#14161B] border border-[#22252B] text-xs text-[#E6E8EB] outline-none hover:border-[#2E323B] transition-colors"
          >
            <option value="ALL">All Files ({files.length})</option>
            {files.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>

          {/* Kind Filter Buttons */}
          <div className="flex items-center gap-0.5 p-0.5 bg-[#14161B] rounded-md border border-[#22252B] text-[11px]">
            {[
              { id: "ALL", label: "All" },
              { id: "definition", label: "Defs", color: "text-[#4CC2DE]" },
              { id: "ghost_operation", label: "Ghosts", color: "text-[#D9A441]" },
              { id: "use", label: "Uses", color: "text-[#E6E8EB]" },
              { id: "return_sink", label: "Sinks", color: "text-[#3EAE79]" },
              { id: "clone", label: "Clones", color: "text-[#9AA1AC]" },
              { id: "semantic_clone", label: "Semantic", color: "text-[#D9A441]" },
            ].map((k) => (
              <button
                key={k.id}
                onClick={() => setSelectedKind(k.id)}
                className={`px-2 py-0.5 rounded transition-colors ${
                  selectedKind === k.id
                    ? "bg-[#1A1C22] text-[#E6E8EB] font-medium"
                    : "text-[#9AA1AC] hover:text-[#E6E8EB]"
                } ${k.color || ""}`}
              >
                {k.label}
              </button>
            ))}
          </div>

          {/* Zoom & Rescan Tools */}
          <div className="flex items-center gap-1 border-l border-[#22252B] pl-2">
            <button
              onClick={() => setTransform((p) => ({ ...p, scale: Math.min(2.5, p.scale * 1.15) }))}
              className="p-1.5 rounded-md bg-[#14161B] hover:bg-[#1A1C22] border border-[#22252B] text-[#9AA1AC] hover:text-[#E6E8EB] transition-colors"
              title="Zoom In"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setTransform((p) => ({ ...p, scale: Math.max(0.3, p.scale * 0.85) }))}
              className="p-1.5 rounded-md bg-[#14161B] hover:bg-[#1A1C22] border border-[#22252B] text-[#9AA1AC] hover:text-[#E6E8EB] transition-colors"
              title="Zoom Out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={resetView}
              className="p-1.5 rounded-md bg-[#14161B] hover:bg-[#1A1C22] border border-[#22252B] text-[#9AA1AC] hover:text-[#E6E8EB] transition-colors"
              title="Reset View"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onRefresh}
              disabled={loading}
              className="px-3 py-1 rounded-md bg-[#14161B] hover:bg-[#1A1C22] border border-[#22252B] text-[#E6E8EB] text-xs font-medium flex items-center gap-1.5 transition-colors"
            >
              {loading ? (
                <Activity className="w-3.5 h-3.5 animate-spin text-[#4CC2DE]" />
              ) : (
                <Network className="w-3.5 h-3.5 text-[#9AA1AC]" />
              )}
              <span>Re-graph</span>
            </button>

            {onClose && (
              <button
                onClick={onClose}
                className="p-1.5 rounded-md border border-[#22252B] text-[#9AA1AC] hover:text-[#E6E8EB] hover:bg-[#14161B] transition-colors"
                title="Close Graph"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

        </div>
      </div>

      {/* 2. Interactive SVG Canvas */}
      <div 
        className="flex-1 w-full h-full relative overflow-hidden bg-[#050505] cursor-grab active:cursor-grabbing"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
      >
        <svg
          ref={svgRef}
          className="w-full h-full"
        >
          <defs>
            <marker
              id="arrow-cyan"
              viewBox="0 0 10 10"
              refX="10"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#22d3ee" />
            </marker>
            <marker
              id="arrow-amber"
              viewBox="0 0 10 10"
              refX="10"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#fbbf24" />
            </marker>
            <marker
              id="arrow-purple"
              viewBox="0 0 10 10"
              refX="10"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#a78bfa" />
            </marker>
            <marker
              id="arrow-emerald"
              viewBox="0 0 10 10"
              refX="10"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#34d399" />
            </marker>
            <marker
              id="arrow-magenta"
              viewBox="0 0 10 10"
              refX="10"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#ec4899" />
            </marker>
            <marker
              id="arrow-default"
              viewBox="0 0 10 10"
              refX="10"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#52525b" />
            </marker>

            {/* Background grid pattern */}
            <pattern id="graph-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#141414" strokeWidth="1" />
            </pattern>
          </defs>

          {/* Grid Background */}
          <rect width="100%" height="100%" fill="url(#graph-grid)" />

          {/* Transform Container */}
          <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`}>
            
            {/* Edges */}
            {filteredEdges.map((edge, idx) => {
              const srcPos = nodePositions[edge.source];
              const tgtPos = nodePositions[edge.target];
              if (!srcPos || !tgtPos) return null;

              const isCloneEdge = edge.type === "clone" || edge.type === "structural-clone";
              const isSemanticClone = edge.type === "semantic_clone";
              const isGhostEdge = edge.type === "ghost_flow";
              const isCrossFile = edge.type === "cross_file_import";

              const x1 = srcPos.x + srcPos.width;
              const y1 = srcPos.y + srcPos.height / 2;
              const x2 = tgtPos.x;
              const y2 = tgtPos.y + tgtPos.height / 2;

              const dx = Math.abs(x2 - x1) * 0.5;
              const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;

              const markerColor = isSemanticClone
                ? "url(#arrow-amber)"
                : isCloneEdge
                ? "url(#arrow-purple)"
                : isGhostEdge
                ? "url(#arrow-amber)"
                : isCrossFile
                ? "url(#arrow-purple)"
                : "url(#arrow-cyan)";

              const strokeColor = isSemanticClone
                ? "#f97316"
                : isCloneEdge
                ? "#a855f7"
                : isGhostEdge
                ? "#f59e0b"
                : isCrossFile
                ? "#8b5cf6"
                : "#0891b2";

              return (
                <g key={`edge-${idx}`}>
                  <path
                    d={d}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={isSemanticClone || isCloneEdge ? "2.2" : isGhostEdge ? "2.5" : "1.8"}
                    strokeDasharray={isSemanticClone ? "2,4" : isCloneEdge ? "4,4" : isCrossFile ? "5,5" : undefined}
                    strokeOpacity={isSemanticClone ? 0.95 : isCloneEdge ? 0.85 : 0.65}
                    markerEnd={markerColor}
                    className="hover:stroke-white transition-colors"
                  />
                </g>
              );
            })}

            {/* Nodes */}
            {filteredNodes.map((node) => {
              const pos = nodePositions[node.id];
              if (!pos) return null;

              const colors = getNodeColors(node.kind);
              const isSelected = selectedNodeId === node.id;
              const isHovered = hoveredNode?.id === node.id;

              const impactData = impactNodeMap.get(node.id) || (node.symbol ? impactNodeMap.get(node.symbol.toLowerCase()) : null);
              const isImpactRoot = impactData?.classification === "ROOT_CHANGE";
              const isImpactObserved = impactData?.classification === "OBSERVED_CHANGE";
              const isImpactStatic = impactData?.classification === "STATIC_IMPACT";

              const isCfActive = counterfactualResult && !counterfactualResult.error;
              const isCfSafe = isCfActive && counterfactualResult.safe_to_remove;
              const isCfUnsafe = isCfActive && !counterfactualResult.safe_to_remove;

              const strokeColor = isCfSafe
                ? "#10b981"
                : isCfUnsafe
                ? "#f43f5e"
                : isImpactRoot
                ? "#f43f5e"
                : isImpactObserved
                ? "#f59e0b"
                : isImpactStatic
                ? "#06b6d4"
                : undefined;

              return (
                <g
                  key={node.id}
                  transform={`translate(${pos.x}, ${pos.y})`}
                  onClick={() => {
                    setSelectedNodeId(node.id);
                    onNodeClick(node);
                  }}
                  onMouseEnter={() => setHoveredNode(node)}
                  onMouseLeave={() => setHoveredNode(null)}
                  className="cursor-pointer group"
                >
                  {/* Node Background Rectangle */}
                  <rect
                    width={pos.width}
                    height={pos.height}
                    rx="10"
                    className={`${colors.bg} ${colors.border} transition-all`}
                    stroke={strokeColor}
                    strokeWidth={strokeColor || isSelected || isHovered ? "2.5" : "1"}
                    strokeOpacity={strokeColor || isSelected ? 1.0 : 0.6}
                    fillOpacity={0.85}
                  />

                  {/* Header: Kind Badge & Line */}
                  <g transform="translate(10, 16)">
                    <text
                      className={`text-[9px] font-bold uppercase ${colors.text}`}
                      fill="currentColor"
                    >
                      {node.kind.replace("_", " ")}
                    </text>
                    <text
                      x={pos.width - 24}
                      className="text-[9px] text-zinc-400 font-bold"
                      fill="#a1a1aa"
                      textAnchor="end"
                    >
                      L{node.line}
                    </text>
                  </g>

                  {/* Impact Overlay Badge */}
                  {impactData && (
                    <g transform={`translate(${pos.width - 100}, 30)`}>
                      <text
                        className="text-[8px] font-black uppercase tracking-tight"
                        fill={isImpactRoot ? "#f43f5e" : isImpactObserved ? "#f59e0b" : "#06b6d4"}
                      >
                        {isImpactRoot ? "ROOT CHANGE" : isImpactObserved ? `OBSERVED (d=${impactData.distance})` : `STATIC (d=${impactData.distance})`}
                      </text>
                    </g>
                  )}

                  {/* Label / Symbol */}
                  <g transform="translate(10, 36)">
                    <text
                      className="text-[11px] font-bold text-white group-hover:text-cyan-300"
                      fill="#ffffff"
                    >
                      {node.label.length > 28 ? node.label.substring(0, 25) + "..." : node.label}
                    </text>
                  </g>

                  {/* Node file tag */}
                  <g transform="translate(10, 48)">
                    <text
                      className="text-[8px] text-zinc-500 truncate"
                      fill="#71717a"
                    >
                      {node.file.split("/").pop()}
                    </text>
                  </g>
                </g>
              );
            })}

          </g>
        </svg>

        {/* 3. Floating Hover Tooltip */}
        {hoveredNode && (
          <div className="absolute bottom-4 left-4 p-3 bg-[#111318] border border-[#22252B] rounded-lg shadow-popover z-20 max-w-md pointer-events-none font-sans space-y-2">
            <div className="flex items-center justify-between gap-2 border-b border-[#22252B] pb-2">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#4CC2DE]" />
                <span className="font-medium text-xs text-[#E6E8EB] font-mono">{hoveredNode.symbol}</span>
              </div>
              <span className={`px-2 py-0.5 rounded text-[10px] font-medium uppercase ${getNodeColors(hoveredNode.kind).badgeBg}`}>
                {hoveredNode.kind.replace("_", " ")}
              </span>
            </div>

            <div className="text-[11px] text-[#9AA1AC] flex items-center justify-between font-mono">
              <span>{hoveredNode.file}:{hoveredNode.line}</span>
              <span className="text-[10px] text-[#4CC2DE] font-sans">Click node to inspect line</span>
            </div>

            {hoveredNode.code && (
              <div className="p-2 bg-[#0B0C0F] rounded border border-[#22252B] text-[11px] text-[#E6E8EB] font-mono overflow-x-auto">
                <code>{hoveredNode.code}</code>
              </div>
            )}
          </div>
        )}

      </div>

    </div>
  );
}
