import { useScheduleStore } from '../../store/useScheduleStore';

/**
 * 已产/待产分布图（3D 车间看板右上角 HUD 卡片）。
 * 数据来自后端排产响应的 order_summary：以全部输入订单为分母，
 * 按实际排出工序数三分类，非伪数据。
 */
export function OrderScheduleDistCard() {
  const orderSummary = useScheduleStore((s) => s.orderSummary);

  if (!orderSummary) return null;

  const rows = [
    { key: 'partial', label: '部分任务排产', value: orderSummary.partially_scheduled },
    { key: 'full', label: '已生产', value: orderSummary.fully_scheduled },
    { key: 'unscheduled', label: '待生产', value: orderSummary.unscheduled },
  ];
  // 条形宽度按最大值归一化，0 时显示占位符「-」
  const maxValue = Math.max(1, ...rows.map((r) => r.value));

  return (
    <div className="ws-hud ws-hud-dist">
      <div className="ws-dist-title">已产/待产分布图</div>
      <div className="ws-dist-list">
        {rows.map((r) => (
          <div className="ws-dist-row" key={r.key}>
            <span className="ws-dist-label">{r.label}</span>
            <span className="ws-dist-track">
              {r.value > 0 ? (
                <span
                  className="ws-dist-bar"
                  style={{ width: `${Math.max(4, (r.value / maxValue) * 100)}%` }}
                />
              ) : (
                <span className="ws-dist-empty">-</span>
              )}
            </span>
            <span className="ws-dist-num">{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
