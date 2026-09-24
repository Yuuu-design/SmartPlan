import { useEffect, useMemo } from 'react';
import type { EChartsOption } from 'echarts';
import { EChart } from '../charts/EChart';
import { Icon, type IconName } from '../Icon';
import { useScheduleStore } from '../../store/useScheduleStore';
import { formatClock } from '../../utils/ganttHelpers';
import {
  analyzeOtd,
  analyzeSetup,
  analyzeUtilization,
  PROCESS_TYPES,
  PROC_SHORT,
} from '../../utils/kpiInsights';

// 与全站色板一致
const COLOR = {
  blue: '#0a84ff',
  green: '#34c759',
  purple: '#5e5ce6',
  red: '#ff3b30',
  orange: '#ff9500',
  text2: '#6e6e73',
  grid: 'rgba(0,0,0,0.06)',
  idle: '#e5e5ea',
};
const PROC_COLOR = { DRAWING: COLOR.green, STRANDING: COLOR.blue, ROPING: COLOR.purple } as const;

export type KpiInsightType = 'otd' | 'utilization' | 'setup';

const META: Record<
  KpiInsightType,
  { title: string; icon: IconName; sub: string }
> = {
  otd: { title: '准时交付率分析', icon: 'trend-up', sub: '' },
  utilization: { title: '设备综合利用率分析', icon: 'chart', sub: '' },
  setup: { title: '换型时长 / 次数分析', icon: 'wrench', sub: '规格切换在各设备上的耗时汇总' },
};

const hours = (min: number) => `${(min / 60).toFixed(1)}h`;
const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;

const baseTextStyle = { color: COLOR.text2, fontSize: 12 };
const tooltipStyle = {
  backgroundColor: 'rgba(28,28,30,0.92)',
  borderWidth: 0,
  textStyle: { color: '#fff', fontSize: 12 },
};

