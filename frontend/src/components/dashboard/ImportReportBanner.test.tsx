import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImportReportBanner } from './ImportReportBanner';
import { useScheduleStore } from '../../store/useScheduleStore';
import type { CleaningReportDTO } from '../../types/schedule';

function makeReport(overrides: Partial<CleaningReportDTO> = {}): CleaningReportDTO {
  return {
    file_name: 'orders.xlsx',
    file_type: 'xlsx',
    source_sheet: '订单表',
    total_rows: 10,
    empty_rows_dropped: 1,
    empty_cols_dropped: 2,
    ended_skipped: 1,
    duplicate_skipped: 1,
    dirty_rows: [],
    valid_count: 5,
    added_order_ids: ['NEW-1'],
    updated_order_ids: ['OLD-2'],
    merged: true,
    ...overrides,
  };
}

beforeEach(() => {
  useScheduleStore.setState({ cleaningReport: null });
});

describe('ImportReportBanner', () => {
  it('无清洗报告时不渲染', () => {
    const { container } = render(<ImportReportBanner />);
    expect(container.innerHTML).toBe('');
  });

  it('展示文件名/工作表、合并标记与清洗统计', () => {
    useScheduleStore.setState({ cleaningReport: makeReport() });
    render(<ImportReportBanner />);
    expect(screen.getByText(/orders\.xlsx/)).toBeTruthy();
    expect(screen.getByText(/订单表/)).toBeTruthy();
    expect(screen.getByText('已合并到当前甘特图时间线')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy(); // 有效单数（5 唯一，避免与其他统计 1 冲突）
    expect(screen.getByText('新增')).toBeTruthy();
    expect(screen.getByText('更新')).toBeTruthy();
    expect(screen.getByText(/共解析 10 行/)).toBeTruthy();
  });

  it('列出脏数据行号与原因，超过 5 条可展开', () => {
    const dirty = Array.from({ length: 7 }, (_, i) => ({
      row: i + 2,
      order_id: `X-${i + 1}`,
      reason: '业务数量非法或缺失',
    }));
    useScheduleStore.setState({ cleaningReport: makeReport({ dirty_rows: dirty }) });
    render(<ImportReportBanner />);
    expect(screen.getAllByText('业务数量非法或缺失')).toHaveLength(5);
    fireEvent.click(screen.getByText(/展开全部 7 条/));
    expect(screen.getAllByText('业务数量非法或缺失')).toHaveLength(7);
  });

  it('非合并模式显示仅排产标签，且无新增/更新统计', () => {
    useScheduleStore.setState({
      cleaningReport: makeReport({ merged: false, added_order_ids: [], updated_order_ids: [] }),
    });
    render(<ImportReportBanner />);
    expect(screen.getByText('仅排产上传订单')).toBeTruthy();
  });
});
