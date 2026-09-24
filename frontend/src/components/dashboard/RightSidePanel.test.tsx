import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RightSidePanel } from './RightSidePanel';
import { useScheduleStore } from '../../store/useScheduleStore';

beforeEach(() => {
  // 回到干净的 store 初始态，避免任务详情等条件渲染干扰
  useScheduleStore.setState({
    tasks: {},
    machines: [],
    selectedTaskId: null,
    simulation: null,
  });
});

describe('RightSidePanel 收起/展开', () => {
  it('默认展开：分段控件可见，边缘钮为「收起面板」', () => {
    render(<RightSidePanel />);
    expect(screen.getByRole('tablist')).toBeTruthy();
    const toggle = screen.getByLabelText('收起面板');
    expect(toggle).toBeTruthy();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.classList.contains('side-rail-toggle')).toBe(true);
  });

  it('点边缘钮收起：槽位加 collapsed、面板 inert，同一按钮翻转为「展开面板」', () => {
    const { container } = render(<RightSidePanel />);
    const toggle = screen.getByLabelText('收起面板');
    fireEvent.click(toggle);

    const slot = container.querySelector('.side-panel-slot');
    expect(slot?.classList.contains('side-collapsed')).toBe(true);

    const aside = container.querySelector('.side-panel') as HTMLElement;
    expect(aside.hasAttribute('inert')).toBe(true);
    expect(aside.getAttribute('aria-hidden')).toBe('true');

    // 同一个按钮节点，仅可访问名/图标翻转，位置不变
    expect(toggle.getAttribute('aria-label')).toBe('展开面板');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelectorAll('.side-rail-toggle').length).toBe(1);
  });

  it('再点同一位置的按钮恢复完整面板，内容重新可访问', () => {
    const { container } = render(<RightSidePanel />);
    fireEvent.click(screen.getByLabelText('收起面板'));
    fireEvent.click(screen.getByLabelText('展开面板'));

    const slot = container.querySelector('.side-panel-slot');
    expect(slot?.classList.contains('side-collapsed')).toBe(false);
    const aside = container.querySelector('.side-panel') as HTMLElement;
    expect(aside.hasAttribute('inert')).toBe(false);
    expect(screen.getByLabelText('收起面板')).toBeTruthy();
  });
});
