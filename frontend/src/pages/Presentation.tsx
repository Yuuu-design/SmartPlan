import { useEffect, useMemo, useState } from 'react';
import type { EChartsOption } from 'echarts';
import { fetchSchedule, simulateDisruption } from '../api/scheduleApi';
import { EChart } from '../components/charts/EChart';
import { Icon, type IconName } from '../components/Icon';
import type { ScheduleAPIResponse, SimulationResponse, ScheduledTaskDTO } from '../types/schedule';

const C = {
  blue: '#0a84ff',
  cyan: '#007aff',
  green: '#34c759',
  yellow: '#ffcc00',
  orange: '#ff9500',
  red: '#ff3b30',
  purple: '#5e5ce6',
  text: '#1d1d1f',
  text2: '#6e6e73',
  grid: 'rgba(0,0,0,0.06)',
};

const PROC_CN: Record<string, string> = { Drawing: '拉丝', Stranding: '捻股', Roping: '合绳' };

// 自定义 CSS 风格 cubic-bezier 缓动（ECharts 支持传入 easing 函数）
function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const sampleDX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  const solveX = (x: number) => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sampleX(t) - x;
      if (Math.abs(err) < 1e-6) return t;
      const d = sampleDX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    while (lo < hi) {
      const err = sampleX(t);
      if (Math.abs(err - x) < 1e-6) return t;
      if (x > err) lo = t;
      else hi = t;
      t = (hi - lo) / 2 + lo;
    }
    return t;
  };
  return (k: number) => (k <= 0 ? 0 : k >= 1 ? 1 : sampleY(solveX(k)));
}

// 各图缓动：按图表语义选择（弹跳/弹性/缓入缓出/自定义贝塞尔）
const EASE = {
  barBounce: 'bounceOut' as const,            // 柱状冲顶回弹，有活力
  pieElastic: 'elasticOut' as const,          // 饼图弹性展开
  barQuartic: 'quarticOut' as const,          // 横向负荷快速冲出减速
  lineSmooth: 'cubicInOut' as const,          // 时间线平滑绘制
  radarSmooth: 'cubicInOut' as const,         // 雷达平滑扫描
  compareBack: cubicBezier(0.34, 1.56, 0.64, 1),   // 优化对比：轻微过冲(backOut)
  tensionBack: cubicBezier(0.68, -0.55, 0.265, 1.55), // 三方案对比：先收后放(backInOut)
};

