import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RemediationPanel } from './RemediationPanel';
import { useScheduleStore } from '../../store/useScheduleStore';

const OID = '2902-202608030001-1-1';

function task(end: number, status = 'DELAYED') {
  return {
    task_id: `T${end}`,
    order_id: OID,
    process_type: 'Roping',
    machine_id: '8246',
    machine_name: '8246 合绳机',
    start_time: end - 60,
    end_time: end,
    status,
    spec: '12mm',
  };
}

const kpis = {
  otd: 0.98,
  utilization: 0.5,
  utilization_by_process: {},
  total_setup_count: 3,
  makespan: 2000,
  on_time_rate: 0.98,
  on_time_orders: 49,
  tardy_orders: 1,
  total_orders: 50,
};

const simPayload = {
  baseline: {
    scheduled_tasks: [task(220)],
    kpis,
  },
  scenarios: [
    {
      name: '方案A·专项优先',
      profile: 'remedy_focus',
      otd: 0.98,
      disrupted_tasks: 9,
      total_perturbation_min: 200,
      added_setup_count: -4,
      target_on_time: false,
      target_tardiness_min: 220,
      remedy: '在目标函数中对该订单施加 20 倍延期惩罚，优先占用关键机台。',
      result: { scheduled_tasks: [task(220)], kpis },
    },
    {
      name: '方案B·加班赶工',
      profile: 'remedy_overtime',
      otd: 0.98,
      disrupted_tasks: 73,
      total_perturbation_min: 1500,
      added_setup_count: 1,
      target_on_time: false,
      target_tardiness_min: 188,
      remedy: '该订单各工序按 0.8 倍工时压缩，模拟加班/提速。',
      result: { scheduled_tasks: [task(188)], kpis },
    },
  ],
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => simPayload }),
  );
  useScheduleStore.getState().clearSimulation();
  useScheduleStore.setState({ resolvedRiskOrderIds: [] });
});

describe('RemediationPanel', () => {
  it('非延期任务不渲染', () => {
    const { container } = render(<RemediationPanel orderId={OID} active={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('推演后展示方案卡片：仍延期徽章、手段说明、完工提前量，并可运用', async () => {
    render(<RemediationPanel orderId={OID} active />);
    fireEvent.click(screen.getByText('为该订单推演改进方案'));

    await waitFor(() => expect(screen.getByText(/方案 A·专项优先/)).toBeTruthy());
    // 救不回交期时给出协商交期提示
    expect(screen.getByText(/建议同步与客户协商交期/)).toBeTruthy();
    expect(screen.getByText('仍延期 188min')).toBeTruthy();
    // B 方案完工 220→188，提前 32 分钟
    expect(screen.getByText('完工提前 32min')).toBeTruthy();

    // 运用方案B → 甘特图数据切换到该方案（store.activeScenarioIndex=1），该单风险标记已处置
    const applyBtns = screen.getAllByText('运用此方案');
    fireEvent.click(applyBtns[1]);
    expect(useScheduleStore.getState().activeScenarioIndex).toBe(1);
    expect(useScheduleStore.getState().resolvedRiskOrderIds).toContain(OID);
    expect(screen.getByText(/已运用/)).toBeTruthy();
    expect(screen.getByText(/风险已处置/)).toBeTruthy();

    // 撤销恢复基线 → 处置标记作废，风险重新出现
    fireEvent.click(screen.getByText('撤销，恢复基线计划'));
    expect(useScheduleStore.getState().simulation).toBeNull();
    expect(useScheduleStore.getState().resolvedRiskOrderIds).toEqual([]);
  });

  it('不采用时回到初始态，不改动排产', async () => {
    render(<RemediationPanel orderId={OID} active />);
    fireEvent.click(screen.getByText('为该订单推演改进方案'));
    await waitFor(() => expect(screen.getByText('不采用，保持当前计划')).toBeTruthy());
    fireEvent.click(screen.getByText('不采用，保持当前计划'));
    expect(screen.getByText('为该订单推演改进方案')).toBeTruthy();
    expect(useScheduleStore.getState().simulation).toBeNull();
  });
});
