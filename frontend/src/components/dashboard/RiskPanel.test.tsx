import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { RiskPanel, selectRiskOrders } from './RiskPanel';
import { useScheduleStore } from '../../store/useScheduleStore';
import type { GanttTask, ScheduleAPIResponse, SimulationResponse } from '../../types/schedule';

function ganttTask(over: Partial<GanttTask> = {}): GanttTask {
  return {
    task_id: 't1',
    order_id: 'O-1',
    process_type: 'ROPING',
    machine_id: '8246',
    machine_name: '合绳机8246',
    spec: '8mm',
    qty_meters: 1000,
    start_time: 160,
    end_time: 220,
    duration_minutes: 60,
    setup_duration_min: 0,
    is_locked: false,
    status: 'ON_TIME',
    ...over,
  };
}

beforeEach(() => {
  useScheduleStore.setState({
    tasks: {},
    conflictTaskIds: [],
    resolvedRiskOrderIds: [],
    selectedTaskId: null,
    simulation: null,
  });
});

describe('selectRiskOrders', () => {
  it('汇总延期/冲突订单，按订单去重', () => {
    const tasks = {
      a: ganttTask({ task_id: 'a', order_id: 'O-DELAY', status: 'DELAYED' }),
      b: ganttTask({ task_id: 'b', order_id: 'O-CONFLICT', status: 'ON_TIME' }),
      c: ganttTask({ task_id: 'c', order_id: 'O-OK', status: 'ON_TIME' }),
    };
    const risks = selectRiskOrders(tasks, ['b']);
    expect(risks.map((r) => r.order_id).sort()).toEqual(['O-CONFLICT', 'O-DELAY']);
  });

  it('已处置订单不再计入风险队列', () => {
    const tasks = {
      a: ganttTask({ task_id: 'a', order_id: 'O-DELAY', status: 'DELAYED' }),
      b: ganttTask({ task_id: 'b', order_id: 'O-DELAY', process_type: 'STRANDING', status: 'ON_TIME' }),
    };
    expect(selectRiskOrders(tasks, [], ['O-DELAY'])).toEqual([]);
  });
});

describe('RiskPanel 风险处置闭环', () => {
  it('运用方案处置后：风险卡移除、显示已处置空态文案', () => {
    useScheduleStore.setState({
      tasks: {
        t1: ganttTask({ task_id: 't1', order_id: '2902-202608030001-1-1', status: 'DELAYED' }),
      },
    });

    const { rerender } = render(<RiskPanel />);
    expect(screen.getByText('2902-202608030001-1-1')).toBeTruthy();
    expect(screen.getByText('交期延期风险')).toBeTruthy();

    act(() => {
      useScheduleStore.getState().resolveRiskOrder('2902-202608030001-1-1');
    });
    rerender(<RiskPanel />);

    expect(screen.queryByText('2902-202608030001-1-1')).toBeNull();
    expect(screen.getByText(/1 个订单风险已通过改进方案处置/)).toBeTruthy();
  });

  it('撤销方案回基线后处置标记作废，风险重新出现', () => {
    useScheduleStore.setState({
      tasks: {
        t1: ganttTask({ task_id: 't1', order_id: 'O-1', status: 'DELAYED' }),
      },
    });
    act(() => {
      useScheduleStore.getState().resolveRiskOrder('O-1');
    });
    const { rerender } = render(<RiskPanel />);
    expect(screen.queryByText('O-1')).toBeNull();

    // 模拟 applyScenario(null)：先放入含 baseline 的 simulation
    const baseline: ScheduleAPIResponse = {
      status: 'ok',
      scheduled_tasks: [
        {
          task_id: 't1',
          order_id: 'O-1',
          process_type: 'Roping',
          machine_id: '8246',
          start_time: 160,
          end_time: 220,
          duration_minutes: 60,
          setup_time: 0,
          status: 'DELAYED',
        },
      ],
      kpis: {
        otd: 0.98,
        utilization: 0.5,
        utilization_by_process: {},
        tardy_orders: 1,
        total_setup_count: 0,
        makespan: 220,
      },
      decision_reasons: [],
    };
    const simulation: SimulationResponse = { baseline, scenarios: [] };
    act(() => {
      useScheduleStore.setState({ simulation });
      useScheduleStore.getState().applyScenario(null);
    });
    rerender(<RiskPanel />);

    expect(screen.getByText('O-1')).toBeTruthy();
    expect(useScheduleStore.getState().resolvedRiskOrderIds).toEqual([]);
  });

  it('setScheduleData 载入新排程时作废旧的客户端冲突标记', () => {
    useScheduleStore.setState({ conflictTaskIds: ['stale-id'] });
    const response: ScheduleAPIResponse = {
      status: 'ok',
      scheduled_tasks: [
        {
          task_id: 't1',
          order_id: 'O-1',
          process_type: 'Roping',
          machine_id: '8246',
          start_time: 0,
          end_time: 60,
          duration_minutes: 60,
          setup_time: 0,
          status: 'ON_TIME',
        },
      ],
      kpis: {
        otd: 1,
        utilization: 0.5,
        utilization_by_process: {},
        tardy_orders: 0,
        total_setup_count: 0,
        makespan: 60,
      },
      decision_reasons: [],
    };
    act(() => {
      useScheduleStore.getState().setScheduleData(response);
    });
    expect(useScheduleStore.getState().conflictTaskIds).toEqual([]);
  });
});
