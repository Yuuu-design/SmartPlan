// 全局排产状态中心 (Zustand)：把甘特图时间轴缩放、选中、锁单、拖拽位移统一收拢，
// 禁止在组件层多头维护 State。

import { create } from 'zustand';
import type {
  CleaningReportDTO,
  GanttTask,
  KPIStats,
  Machine,
  OrderSummary,
  PrecedenceLink,
  ProcessType,
  ScheduleAPIResponse,
  SimulationResponse,
  ViewMode,
} from '../types/schedule';
import { PROCESS_ORDER } from '../types/schedule';

export interface BaselinePosition {
  start_time: number;
  machine_id: string;
}

interface ScheduleState {
  tasks: Record<string, GanttTask>;
  machines: Machine[];
  links: PrecedenceLink[];
  kpis: KPIStats | null;
  orderSummary: OrderSummary | null;
  decisionReasons: Record<string, string[]>;
  selectedTaskId: string | null;
  focusTaskId: string | null;
  viewMode: ViewMode;
  zoomLevel: number; // 像素/分钟
  isDragging: boolean;
  showOnlyRisk: boolean;
  showDependencyLines: boolean; // 工序依赖连线（拉丝→捻股→合绳）全局显示开关
  highlightedOrderId: string | null; // 单号追踪/双击临时高亮的订单：只画该单的两条依赖线
  // 双击单号进入的聚焦视图：只渲染该单工序链（3 工序 + 所需设备 + 两条箭头），
  // 自适应缩放聚拢到可视区；退出时恢复原缩放/滚动/布局
  focusedOrderId: string | null;
  // Excel/CSV 导入：本次上传涉及的订单与数据清洗摘要
  importedOrderIds: string[];
  cleaningReport: CleaningReportDTO | null;
  // Phase 3 沙盘推演
  simulation: SimulationResponse | null;
  activeScenarioIndex: number | null; // null = 基线
  baselinePositions: Record<string, BaselinePosition>;
  // 已人工处置的风险订单：运用改进方案后该单即使仍轻微延期，也从风险队列移除、恢复正常颜色；
  // 回退基线（撤销方案）时清空，风险重新出现
  resolvedRiskOrderIds: string[];

