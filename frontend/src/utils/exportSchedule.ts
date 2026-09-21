import * as XLSX from 'xlsx';
import type { GanttTask, Machine, ProcessType } from '../types/schedule';
import { formatClock } from './ganttHelpers';

const PROCESS_LABEL: Record<ProcessType, string> = {
  DRAWING: '拉丝',
  STRANDING: '捻股',
  ROPING: '合绳',
};

const STATUS_LABEL: Record<string, string> = {
  ON_TIME: '准时',
  DELAYED: '延期',
  CONFLICT: '冲突',
};

interface ExportRange {
  /** 时间范围起点（分钟，相对排产起点） */
  minTime: number;
  /** 时间范围终点（分钟，相对排产起点） */
  maxTime: number;
}

/** 导出排产计划表为 Excel，按 start_time 排序，仅导出时间范围内的任务。 */
export function exportScheduleToExcel(
  tasks: GanttTask[],
  machines: Machine[],
  range: ExportRange,
): void {
  const machineNameMap = new Map(machines.map((m) => [m.machine_id, m.machine_name]));

  // 按开始时间排序，过滤掉时间范围外的任务
  const rows = [...tasks]
    .filter((t) => t.end_time >= range.minTime && t.start_time <= range.maxTime)
    .sort((a, b) => a.start_time - b.start_time);

  const aoa: (string | number | boolean)[][] = [];
  // 表头
  aoa.push([
    '序号',
    '订单号',
    '工序',
    '规格',
    '数量(米)',
    '设备编号',
    '设备名称',
    '开始时间',
    '结束时间',
    '加工时长(分钟)',
    '换型时长(分钟)',
    '状态',
    '锁定',
  ]);

  rows.forEach((t, i) => {
    aoa.push([
      i + 1,
      t.order_id,
      PROCESS_LABEL[t.process_type] ?? t.process_type,
      t.spec,
      t.qty_meters,
      t.machine_id,
      machineNameMap.get(t.machine_id) ?? t.machine_id,
      formatClock(t.start_time),
      formatClock(t.end_time),
      t.duration_minutes,
      t.setup_duration_min,
      STATUS_LABEL[t.status] ?? t.status,
      t.is_locked ? '是' : '否',
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // 设置列宽
  ws['!cols'] = [
    { wch: 6 },   // 序号
    { wch: 12 },  // 订单号
    { wch: 8 },   // 工序
    { wch: 24 },  // 规格
    { wch: 12 },  // 数量
    { wch: 12 },  // 设备编号
    { wch: 14 },  // 设备名称
    { wch: 12 },  // 开始时间
    { wch: 12 },  // 结束时间
    { wch: 12 },  // 加工时长
    { wch: 12 },  // 换型时长
    { wch: 8 },   // 状态
    { wch: 6 },   // 锁定
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '排产计划');

  const date = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const fname = `排产表_${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}.xlsx`;

  XLSX.writeFile(wb, fname);
}