// 数字滚动动画
function CountUp({ value, decimals = 0, suffix = '', duration = 1400 }: { value: number; decimals?: number; suffix?: string; duration?: number }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(value * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return (
    <span>
      {display.toFixed(decimals)}
      {suffix}
    </span>
  );
}

// 从排产任务计算统计数据
function computeStats(tasks: ScheduledTaskDTO[]) {
  const machineLoad = new Map<string, number>();
  const machineSetup = new Map<string, number>();
  const procCount = { Drawing: 0, Stranding: 0, Roping: 0 } as Record<string, number>;
  const setupByProc = { Drawing: 0, Stranding: 0, Roping: 0 } as Record<string, number>;
  const orderEnd = new Map<string, number>();
  for (const t of tasks) {
    machineLoad.set(t.machine_id, (machineLoad.get(t.machine_id) ?? 0) + t.duration_minutes);
    if (t.setup_time > 0) machineSetup.set(t.machine_id, (machineSetup.get(t.machine_id) ?? 0) + 1);
    procCount[t.process_type]++;
    if (t.setup_time > 0) setupByProc[t.process_type]++;
    if (t.process_type === 'Roping') orderEnd.set(t.order_id, t.end_time);
  }
  return {
    loadRank: Array.from(machineLoad.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8),
    setupRank: Array.from(machineSetup.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8),
    procCount,
    setupByProc,
    finishTimes: Array.from(orderEnd.values()).sort((a, b) => a - b),
  };
}

const SLIDE_COUNT = 6;

export function Presentation({ onExit }: { onExit: () => void }) {
  const [current, setCurrent] = useState(0);
  const [kpi, setKpi] = useState<ScheduleAPIResponse | null>(null);
  const [sim, setSim] = useState<SimulationResponse | null>(null);

  useEffect(() => {
    fetchSchedule().then(setKpi).catch(console.error);
    simulateDisruption({ type: 'MACHINE_BREAKDOWN', machine_id: '8301', start_time: 0, duration_min: 360 }, 50)
      .then(setSim)
      .catch(console.error);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') setCurrent((c) => Math.min(c + 1, SLIDE_COUNT - 1));
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') setCurrent((c) => Math.max(c - 1, 0));
      if (e.key === 'Escape') onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onExit]);

  const stats = useMemo(() => (kpi ? computeStats(kpi.scheduled_tasks) : null), [kpi]);

  const go = (d: number) => setCurrent((c) => Math.min(SLIDE_COUNT - 1, Math.max(0, c + d)));

  const slides = [
    <SlideCover key="cover" />,
    <SlideProblem key="problem" />,
    <SlideKPI key="kpi" kpi={kpi} stats={stats} />,
    <SlideOptimization key="opt" stats={stats} />,
    <SlideReschedule key="resched" sim={sim} />,
    <SlideClose key="close" />,
  ];

  return (
    <div className="presentation">
      <button className="present-exit" onClick={onExit}>
        <Icon name="x" size={18} />
        退出演示
      </button>
      <div className="present-viewport" key={current}>
        {slides[current]}
      </div>

      <div className="present-nav">
        <button className="present-arrow" onClick={() => go(-1)} disabled={current === 0}>
          <Icon name="arrow-right" size={20} style={{ transform: 'rotate(180deg)' }} />
        </button>
        <div className="present-dots">
          {Array.from({ length: SLIDE_COUNT }).map((_, i) => (
            <button key={i} className={`present-dot${i === current ? ' active' : ''}`} onClick={() => setCurrent(i)} />
          ))}
        </div>
        <button className="present-arrow" onClick={() => go(1)} disabled={current === SLIDE_COUNT - 1}>
          <Icon name="arrow-right" size={20} />
        </button>
      </div>
      <div className="present-hint">← → 键切换 · 共 {SLIDE_COUNT} 幕</div>
    </div>
  );
}

/* ---- 幕 1 封面 ---- */
function SlideCover() {
  return (
    <section className="present-slide cover">
      <div className="cover-glow" />
      <div className="fade-up" style={{ animationDelay: '0.1s' }}>
        <div className="cover-logo">
          <Icon name="factory" size={30} color={C.cyan} />
          SHENGHU <span style={{ color: C.cyan }}>SmartPlan</span>
        </div>
      </div>
      <h1 className="fade-up" style={{ animationDelay: '0.3s' }}>从自动排产，到动态决策</h1>
      <p className="fade-up cover-sub" style={{ animationDelay: '0.5s' }}>
        面向钢丝绳多工序制造的智能排产系统 · 运筹优化 × 可解释 AI
      </p>
      <div className="fade-up cover-tags" style={{ animationDelay: '0.7s' }}>
        {['CP-SAT 精确求解', '最小扰动重排', 'R1-R10 可解释', '人工决策闭环'].map((t) => (
          <span key={t} className="cover-tag">{t}</span>
        ))}
      </div>
    </section>
  );
}

/* ---- 幕 2 问题 ---- */
function SlideProblem() {
  const pains: Array<{ icon: IconName; title: string; desc: string; color: string }> = [
    { icon: 'alert', title: '交期延误', desc: '订单多、工序长，人工排产难保证交期', color: C.red },
    { icon: 'chart', title: '设备忙闲不均', desc: '部分设备过载、部分闲置，产能浪费', color: C.orange },
    { icon: 'zap', title: '插单打乱计划', desc: '异常与插单频繁，一改全盘乱', color: C.blue },
  ];
  return (
    <section className="present-slide">
      <div className="fade-up">
        <div className="slide-kicker">01 · 问题</div>
        <h2 className="slide-title">从订单到机台，难在三个痛点</h2>
      </div>
      <div className="pain-grid">
        {pains.map((p, i) => (
          <div key={p.title} className="pain-card fade-up" style={{ animationDelay: `${0.2 + i * 0.15}s` }}>
            <Icon name={p.icon} size={28} color={p.color} />
            <h3>{p.title}</h3>
            <p>{p.desc}</p>
          </div>
        ))}
      </div>
      <div className="fade-up arch-row" style={{ animationDelay: '0.7s' }}>
        <div className="arch-node">订单数据</div>
        <Icon name="arrow-right" size={18} color={C.text2} />
        <div className="arch-node arch-core">CP-SAT 优化求解</div>
        <Icon name="arrow-right" size={18} color={C.text2} />
        <div className="arch-node">排产计划</div>
        <Icon name="arrow-right" size={18} color={C.text2} />
        <div className="arch-node arch-ai">AI 解释</div>
      </div>
      <p className="fade-up slide-foot" style={{ animationDelay: '0.9s' }}>
        核心架构：<strong>算控分离</strong> —— 运筹优化负责计算，AI 只做意图识别与解释，不碰数学。
      </p>
    </section>
  );
}

/* ---- 幕 3 自动排产 KPI ---- */
function SlideKPI({ kpi, stats }: { kpi: ScheduleAPIResponse | null; stats: ReturnType<typeof computeStats> | null }) {
  const byProc = useMemo(() => {
    if (!kpi) return [];
    return Object.entries(kpi.kpis.utilization_by_process).map(([k, v]) => ({ name: PROC_CN[k] ?? k, value: +(v * 100).toFixed(1) }));
  }, [kpi]);

  const utilOption: EChartsOption = useMemo(() => ({
    animationDuration: 1200,
    animationEasing: EASE.barBounce,
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 40, right: 20, top: 30, bottom: 30 },
    xAxis: { type: 'category', data: byProc.map((d) => d.name), axisLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.text2 } },
    yAxis: { type: 'value', max: 100, axisLabel: { color: C.text2, formatter: '{value}%' }, splitLine: { lineStyle: { color: C.grid } } },
    series: [{
      type: 'bar',
      data: byProc.map((d) => d.value),
      barWidth: 44,
      itemStyle: { borderRadius: [8, 8, 0, 0], color: (p: { dataIndex: number }) => [C.green, C.blue, C.purple][p.dataIndex % 3] },
      label: { show: true, position: 'top', color: C.text, fontWeight: 600, formatter: '{c}%' },
    }],
  }), [byProc]);

  const donutOption: EChartsOption = useMemo(() => ({
    animationDuration: 1200,
    animationEasing: EASE.pieElastic,
    tooltip: { trigger: 'item', formatter: '{b}: {c} 个 ({d}%)' },
    legend: { bottom: 0, textStyle: { color: C.text2 } },
    series: [{
      type: 'pie',
      radius: ['45%', '70%'],
      itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
      label: { color: C.text, fontWeight: 600 },
      data: [
        { name: '拉丝', value: stats?.procCount.Drawing ?? 0, itemStyle: { color: C.green } },
        { name: '捻股', value: stats?.procCount.Stranding ?? 0, itemStyle: { color: C.blue } },
        { name: '合绳', value: stats?.procCount.Roping ?? 0, itemStyle: { color: C.purple } },
      ],
    }],
  }), [stats]);

  const loadOption: EChartsOption = useMemo(() => {
    const rank = stats?.loadRank ?? [];
    return {
      animationDuration: 1200,
      animationEasing: EASE.barQuartic,
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: 60, right: 40, top: 10, bottom: 30 },
      xAxis: { type: 'value', axisLabel: { color: C.text2, formatter: (v: unknown) => (Number(v) / 60).toFixed(0) + 'h' }, splitLine: { lineStyle: { color: C.grid } } },
      yAxis: { type: 'category', data: rank.map((r) => r[0]), axisLabel: { color: C.text }, inverse: true },
      series: [{
        type: 'bar',
        data: rank.map((r) => r[1]),
        barWidth: 16,
        itemStyle: { color: C.cyan, borderRadius: [0, 6, 6, 0] },
        label: { show: true, position: 'right', color: C.text2, formatter: (p: unknown) => (Number((p as { value: number }).value) / 60).toFixed(1) + 'h' },
      }],
    };
  }, [stats]);

  const finishOption: EChartsOption = useMemo(() => {
    const times = stats?.finishTimes ?? [];
    return {
      animationDuration: 1600,
      animationEasing: EASE.lineSmooth,
      tooltip: { trigger: 'axis' },
      grid: { left: 50, right: 20, top: 20, bottom: 30 },
      xAxis: { type: 'category', data: times.map((_, i) => i + 1), name: '订单序', axisLabel: { color: C.text2 }, axisLine: { lineStyle: { color: C.grid } } },
      yAxis: { type: 'value', axisLabel: { color: C.text2, formatter: (v: unknown) => (Number(v) / 1440).toFixed(0) + 'd' }, splitLine: { lineStyle: { color: C.grid } } },
      series: [{
        type: 'line',
        data: times,
        smooth: true,
        lineStyle: { color: C.orange, width: 3 },
        itemStyle: { color: C.orange },
        areaStyle: { color: 'rgba(255,149,0,0.12)' },
      }],
    };
  }, [stats]);

  const kpiItems = [
    { label: '准时交付率', value: kpi ? kpi.kpis.otd * 100 : 0, decimals: 1, suffix: '%', color: C.green },
    { label: '活跃设备利用率', value: kpi ? kpi.kpis.utilization * 100 : 0, decimals: 1, suffix: '%', color: C.cyan },
    { label: '总换型次数', value: kpi ? kpi.kpis.total_setup_count : 0, decimals: 0, suffix: ' 次', color: C.yellow },
    { label: '延期订单', value: kpi ? kpi.kpis.tardy_orders : 0, decimals: 0, suffix: ' 单', color: C.red },
  ];

  return (
    <section className="present-slide">
      <div className="fade-up">
        <div className="slide-kicker">02 · 自动排产</div>
        <h2 className="slide-title">一次求解，交期优先</h2>
      </div>
      <div className="kpi-grid">
        {kpiItems.map((k, i) => (
          <div key={k.label} className="present-kpi fade-up" style={{ animationDelay: `${0.15 + i * 0.1}s` }}>
            <div className="present-kpi-label">{k.label}</div>
            <div className="present-kpi-value" style={{ color: k.color }}>
              <CountUp value={k.value} decimals={k.decimals} suffix={k.suffix} />
            </div>
          </div>
        ))}
      </div>
      <div className="kpi-charts">
        <div className="chart-card fade-up" style={{ animationDelay: '0.55s' }}>
          <div className="chart-title">三工序设备利用率</div>
          <EChart option={utilOption} height={240} />
        </div>
        <div className="chart-card fade-up" style={{ animationDelay: '0.65s' }}>
          <div className="chart-title">三工序任务占比</div>
          <EChart option={donutOption} height={240} />
        </div>
        <div className="chart-card fade-up" style={{ animationDelay: '0.75s' }}>
          <div className="chart-title">设备加工负荷 Top 8</div>
          <EChart option={loadOption} height={240} />
        </div>
        <div className="chart-card fade-up" style={{ animationDelay: '0.85s' }}>
          <div className="chart-title">订单完工时间线</div>
          <EChart option={finishOption} height={240} />
        </div>
      </div>
    </section>
  );
}