// KPI 卡片钻取弹窗：三张 KPI 卡片点击后展示可视化图表 + 数据推算的原因分析 + 改进建议
export function KpiInsightModal({ type, onClose }: { type: KpiInsightType; onClose: () => void }) {
  const tasks = useScheduleStore((s) => s.tasks);
  const kpis = useScheduleStore((s) => s.kpis);
  const setSelectedTask = useScheduleStore((s) => s.setSelectedTask);
  const setFocusTask = useScheduleStore((s) => s.setFocusTask);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const otd = useMemo(() => analyzeOtd(Object.values(tasks)), [tasks]);
  const util = useMemo(() => analyzeUtilization(Object.values(tasks)), [tasks]);
  const setup = useMemo(() => analyzeSetup(Object.values(tasks)), [tasks]);
  const meta = META[type];
  const makespanMin = kpis?.makespan_minutes ?? 0;

  // 定位延期单：关弹窗 → 选中该合绳任务并聚焦，详情卡里可直接推演改进方案
  function locateDelayed(taskId: string) {
    setSelectedTask(taskId);
    setFocusTask(taskId);
    onClose();
  }

  return (
    <div className="modal-mask kpi-insight-mask" onClick={onClose} role="presentation">
      <div
        className="kpi-insight-modal"
        role="dialog"
        aria-modal="true"
        aria-label={meta.title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ki-head">
          <div className="ki-title">
            <Icon name={meta.icon} size={18} color="var(--blue)" />
            <span>{meta.title}</span>
          </div>
          <div className="ki-head-right">
            {meta.sub && <span className="ki-sub">{meta.sub}</span>}
            <button className="icon-btn" onClick={onClose} title="关闭 (Esc)">
              <Icon name="x" size={15} />
            </button>
          </div>
        </div>

        {type === 'otd' && (
          <OtdBody otd={otd} makespanMin={makespanMin} onLocate={locateDelayed} />
        )}
        {type === 'utilization' && <UtilBody util={util} />}
        {type === 'setup' && <SetupBody setup={setup} />}
      </div>
    </div>
  );
}

/* ---------------- 通用小块 ---------------- */

function StatStrip({ items }: { items: Array<{ label: string; value: string; tone?: 'blue' | 'red' | 'green' }> }) {
  return (
    <div className="ki-stat-strip">
      {items.map((it) => (
        <div className="ki-stat" key={it.label}>
          <div className="ki-stat-value">{it.value}</div>
          <div className={`ki-stat-label${it.tone ? ` ${it.tone}` : ''}`}>{it.label}</div>
        </div>
      ))}
    </div>
  );
}

function InsightSection({
  icon,
  tone,
  title,
  children,
}: {
  icon: IconName;
  tone: 'blue' | 'red' | 'green';
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="ki-section">
      <div className="ki-section-title">
        <Icon name={icon} size={14} color={`var(--${tone === 'blue' ? 'blue' : tone === 'red' ? 'red' : 'green'})`} />
        {title}
      </div>
      <ul className="ki-bullets">{children}</ul>
    </div>
  );
}

/* ---------------- 1. OTD ---------------- */

function OtdBody({
  otd,
  makespanMin,
  onLocate,
}: {
  otd: ReturnType<typeof analyzeOtd>;
  makespanMin: number;
  onLocate: (taskId: string) => void;
}) {
  const donutOption = useMemo<EChartsOption>(
    () => ({
      tooltip: { trigger: 'item', ...tooltipStyle, formatter: '{b}：{c} 单（{d}%）' },
      legend: { bottom: 0, textStyle: baseTextStyle, itemWidth: 10, itemHeight: 10 },
      series: [
        {
          type: 'pie',
          radius: ['58%', '82%'],
          center: ['50%', '44%'],
          avoidLabelOverlap: true,
          label: {
            show: true,
            position: 'center',
            formatter: `${pct(otd.rate, 1)}\n`,
            fontSize: 30,
            fontWeight: 700,
            color: COLOR.blue,
            lineHeight: 36,
          },
          data: [
            { value: otd.onTime, name: '准时交付', itemStyle: { color: COLOR.blue } },
            ...(otd.delayed > 0
              ? [{ value: otd.delayed, name: '延期', itemStyle: { color: COLOR.red } }]
              : []),
          ],
        },
      ],
    }),
    [otd],
  );

  const scatterOption = useMemo<EChartsOption>(() => {
    const points = otd.finishRows.map((r, i) => ({
      value: [+(r.endMin / 60).toFixed(2), i + 1],
      name: r.order_id,
      itemStyle: { color: r.delayed ? COLOR.red : COLOR.blue },
    }));
    return {
      tooltip: {
        ...tooltipStyle,
        formatter: (p: unknown) => {
          const d = (p as { data: { name: string; value: number[] } }).data;
          return `${d.name}<br/>合绳完工：${d.value[0]}h`;
        },
      },
      grid: { left: 44, right: 16, top: 24, bottom: 34 },
      xAxis: {
        type: 'value',
        name: '合绳完工 (h)',
        nameLocation: 'middle',
        nameGap: 24,
        nameTextStyle: baseTextStyle,
        axisLabel: { color: COLOR.text2 },
        splitLine: { lineStyle: { color: COLOR.grid } },
      },
      yAxis: {
        type: 'value',
        name: '订单序号',
        nameTextStyle: baseTextStyle,
        axisLabel: { color: COLOR.text2 },
        splitLine: { lineStyle: { color: COLOR.grid } },
      },
      series: [
        {
          type: 'scatter',
          symbolSize: 9,
          data: points,
          markLine: makespanMin
            ? {
                silent: true,
                symbol: 'none',
                lineStyle: { color: COLOR.text2, type: 'dashed' },
                label: { formatter: '整体完工跨度', color: COLOR.text2, fontSize: 11 },
                data: [{ xAxis: +(makespanMin / 60).toFixed(1) }],
              }
            : undefined,
        },
      ],
    };
  }, [otd, makespanMin]);

  const topMachine = otd.delayedByMachine[0];
  const machineConcentration =
    topMachine && otd.delayed > 0 ? Math.round((topMachine.count / otd.delayed) * 100) : 0;

  return (
    <div className="ki-body">
      <StatStrip
        items={[
          { label: '订单总数', value: String(otd.totalOrders) },
          { label: '准时交付', value: String(otd.onTime), tone: 'green' },
          { label: '延期订单', value: String(otd.delayed), tone: otd.delayed > 0 ? 'red' : 'green' },
          { label: '准时交付率', value: pct(otd.rate, 1), tone: 'blue' },
        ]}
      />

      <div className="ki-chart-grid">
        <div className="ki-chart-card">
          <div className="ki-chart-title">交付结果构成</div>
          <EChart option={donutOption} height={250} />
        </div>
        <div className="ki-chart-card">
          <div className="ki-chart-title">订单合绳完工时间分布（蓝=准时，红=延期）</div>
          <EChart option={scatterOption} height={250} />
        </div>
      </div>

      {otd.delayedOrders.length > 0 && (
        <div className="ki-section">
          <div className="ki-section-title">
            <Icon name="package" size={14} color="var(--red)" />
            延期订单清单
          </div>
          <div className="ki-order-list">
            {otd.delayedOrders.map((o) => (
              <button key={o.order_id} className="ki-order-row" onClick={() => onLocate(o.task_id)}>
                <span className="ki-order-id mono">{o.order_id}</span>
                <span className="ki-order-meta">
                  {o.machine_name} · 完工 {formatClock(o.endMin)}
                </span>
                <span className="ki-order-cta">
                  定位推演
                  <Icon name="arrow-right" size={13} />
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- 2. 设备利用率 ---------------- */

function UtilBody({ util }: { util: ReturnType<typeof analyzeUtilization> }) {
  const procBarOption = useMemo<EChartsOption>(
    () => ({
      tooltip: {
        ...tooltipStyle,
        formatter: (p: unknown) => {
          const d = p as { name: string; value: number };
          return `${d.name}：${pct(d.value)}`;
        },
      },
      grid: { left: 90, right: 48, top: 12, bottom: 24 },
      xAxis: {
        type: 'value',
        max: 1,
        axisLabel: { color: COLOR.text2, formatter: (v: number) => `${Math.round(v * 100)}%` },
        splitLine: { lineStyle: { color: COLOR.grid } },
      },
      yAxis: {
        type: 'category',
        data: PROCESS_TYPES.map((p) => PROC_SHORT[p]).reverse(),
        axisLabel: { color: '#1d1d1f', fontSize: 13 },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      series: [
        {
          type: 'bar',
          barWidth: 22,
          data: PROCESS_TYPES.map((p) => ({
            value: +util.byProcess[p].toFixed(4),
            name: PROC_SHORT[p],
            itemStyle: { color: PROC_COLOR[p], borderRadius: [0, 6, 6, 0] },
          })).reverse(),
          label: {
            show: true,
            position: 'right',
            formatter: (p: unknown) => pct((p as { value: number }).value, 0),
            color: COLOR.text2,
            fontSize: 12,
          },
        },
      ],
    }),
    [util],
  );

  const loadOption = useMemo<EChartsOption>(() => {
    const rows = [...util.topLoaded].reverse(); // 横条自上而下：最高在最上
    return {
      tooltip: {
        ...tooltipStyle,
        formatter: (p: unknown) => {
          const d = p as { data: { machineName: string; proc: number; setup: number; idle: number; rate: number } };
          const x = d.data;
          return `${x.machineName}<br/>利用率 ${pct(x.rate)}<br/>加工 ${hours(x.proc)} · 换型 ${hours(
            x.setup,
          )} · 空闲 ${hours(x.idle)}`;
        },
      },
      legend: { bottom: 0, textStyle: baseTextStyle, itemWidth: 10, itemHeight: 10 },
      grid: { left: 110, right: 44, top: 12, bottom: 34 },
      xAxis: {
        type: 'value',
        max: 1,
        axisLabel: { color: COLOR.text2, formatter: (v: number) => `${Math.round(v * 100)}%` },
        splitLine: { lineStyle: { color: COLOR.grid } },
      },
      yAxis: {
        type: 'category',
        data: rows.map((m) => (m.machine_name.length > 9 ? m.machine_name.slice(0, 9) + '…' : m.machine_name)),
        axisLabel: { color: '#1d1d1f', fontSize: 11 },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      series: [
        {
          name: '加工',
          type: 'bar',
          stack: 'load',
          barWidth: 14,
          itemStyle: { color: COLOR.blue },
          data: rows.map((m) => ({
            value: +(m.procMin / m.spanMin).toFixed(4),
            machineName: m.machine_name,
            proc: m.procMin,
            setup: m.setupMin,
            idle: m.idleMin,
            rate: m.rate,
          })),
        },
        {
          name: '换型',
          type: 'bar',
          stack: 'load',
          itemStyle: { color: COLOR.orange },
          data: rows.map((m) => +(m.setupMin / m.spanMin).toFixed(4)),
        },
        {
          name: '空闲',
          type: 'bar',
          stack: 'load',
          itemStyle: { color: COLOR.idle },
          data: rows.map((m) => +Math.max(0, m.idleMin / m.spanMin).toFixed(4)),
        },
      ],
    };
  }, [util]);

  return (
    <div className="ki-body">
      <StatStrip
        items={[
          { label: '综合利用率', value: pct(util.overall, 1), tone: 'blue' },
          { label: '活跃设备', value: String(util.machines.length) },
          { label: '瓶颈设备 ≥90%', value: String(util.machines.filter((m) => m.rate >= 0.9).length), tone: util.machines.some((m) => m.rate >= 0.9) ? 'red' : 'green' },
          { label: '跨度内总空闲', value: hours(util.totalIdleMin) },
        ]}
      />

      <div className="ki-tier-row">
        {util.tiers.map((t) => (
          <div className={`ki-tier ${t.key}`} key={t.key}>
            <span className="ki-tier-count">{t.count}</span>
            <span className="ki-tier-label">{t.label}</span>
          </div>
        ))}
      </div>

      <div className="ki-chart-grid">
        <div className="ki-chart-card">
          <div className="ki-chart-title">三工序设备利用率</div>
          <EChart option={procBarOption} height={230} />
        </div>
        <div className="ki-chart-card ki-chart-wide">
          <EChart option={loadOption} height={280} />
        </div>
      </div>
    </div>
  );
}

/* ---------------- 3. 换型 ---------------- */

function SetupBody({ setup }: { setup: ReturnType<typeof analyzeSetup> }) {
  const machineOption = useMemo<EChartsOption>(() => {
    const rows = [...setup.topMachines].reverse();
    return {
      tooltip: {
        ...tooltipStyle,
        formatter: (p: unknown) => {
          const d = p as { data: { name: string; value: number; count: number; avg: number } };
          return `${d.data.name}<br/>换型 ${hours(d.data.value)} · ${d.data.count} 次<br/>单次平均 ${d.data.avg.toFixed(
            0,
          )}min`;
        },
      },
      grid: { left: 110, right: 52, top: 12, bottom: 24 },
      xAxis: {
        type: 'value',
        name: '小时',
        nameTextStyle: baseTextStyle,
        axisLabel: { color: COLOR.text2, formatter: (v: number) => (v / 60).toFixed(0) },
        splitLine: { lineStyle: { color: COLOR.grid } },
      },
      yAxis: {
        type: 'category',
        data: rows.map((m) => (m.machine_name.length > 9 ? m.machine_name.slice(0, 9) + '…' : m.machine_name)),
        axisLabel: { color: '#1d1d1f', fontSize: 11 },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      series: [
        {
          type: 'bar',
          barWidth: 14,
          itemStyle: { color: COLOR.orange, borderRadius: [0, 6, 6, 0] },
          label: {
            show: true,
            position: 'right',
            color: COLOR.text2,
            fontSize: 11,
            formatter: (p: unknown) => `${(p as { data: { count: number } }).data.count}次`,
          },
          data: rows.map((m) => ({
            name: m.machine_name,
            value: m.setupMin,
            count: m.setupCount,
            avg: m.setupCount ? m.setupMin / m.setupCount : 0,
          })),
        },
      ],
    };
  }, [setup]);

  const donutOption = useMemo<EChartsOption>(
    () => ({
      tooltip: { trigger: 'item', ...tooltipStyle, formatter: '{b}：{d}%' },
      legend: { bottom: 0, textStyle: baseTextStyle, itemWidth: 10, itemHeight: 10 },
      series: [
        {
          type: 'pie',
          radius: ['56%', '80%'],
          center: ['50%', '44%'],
          label: {
            show: true,
            position: 'center',
            formatter: `${pct(setup.setupShareOfSpan, 1)}\n`,
            fontSize: 26,
            fontWeight: 700,
            color: COLOR.orange,
            lineHeight: 32,
          },
          data: [
            { value: +setup.procShareOfSpan.toFixed(4), name: '加工', itemStyle: { color: COLOR.blue } },
            { value: +setup.setupShareOfSpan.toFixed(4), name: '换型', itemStyle: { color: COLOR.orange } },
            { value: +setup.idleShareOfSpan.toFixed(4), name: '空闲', itemStyle: { color: COLOR.idle } },
          ],
        },
      ],
    }),
    [setup],
  );

  return (
    <div className="ki-body">
      <StatStrip
        items={[
          { label: '换型总时长', value: hours(setup.totalSetupMin), tone: 'blue' },
          { label: '换型次数', value: `${setup.totalSetupCount} 次` },
          { label: '单次平均', value: `${setup.avgSetupMin.toFixed(0)} min` },
          { label: '占设备活跃跨度', value: pct(setup.setupShareOfSpan, 1), tone: 'red' },
        ]}
      />

      <div className="ki-chart-grid">
        <div className="ki-chart-card ki-chart-wide">
          <div className="ki-chart-title">换型时长 Top 10 设备（条尾为换型次数）</div>
          <EChart option={machineOption} height={280} />
        </div>
        <div className="ki-chart-card">
          <div className="ki-chart-title">设备活跃时间构成</div>
          <EChart option={donutOption} height={250} />
        </div>
      </div>
    </div>
  );
}
