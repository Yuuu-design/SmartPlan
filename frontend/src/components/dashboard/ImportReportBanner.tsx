import { useEffect, useState } from 'react';
import { useScheduleStore } from '../../store/useScheduleStore';
import { Icon } from '../Icon';

const DIRTY_PREVIEW = 5;

/** Excel/CSV 导入排产完成后，展示数据清洗摘要；普通刷新排产（无报告）时不渲染。 */
export function ImportReportBanner() {
  const report = useScheduleStore((s) => s.cleaningReport);
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // 新一次导入（报告变化）时恢复展开/关闭状态
  useEffect(() => {
    setExpanded(false);
    setDismissed(false);
  }, [report]);

  if (!report || dismissed) return null;

  const droppedTotal =
    report.empty_rows_dropped + report.ended_skipped + report.duplicate_skipped + report.dirty_rows.length;
  const dirty = report.dirty_rows ?? [];
  const visible = expanded ? dirty : dirty.slice(0, DIRTY_PREVIEW);

  return (
    <div className="import-report" role="status">
      <div className="import-report-head">
        <Icon name="check" size={16} color="var(--green-bright, #34d399)" />
        <span className="import-report-title">
          导入完成：{report.file_name}
          {report.source_sheet ? `（工作表：${report.source_sheet}）` : ''}
        </span>
        <span className={`import-report-tag ${report.merged ? 'merge' : 'alone'}`}>
          {report.merged ? '已合并到当前甘特图时间线' : '仅排产上传订单'}
        </span>
        <button className="icon-btn" onClick={() => setDismissed(true)} aria-label="关闭导入报告">
          <Icon name="x" size={14} />
        </button>
      </div>

      <div className="import-report-stats">
        <span className="report-stat ok">
          <b>{report.valid_count}</b> 单有效
        </span>
        {report.merged && (
          <>
            <span className="report-stat add">
              <b>{report.added_order_ids.length}</b> 新增
            </span>
            <span className="report-stat upd">
              <b>{report.updated_order_ids.length}</b> 更新
            </span>
          </>
        )}
        <span className="report-stat">
          空行 <b>{report.empty_rows_dropped}</b>
        </span>
        <span className="report-stat">
          空列 <b>{report.empty_cols_dropped}</b>
        </span>
        <span className="report-stat">
          已结束 <b>{report.ended_skipped}</b>
        </span>
        <span className="report-stat">
          重复 <b>{report.duplicate_skipped}</b>
        </span>
        <span className={`report-stat ${dirty.length > 0 ? 'warn' : ''}`}>
          脏数据 <b>{dirty.length}</b>
        </span>
        <span className="report-stat-sub">共解析 {report.total_rows} 行，剔除 {droppedTotal} 行</span>
      </div>

      {dirty.length > 0 && (
        <div className="import-report-dirty">
          {visible.map((d, i) => (
            <div className="dirty-row" key={`${d.row}-${i}`}>
              <span className="dirty-row-no">第 {d.row} 行</span>
              {d.order_id ? <span className="dirty-order-id">{d.order_id}</span> : null}
              <span className="dirty-reason">{d.reason}</span>
            </div>
          ))}
          {dirty.length > DIRTY_PREVIEW && (
            <button className="dirty-toggle" onClick={() => setExpanded((v) => !v)}>
              {expanded ? '收起' : `展开全部 ${dirty.length} 条脏数据`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
