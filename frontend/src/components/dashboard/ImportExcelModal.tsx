import { useEffect, useRef, useState } from 'react';
import { Icon } from '../Icon';
import { fetchScheduleWithFiles } from '../../api/scheduleApi';
import type { ScheduleAPIResponse } from '../../types/schedule';

interface ImportExcelModalProps {
  open: boolean;
  onClose: () => void;
  /** 执行排产请求；成功后由弹窗关闭，失败时 reject 以展示行级错误。 */
  onRun: (fetcher: () => Promise<ScheduleAPIResponse>) => Promise<void>;
}

const MAX_SIZE_MB = 10;
const ORDER_SUFFIXES = ['.xlsx', '.xlsm', '.csv'];

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function validateOrderFile(file: File): string | null {
  const name = file.name.toLowerCase();
  if (!ORDER_SUFFIXES.some((s) => name.endsWith(s))) {
    return '仅支持 .xlsx / .csv 格式（.xls 请先用 Excel 另存为 .xlsx）';
  }
  if (file.size > MAX_SIZE_MB * 1024 * 1024) return `文件超过 ${MAX_SIZE_MB}MB，请拆分后再导入`;
  if (file.size === 0) return '文件内容为空';
  return null;
}

function validateCapacityFile(file: File): string | null {
  if (!file.name.toLowerCase().endsWith('.xlsx')) return '产能表仅支持 .xlsx 格式';
  if (file.size > MAX_SIZE_MB * 1024 * 1024) return `文件超过 ${MAX_SIZE_MB}MB，请拆分后再导入`;
  if (file.size === 0) return '文件内容为空';
  return null;
}

export function ImportExcelModal({ open, onClose, onRun }: ImportExcelModalProps) {
  const [orderFile, setOrderFile] = useState<File | null>(null);
  const [capacityFile, setCapacityFile] = useState<File | null>(null);
  const [limitText, setLimitText] = useState('50');
  const [merge, setMerge] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const orderInputRef = useRef<HTMLInputElement>(null);
  const capacityInputRef = useRef<HTMLInputElement>(null);

  // 每次打开重置状态
  useEffect(() => {
    if (open) {
      setOrderFile(null);
      setCapacityFile(null);
      setLimitText('50');
      setMerge(true);
      setRunning(false);
      setError(null);
      setDragOver(false);
    }
  }, [open]);

  if (!open) return null;

  function pickOrder(file: File | null | undefined) {
    if (!file) return;
    const err = validateOrderFile(file);
    setError(err ? `订单文件：${err}` : null);
    setOrderFile(err ? null : file);
  }

  function pickCapacity(file: File | null | undefined) {
    if (!file) return;
    const err = validateCapacityFile(file);
    setError(err ? `产能文件：${err}` : null);
    setCapacityFile(err ? null : file);
  }

  async function handleSubmit() {
    if (!orderFile || running) return;
    const limit = limitText.trim() === '' ? null : Number(limitText);
    if (limit !== null && (!Number.isInteger(limit) || limit < 0)) {
      setError('订单数上限需为不小于 0 的整数（0 表示全部）');
      return;
    }
    setRunning(true);
    setError(null);
    try {
      await onRun(() => fetchScheduleWithFiles(orderFile, capacityFile, limit, merge));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '排产失败，请检查文件内容后重试');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div
      className="modal-mask"
      onClick={() => {
        if (!running) onClose();
      }}
    >
      <div className="import-modal" onClick={(e) => e.stopPropagation()}>
        <div className="import-modal-head">
          <span className="import-modal-title">
            <Icon name="upload" size={20} color="var(--accent)" />
            导入订单 Excel / CSV 智能排产
          </span>
          <button className="icon-btn" onClick={() => !running && onClose()} aria-label="关闭">
            <Icon name="x" size={18} />
          </button>
        </div>

        <div className="import-modal-body">
          {/* 步骤 1：订单文件 */}
          <div className="import-step">
            <div className="import-step-no">1</div>
            <div className="import-step-main">
              <div className="import-step-title">
                上传订单表 <span className="import-required">*.xlsx / *.csv</span>
              </div>
              <div
                className={`file-drop${dragOver ? ' drag' : ''}${orderFile ? ' picked' : ''}`}
                onClick={() => orderInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  pickOrder(e.dataTransfer.files?.[0]);
                }}
              >
                <input
                  ref={orderInputRef}
                  type="file"
                  accept=".xlsx,.xlsm,.csv"
                  hidden
                  onChange={(e) => pickOrder(e.target.files?.[0])}
                />
                {orderFile ? (
                  <span className="file-chip">
                    <Icon name="file" size={17} color="var(--accent)" />
                    <span className="file-chip-name" title={orderFile.name}>{orderFile.name}</span>
                    <span className="file-chip-size">{formatSize(orderFile.size)}</span>
                    <button
                      className="file-chip-x"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOrderFile(null);
                        if (orderInputRef.current) orderInputRef.current.value = '';
                      }}
                    >
                      <Icon name="x" size={14} />
                    </button>
                  </span>
                ) : (
                  <span className="file-drop-hint">
                    <Icon name="upload" size={22} color="var(--text-tertiary)" />
                    点击选择或把 .xlsx / .csv 拖到这里（≤ {MAX_SIZE_MB}MB）
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* 可选：产能表 */}
          <div className="import-step import-step-optional">
            <div className="import-step-no optional">2</div>
            <div className="import-step-main">
              <div className="import-step-title">
                设备产能表 <span className="import-optional-tag">可选</span>
              </div>
              <input
                ref={capacityInputRef}
                type="file"
                accept=".xlsx"
                hidden
                onChange={(e) => pickCapacity(e.target.files?.[0])}
              />
              {capacityFile ? (
                <span className="file-chip">
                  <Icon name="file" size={17} color="var(--accent)" />
                  <span className="file-chip-name" title={capacityFile.name}>{capacityFile.name}</span>
                  <span className="file-chip-size">{formatSize(capacityFile.size)}</span>
                  <button
                    className="file-chip-x"
                    onClick={() => {
                      setCapacityFile(null);
                      if (capacityInputRef.current) capacityInputRef.current.value = '';
                    }}
                  >
                    <Icon name="x" size={14} />
                  </button>
                </span>
              ) : (
                <button className="btn import-capacity-btn" onClick={() => capacityInputRef.current?.click()}>
                  <Icon name="file" size={16} />
                  选择产能表
                </button>
              )}
            </div>
          </div>

          <div className="import-divider" />

          {/* 选项 */}
          <div className="import-option-row">
            <label htmlFor="import-limit">订单数上限</label>
            <input
              id="import-limit"
              className="import-limit-input"
              value={limitText}
              onChange={(e) => setLimitText(e.target.value)}
              inputMode="numeric"
            />
          </div>

          <label className="import-merge-row" htmlFor="import-merge">
            <input
              id="import-merge"
              type="checkbox"
              checked={merge}
              onChange={(e) => setMerge(e.target.checked)}
            />
            <span className="import-merge-text">合并到当前甘特图时间线统一排产</span>
          </label>

          {error && (
            <div className="import-error">
              <Icon name="alert" size={17} color="var(--red-bright)" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="import-modal-foot">
          <button className="btn" onClick={() => !running && onClose()} disabled={running}>
            取消
          </button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={!orderFile || running}>
            {running ? (
              <>
                <span className="spinner spinner-sm" />
                CP-SAT 求解中…
              </>
            ) : (
              <>
                <Icon name="zap" size={16} />
                开始分析并排产
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