/* ---- 幕 4 优化效果 ---- */
function SlideOptimization({ stats }: { stats: ReturnType<typeof computeStats> | null }) {
  const rows = [
    { label: '换型弧（全连接 → 稀疏图）', before: '113 万条', after: '3.4 万条', pct: 97 },
    { label: '模型构建时间', before: '25 秒', after: '1 秒', pct: 96 },
    { label: '全量求解状态', before: '超时无解', after: '15 秒 FEASIBLE', pct: 100 },
  ];

  const compareOption: EChartsOption = {
    animationDuration: 1400,
    animationEasing: EASE.compareBack,
    tooltip: {},
    grid: { left: 120, right: 30, top: 30, bottom: 30 },
    xAxis: { type: 'value', splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.text2 } },
    yAxis: { type: 'category', data: rows.map((r) => r.label), axisLabel: { color: C.text, width: 140, overflow: 'truncate' } },
    series: [
      { name: '优化前', type: 'bar', data: [1130000, 25, 0], barWidth: 16, itemStyle: { color: '#d1d1d6', borderRadius: [0, 6, 6, 0] } },
      { name: '优化后', type: 'bar', data: [34000, 1, 15], barWidth: 16, itemStyle: { color: C.cyan, borderRadius: [0, 6, 6, 0] } },
    ],
    legend: { top: 0, textStyle: { color: C.text2 } },
  };

  const setupOption: EChartsOption = useMemo(() => {
    const sb = stats?.setupByProc ?? { Drawing: 0, Stranding: 0, Roping: 0 };
    const names = ['拉丝', '捻股', '合绳'];
    return {
      animationDuration: 1400,
      animationEasing: EASE.barQuartic,
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: 40, right: 20, top: 30, bottom: 30 },
      xAxis: { type: 'category', data: names, axisLabel: { color: C.text }, axisLine: { lineStyle: { color: C.grid } } },
      yAxis: { type: 'value', axisLabel: { color: C.text2 }, splitLine: { lineStyle: { color: C.grid } } },
      series: [{
        type: 'bar',
        data: [sb.Drawing, sb.Stranding, sb.Roping],
        barWidth: 48,
        itemStyle: { color: (p: { dataIndex: number }) => [C.green, C.blue, C.purple][p.dataIndex % 3], borderRadius: [8, 8, 0, 0] },
        label: { show: true, position: 'top', color: C.text, fontWeight: 600, formatter: '{c} 次' },
      }],
    };
  }, [stats]);

  return (
    <section className="present-slide">
      <div className="fade-up">
        <div className="slide-kicker">03 · 优化</div>
        <h2 className="slide-title">稀疏图剪枝 + 负载均衡，让求解可行</h2>
      </div>
      <div className="opt-charts">
        <div className="chart-card fade-up" style={{ animationDelay: '0.2s' }}>
          <div className="chart-title">优化前后对比</div>
          <EChart option={compareOption} height={300} />
        </div>
        <div className="chart-card fade-up" style={{ animationDelay: '0.32s' }}>
          <div className="chart-title">各工序换型次数分布</div>
          <EChart option={setupOption} height={300} />
        </div>
      </div>
      <div className="opt-grid">
        {rows.map((r, i) => (
          <div key={r.label} className="opt-card fade-up" style={{ animationDelay: `${0.45 + i * 0.12}s` }}>
            <div className="opt-pct"><CountUp value={r.pct} suffix="%" /></div>
            <div className="opt-label">{r.label}</div>
            <div className="opt-detail">{r.before} → <strong>{r.after}</strong></div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---- 幕 5 动态重排 ---- */
function SlideReschedule({ sim }: { sim: SimulationResponse | null }) {
  const scenarios = sim?.scenarios ?? [];
  const names = scenarios.map((s) => s.name);
  const pert = scenarios.map((s) => s.total_perturbation_min);
  const disrupted = scenarios.map((s) => s.disrupted_tasks);

  const barOption: EChartsOption = useMemo(() => ({
    animationDuration: 1400,
    animationEasing: EASE.tensionBack,
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 40, right: 20, top: 30, bottom: 30 },
    xAxis: { type: 'category', data: names, axisLabel: { color: C.text }, axisLine: { lineStyle: { color: C.grid } } },
    yAxis: { type: 'value', axisLabel: { color: C.text2 }, splitLine: { lineStyle: { color: C.grid } } },
    series: [
      { name: '扰动时长(分)', type: 'bar', data: pert, barWidth: 34, itemStyle: { color: (p: { dataIndex: number }) => [C.blue, C.green, C.orange][p.dataIndex % 3], borderRadius: [8, 8, 0, 0] }, label: { show: true, position: 'top', color: C.text, fontWeight: 600 } },
      { name: '重排任务数', type: 'bar', data: disrupted, barWidth: 34, itemStyle: { color: 'rgba(0,0,0,0.12)', borderRadius: [8, 8, 0, 0] } },
    ],
    legend: { top: 0, textStyle: { color: C.text2 } },
  }), [names, pert, disrupted]);

  const radarOption: EChartsOption = useMemo(() => {
    const maxPert = Math.max(...pert, 1);
    const maxDisrupted = Math.max(...disrupted, 1);
    return {
      animationDuration: 1400,
      animationEasing: EASE.radarSmooth,
      tooltip: {},
      radar: {
        indicator: [
          { name: '准时交付率', max: 1 },
          { name: '少扰动', max: 1 },
          { name: '重排少', max: 1 },
        ],
        radius: '70%',
        axisName: { color: C.text2 },
        splitLine: { lineStyle: { color: C.grid } },
        splitArea: { areaStyle: { color: ['rgba(0,0,0,0.02)', 'rgba(0,0,0,0.04)'] } },
      },
      series: [{
        type: 'radar',
        data: scenarios.map((s, i) => ({
          name: s.name,
          value: [s.otd, 1 - s.total_perturbation_min / maxPert, 1 - s.disrupted_tasks / maxDisrupted],
          lineStyle: { color: [C.blue, C.green, C.orange][i % 3] },
          itemStyle: { color: [C.blue, C.green, C.orange][i % 3] },
          areaStyle: { opacity: 0.12 },
        })),
      }],
      legend: { bottom: 0, textStyle: { color: C.text2 } },
    };
  }, [scenarios, pert, disrupted]);

  return (
    <section className="present-slide">
      <div className="fade-up">
        <div className="slide-kicker">04 · 动态重排</div>
        <h2 className="slide-title">异常发生，三套方案可选</h2>
      </div>
      {scenarios.length === 0 ? (
        <p className="fade-up slide-foot">正在加载三方案推演数据…</p>
      ) : (
        <div className="resched-grid">
          <div className="chart-card fade-up" style={{ animationDelay: '0.2s' }}>
            <div className="chart-title">三方案扰动对比</div>
            <EChart option={barOption} height={300} />
          </div>
          <div className="chart-card fade-up" style={{ animationDelay: '0.35s' }}>
            <div className="chart-title">三方案能力雷达</div>
            <EChart option={radarOption} height={300} />
          </div>
        </div>
      )}
      <p className="fade-up slide-foot" style={{ animationDelay: '0.5s' }}>
        <strong>方案 B 少扰动</strong>：扰动最小、维持车间秩序；<strong>方案 C 高效率</strong>：大调换效率。系统量化后果，<strong>由人确认</strong>。
      </p>
    </section>
  );
}

/* ---- 幕 6 闭环 ---- */
function SlideClose() {
  const steps = ['自动排产', '风险发现', '原因解释', '异常重排', '多方案推演', '人工确认'];
  const icons: IconName[] = ['factory', 'alert', 'search', 'zap', 'chart', 'check'];
  return (
    <section className="present-slide">
      <div className="fade-up">
        <div className="slide-kicker">05 · 闭环</div>
        <h2 className="slide-title">算得准 · 讲得清 · 改得动 · 人能控</h2>
      </div>
      <div className="close-ring fade-up" style={{ animationDelay: '0.3s' }}>
        <div className="close-ring-dash" />
        <div className="close-center">
          <Icon name="sparkles" size={38} color="#fff" />
          <span>智能决策闭环</span>
        </div>
        {steps.map((s, i) => {
          const angle = i * 60 - 90;
          return (
            <div key={s} className="close-item" style={{ transform: `rotate(${angle}deg) translate(200px) rotate(${-angle}deg)` }}>
              <span className="close-item-num">{i + 1}</span>
              <Icon name={icons[i]} size={28} color={C.cyan} />
              <span className="close-item-label">{s}</span>
            </div>
          );
        })}
      </div>
      <p className="fade-up slide-foot" style={{ animationDelay: '0.8s' }}>
        不是替你排，而是帮你做出更好的生产计划。
      </p>
    </section>
  );
}
