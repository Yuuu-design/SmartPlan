// 排产数据类型定义：与后端 Pydantic 模型(ScheduleResultResponse)对齐。
// 时间单位统一为「分钟」(相对排产起点)，与后端 start_time/end_time(int 分钟)一致，
// 由 TimeAxis / ganttHelpers 负责格式化为 HH:mm 或 MM-DD HH:mm。

export type ProcessType = 'DRAWING' | 'STRANDING' | 'ROPING';
export type TaskStatus = 'ON_TIME' | 'DELAYED' | 'CONFLICT';
export type ViewMode = 'MACHINE' | 'ORDER' | 'WORKSHOP';

export const PROCESS_ORDER: ProcessType[] = ['DRAWING', 'STRANDING', 'ROPING'];

export interface GanttTask {
  task_id: string;
  order_id: string;
  process_type: ProcessType;
  machine_id: string;
  machine_name: string;
  spec: string;
  qty_meters: number;
  start_time: number; // 分钟
  end_time: number; // 分钟
  duration_minutes: number;
  setup_duration_min: number;
  is_locked: boolean;
  status: TaskStatus;
  imported?: boolean; // Excel/CSV 导入（或更新）的订单任务，用于视觉标记
}

export interface Machine {
  machine_id: string;
  machine_name: string;
  process_type: ProcessType;
  rate_per_min: number;
}

export interface PrecedenceLink {
  from_task_id: string;
  to_task_id: string;
}

export interface KPIStats {
  otd_rate: number; // 0~1
  utilization_rate: number; // 0~1 活跃设备平均利用率
  utilization_by_process: Record<string, number>;
  total_setup_hours: number;
  total_setup_count: number;
  delayed_order_count: number;
  makespan_minutes: number;
}

// ---- 后端 ScheduleResultResponse 的 DTO 映射（API 层输入）----

export interface ScheduledTaskDTO {
  task_id: string;
  order_id: string;
  process_type: 'Drawing' | 'Stranding' | 'Roping'; // 后端 ProcessType 枚举值(首字母大写)
  machine_id: string;
  start_time: number;
  end_time: number;
  duration_minutes: number;
  setup_time: number;
  spec?: string;
  qty_meters?: number;
  machine_name?: string;
  status?: 'ON_TIME' | 'DELAYED';
  is_locked?: boolean;
}

export interface KPIDTO {
  otd: number;
  utilization: number;
  utilization_by_process: Record<string, number>;
  tardy_orders: number;
  total_setup_count: number;
  makespan: number;
}

export interface DecisionReasonDTO {
  task_id: string;
  reasons: string[];
}

export interface DirtyRowDTO {
  row: number;
  order_id?: string | null;
  reason: string;
}

export interface CleaningReportDTO {
  file_name: string;
  file_type: 'xlsx' | 'csv' | string;
  source_sheet?: string | null;
  total_rows: number;
  empty_rows_dropped: number;
  empty_cols_dropped: number;
  ended_skipped: number;
  duplicate_skipped: number;
  dirty_rows: DirtyRowDTO[];
  valid_count: number;
  added_order_ids: string[];
  updated_order_ids: string[];
  merged: boolean;
}

export interface ScheduleAPIResponse {
  status: string;
  scheduled_tasks: ScheduledTaskDTO[];
  kpis: KPIDTO;
  decision_reasons: DecisionReasonDTO[];
  infeasible_reasons?: string[];
  cleaning_report?: CleaningReportDTO | null;
  imported_order_ids?: string[];
}

// ---- Phase 3: 动态重排与沙盘推演 ----

export type DisruptionType = 'MACHINE_BREAKDOWN' | 'URGENT_ORDER' | 'MATERIAL_DELAY';

export interface DisruptionEvent {
  type: DisruptionType;
  machine_id?: string;
  order_id?: string;
  start_time: number;
  duration_min: number;
  order_details?: Record<string, unknown>;
}

export interface ScenarioResult {
  name: string;
  profile: string;
  result: ScheduleAPIResponse;
  otd: number;
  disrupted_tasks: number;
  total_perturbation_min: number;
  added_setup_count: number;
  // 风险改进方案附加信息
  target_on_time?: boolean | null;
  target_tardiness_min?: number | null;
  remedy?: string | null;
}

export interface SimulationResponse {
  baseline: ScheduleAPIResponse;
  scenarios: ScenarioResult[];
}

// ---- Phase 4: AI Copilot ----

export interface CopilotResponse {
  reply_text: string;
  tool_calls: Array<{ name: string; parameters: Record<string, unknown> }>;
  action_payload: Record<string, unknown>;
}