  setScheduleData: (response: ScheduleAPIResponse) => void;
  toggleTaskLock: (taskId: string) => void;
  updateTaskTime: (taskId: string, newStartTime: number, newMachineId?: string) => void;
  setZoomLevel: (zoom: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  setSelectedTask: (taskId: string | null) => void;
  setFocusTask: (taskId: string | null) => void;
  setViewMode: (mode: ViewMode) => void;
  setDragging: (dragging: boolean) => void;
  toggleRiskFilter: () => void;
  toggleDependencyLines: () => void;
  setHighlightedOrder: (orderId: string | null) => void;
  setFocusedOrder: (orderId: string | null) => void;
  // 单号追踪入口：高亮该单依赖链，并退出风险过滤保证三块均在画布内
  traceOrder: (orderId: string) => void;
  setSimulation: (sim: SimulationResponse) => void;
  applyScenario: (index: number | null) => void;
  clearSimulation: () => void;
  // 标记订单风险已处置（运用改进方案后调用）
  resolveRiskOrder: (orderId: string) => void;
}

function mapProcessType(p: 'Drawing' | 'Stranding' | 'Roping'): ProcessType {
  return p.toUpperCase() as ProcessType;
}

const INITIAL_ZOOM = 0.5;

export const useScheduleStore = create<ScheduleState>((set, get) => ({
  tasks: {},
  machines: [],
  links: [],
  kpis: null,
  orderSummary: null,
  decisionReasons: {},
  selectedTaskId: null,
  focusTaskId: null,
  viewMode: 'ORDER',
  zoomLevel: INITIAL_ZOOM,
  isDragging: false,
  showOnlyRisk: false,
  // 默认隐藏全量依赖曲线，仅在主动开启或单号追踪/双击时按需显示
  showDependencyLines: false,
  highlightedOrderId: null,
  focusedOrderId: null,
  importedOrderIds: [],
  cleaningReport: null,
  simulation: null,
  activeScenarioIndex: null,
  baselinePositions: {},
  resolvedRiskOrderIds: [],

  setScheduleData: (response) => {
    const tasks: Record<string, GanttTask> = {};
    const machineSet = new Map<string, Machine>();
    const importedSet = new Set(response.imported_order_ids ?? []);

    for (const dto of response.scheduled_tasks) {
      const pt = mapProcessType(dto.process_type);
      tasks[dto.task_id] = {
        task_id: dto.task_id,
        order_id: dto.order_id,
        process_type: pt,
        machine_id: dto.machine_id,
        machine_name: dto.machine_name ?? dto.machine_id,
        spec: dto.spec ?? '',
        qty_meters: dto.qty_meters ?? 0,
        start_time: dto.start_time,
        end_time: dto.end_time,
        duration_minutes: dto.duration_minutes,
        setup_duration_min: dto.setup_time,
        is_locked: dto.is_locked ?? false,
        status: dto.status ?? 'ON_TIME',
        imported: importedSet.has(dto.order_id) || undefined,
      };
      if (!machineSet.has(dto.machine_id)) {
        machineSet.set(dto.machine_id, {
          machine_id: dto.machine_id,
          machine_name: dto.machine_name ?? dto.machine_id,
          process_type: pt,
          rate_per_min: 0,
        });
      }
    }

    // 推导工序依赖：同一订单 DRAWING -> STRANDING -> ROPING
    const byOrder = new Map<string, GanttTask[]>();
    for (const t of Object.values(tasks)) {
      if (!byOrder.has(t.order_id)) byOrder.set(t.order_id, []);
      byOrder.get(t.order_id)!.push(t);
    }
    const links: PrecedenceLink[] = [];
    for (const ts of byOrder.values()) {
      ts.sort((a, b) => PROCESS_ORDER.indexOf(a.process_type) - PROCESS_ORDER.indexOf(b.process_type));
      for (let i = 0; i < ts.length - 1; i++) {
        links.push({ from_task_id: ts[i].task_id, to_task_id: ts[i + 1].task_id });
      }
    }

    const totalSetupMinutes = Object.values(tasks).reduce((s, t) => s + t.setup_duration_min, 0);
    const kpis: KPIStats = {
      otd_rate: response.kpis.otd,
      utilization_rate: response.kpis.utilization,
      utilization_by_process: response.kpis.utilization_by_process ?? {},
      total_setup_hours: totalSetupMinutes / 60,
      total_setup_count: response.kpis.total_setup_count,
      delayed_order_count: response.kpis.tardy_orders,
      makespan_minutes: response.kpis.makespan,
    };

    // 后端可解释性输出：task_id -> [R1 规格匹配…, R3 换型…, R6 衔接…]
    const decisionReasons: Record<string, string[]> = {};
    for (const d of response.decision_reasons ?? []) {
      decisionReasons[d.task_id] = d.reasons;
    }

    set({
      tasks,
      machines: Array.from(machineSet.values()),
      links,
      kpis,
      orderSummary: response.order_summary ?? null,
      decisionReasons,
      highlightedOrderId: null,
      focusedOrderId: null,
      importedOrderIds: response.imported_order_ids ?? [],
      cleaningReport: response.cleaning_report ?? null,
    });
  },

  toggleTaskLock: (taskId) => {
    set((state) => {
      const task = state.tasks[taskId];
      if (!task) return {};
      return {
        tasks: { ...state.tasks, [taskId]: { ...task, is_locked: !task.is_locked } },
      };
    });
  },

  updateTaskTime: (taskId, newStartTime, newMachineId) => {
    set((state) => {
      const task = state.tasks[taskId];
      if (!task || task.is_locked) return {};
      const updated: GanttTask = {
        ...task,
        start_time: newStartTime,
        end_time: newStartTime + task.duration_minutes,
        machine_id: newMachineId ?? task.machine_id,
      };
      return {
        tasks: { ...state.tasks, [taskId]: updated },
      };
    });
  },

  setZoomLevel: (zoom) => set({ zoomLevel: Math.max(0.05, Math.min(5, zoom)) }),
  zoomIn: () => set((s) => ({ zoomLevel: Math.min(5, s.zoomLevel * 1.5) })),
  zoomOut: () => set((s) => ({ zoomLevel: Math.max(0.05, s.zoomLevel / 1.5) })),
  setSelectedTask: (taskId) => set({ selectedTaskId: taskId }),
  setFocusTask: (taskId) => set({ focusTaskId: taskId }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setDragging: (dragging) => set({ isDragging: dragging }),
  toggleRiskFilter: () => set((s) => ({ showOnlyRisk: !s.showOnlyRisk })),
  toggleDependencyLines: () => set((s) => ({ showDependencyLines: !s.showDependencyLines })),
  setHighlightedOrder: (orderId) => set({ highlightedOrderId: orderId }),
  setFocusedOrder: (orderId) => set({ focusedOrderId: orderId }),
  traceOrder: (orderId) => set({ highlightedOrderId: orderId, showOnlyRisk: false }),

  setSimulation: (sim) => {
    const baselinePositions: Record<string, BaselinePosition> = {};
    for (const t of sim.baseline.scheduled_tasks) {
      baselinePositions[t.task_id] = { start_time: t.start_time, machine_id: t.machine_id };
    }
    set({ simulation: sim, activeScenarioIndex: null, baselinePositions });
  },

  applyScenario: (index) => {
    const sim = get().simulation;
    if (!sim) return;
    if (index === null) {
      get().setScheduleData(sim.baseline);
      // 撤销方案回到基线：改进已不存在，处置标记作废，风险重新出现
      set({ activeScenarioIndex: null, resolvedRiskOrderIds: [] });
    } else if (sim.scenarios[index]) {
      get().setScheduleData(sim.scenarios[index].result);
      set({ activeScenarioIndex: index });
    }
  },

  clearSimulation: () => {
    // 重新导入/全新加载与关闭推演：处置态随推演上下文一起作废
    set({ simulation: null, activeScenarioIndex: null, baselinePositions: {}, resolvedRiskOrderIds: [] });
  },

  resolveRiskOrder: (orderId) => {
    set((state) =>
      state.resolvedRiskOrderIds.includes(orderId)
        ? {}
        : { resolvedRiskOrderIds: [...state.resolvedRiskOrderIds, orderId] },
    );
  },
}));
