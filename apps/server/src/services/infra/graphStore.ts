/**
 * 图谱访问隔离接口。一期仅定义契约 + 占位实现。
 * 三期实现 AgeGraphStore（Apache AGE）；若部署环境 PG 不支持 AGE，
 * 退回「边表 + 递归 CTE」或独立 Neo4j，调用方不变。
 */
export interface GraphNode {
  id: string
  label: string
  props: Record<string, unknown>
}

export interface GraphEdge {
  from: string
  to: string
  type: string
  props: Record<string, unknown>
}

export interface GraphStore {
  upsertNode(node: GraphNode): Promise<void>
  upsertEdge(edge: GraphEdge): Promise<void>
  /** 从种子节点多跳遍历。 */
  traverse(seedId: string, maxHops: number): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }>
}

/** 一期占位实现。 */
export function createNullGraphStore(): GraphStore {
  const notReady = (): never => {
    throw new Error('GraphStore 未实现（三期接入 AGE）')
  }
  return {
    async upsertNode() {
      notReady()
    },
    async upsertEdge() {
      notReady()
    },
    async traverse() {
      return notReady()
    },
  }
}
