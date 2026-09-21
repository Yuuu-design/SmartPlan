import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImportExcelModal } from './ImportExcelModal';
import { fetchScheduleWithFiles } from '../../api/scheduleApi';
import type { ScheduleAPIResponse } from '../../types/schedule';

vi.mock('../../api/scheduleApi', () => ({
  fetchScheduleWithFiles: vi.fn().mockResolvedValue({
    status: 'FEASIBLE',
    scheduled_tasks: [],
    kpis: {
      otd: 1,
      utilization: 0,
      utilization_by_process: {},
      tardy_orders: 0,
      total_setup_count: 0,
      makespan: 0,
    },
    decision_reasons: [],
  } satisfies ScheduleAPIResponse),
}));

const mockedFetch = vi.mocked(fetchScheduleWithFiles);

function renderModal(props: Partial<Parameters<typeof ImportExcelModal>[0]> = {}) {
  return render(
    <ImportExcelModal
      open
      onClose={vi.fn()}
      // 真正执行 fetcher，使 fetchScheduleWithFiles 被调用，便于断言 merge 参数
      onRun={(fetcher) => fetcher().then(() => undefined)}
      {...props}
    />,
  );
}

function orderInput(): HTMLInputElement {
  return document.querySelector('input[type=file]') as HTMLInputElement;
}

beforeEach(() => {
  mockedFetch.mockClear();
});

describe('ImportExcelModal', () => {
  it('未选文件时提交按钮置灰，且不再展示下载模板板块', () => {
    renderModal();
    const submit = screen.getByText('开始分析并排产').closest('button')!;
    expect(submit.disabled).toBe(true);
    expect(screen.queryByText('下载模板')).toBeNull();
    expect(screen.queryByText('下载标准模板，按列填写订单')).toBeNull();
  });

  it('选择 .xlsx 后显示文件名并启用提交', () => {
    renderModal();
    fireEvent.change(orderInput(), {
      target: { files: [new File(['x'], '订单2026.xlsx', { type: 'application/vnd.ms-excel' })] },
    });
    expect(screen.getByText('订单2026.xlsx')).toBeTruthy();
    expect(screen.getByText('开始分析并排产').closest('button')!.disabled).toBe(false);
  });

  it('接受 .csv 文件', () => {
    renderModal();
    fireEvent.change(orderInput(), { target: { files: [new File(['a,b'], 'orders.csv', { type: 'text/csv' })] } });
    expect(screen.getByText('orders.csv')).toBeTruthy();
    expect(screen.getByText('开始分析并排产').closest('button')!.disabled).toBe(false);
    expect(orderInput().getAttribute('accept')).toContain('.csv');
  });

  it('拒绝 .xls 文件并提示另存为 .xlsx / .csv', () => {
    renderModal();
    fireEvent.change(orderInput(), { target: { files: [new File(['x'], 'old.xls')] } });
    expect(screen.getByText(/仅支持 \.xlsx \/ \.csv/)).toBeTruthy();
    expect(screen.getByText('开始分析并排产').closest('button')!.disabled).toBe(true);
  });

  it('合并开关默认开启，提交时 merge=true 传入 API', async () => {
    renderModal();
    const checkbox = screen.getByLabelText(/合并到当前甘特图时间线/) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    fireEvent.change(orderInput(), { target: { files: [new File(['x'], 'orders.xlsx')] } });
    fireEvent.click(screen.getByText('开始分析并排产').closest('button')!);
    await vi.waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(1));
    expect(mockedFetch.mock.calls[0]?.[3]).toBe(true);
  });

  it('关闭合并开关后提交，merge=false 传入 API', async () => {
    renderModal();
    const checkbox = screen.getByLabelText(/合并到当前甘特图时间线/) as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);
    fireEvent.change(orderInput(), { target: { files: [new File(['x'], 'orders.csv')] } });
    fireEvent.click(screen.getByText('开始分析并排产').closest('button')!);
    await vi.waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(1));
    expect(mockedFetch.mock.calls[0]?.[3]).toBe(false);
  });

  it('关闭状态不渲染内容', () => {
    renderModal({ open: false });
    expect(screen.queryByText(/导入订单 Excel \/ CSV 智能排产/)).toBeNull();
  });
});
