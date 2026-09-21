import type { GanttTask } from '../../types/schedule';

export type MachinePhase = 'setup' | 'running' | 'idle';

/** 找到车间最繁忙的时刻（扫描线算法）。 */
export function findPeakTime(tasks: GanttTask[]): number {
  if (tasks.length === 0) return 0;
  const events: { time: number; delta: number }[] = [];
  for (const t of tasks) {
    events.push({ time: t.start_time, delta: 1 });
    events.push({ time: t.end_time, delta: -1 });
  }
  events.sort((a, b) => a.time - b.time || b.delta - a.delta);
  let count = 0, peakTime = 0, peakCount = 0;
  for (const e of events) {
    count += e.delta;
    if (count > peakCount) {
      peakCount = count;
      peakTime = e.time;
    }
  }
  return peakTime;
}

export interface MachineState {
  machineId: string;
  phase: MachinePhase;
  task: GanttTask | null;
  progress: number;
}

export interface WorkshopSnapshot {
  horizon: number;
  machineCount: number;
  machines: Record<string, MachineState>;
  runningCount: number;
  setupCount: number;
  idleCount: number;
  activeOrderCount: number;
  completedMeters: number;
  delayedActiveCount: number;
  completedOrderCount: number;
  onTimeOrderCount: number;
}

/** 单台设备在 t 时刻的状态：[start-setup, start) → setup；[start, end) → running；其余 idle。 */
export function machineStateAt(
  machineTasks: GanttTask[],
  machineId: string,
  t: number,
): MachineState {
  const task = machineTasks.find(
    (task) => t >= task.start_time - task.setup_duration_min && t < task.end_time,
  );
  if (!task) return { machineId, phase: 'idle', task: null, progress: 0 };
  if (t < task.start_time) {
    const span = Math.max(1, task.setup_duration_min);
    return {
      machineId,
      phase: 'setup',
      task,
      progress: Math.min(1, (t - (task.start_time - task.setup_duration_min)) / span),
    };
  }
  const span = Math.max(1, task.end_time - task.start_time);
  return {
    machineId,
    phase: 'running',
    task,
    progress: Math.min(1, (t - task.start_time) / span),
  };
}

/** 整个车间在 t 时刻的快照。 */
export function workshopSnapshotAt(
  tasks: GanttTask[],
  t: number,
): WorkshopSnapshot {
  // 按机台分组
  const byMachine = new Map<string, GanttTask[]>();
  for (const task of tasks) {
    if (!byMachine.has(task.machine_id)) byMachine.set(task.machine_id, []);
    byMachine.get(task.machine_id)!.push(task);
  }

  const machines: Record<string, MachineState> = {};
  let runningCount = 0;
  let setupCount = 0;
  let delayedActiveCount = 0;
  const activeOrders = new Set<string>();
  let completedMeters = 0;

  for (const [machineId, machineTasks] of byMachine) {
    const state = machineStateAt(machineTasks, machineId, t);
    machines[machineId] = state;
    if (state.phase === 'running') {
      runningCount++;
      if (state.task) {
        activeOrders.add(state.task.order_id);
        completedMeters += Math.floor(state.task.qty_meters * state.progress);
        if (state.task.status === 'DELAYED') delayedActiveCount++;
      }
    } else if (state.phase === 'setup') {
      setupCount++;
      if (state.task) activeOrders.add(state.task.order_id);
    }
  }

  // 订单级聚合：完成/准时
  const ordersDone = new Set<string>();
  const ordersTotal = new Set<string>();
  for (const task of tasks) {
    ordersTotal.add(task.order_id);
    if (task.end_time <= t) ordersDone.add(task.order_id);
  }

  return {
    horizon: t,
    machineCount: byMachine.size,
    machines,
    runningCount,
    setupCount,
    idleCount: byMachine.size - runningCount - setupCount,
    activeOrderCount: activeOrders.size,
    completedMeters,
    delayedActiveCount,
    completedOrderCount: ordersDone.size,
    onTimeOrderCount: ordersTotal.size - ordersDone.size, // 粗略：未完工即"准时在制"
  };
}
