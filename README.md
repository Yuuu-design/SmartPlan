# SmartPlan · 智能排产驾驶舱

基于 **OR-Tools CP-SAT** 的钢丝绳生产智能排产系统：FastAPI 后端负责约束建模与求解，React + Vite 前端提供甘特图、3D 车间看板与 AI 排产助手。

## 功能特性

- **CP-SAT 约束优化排产**：以总延期、最大延期、换型时间、Makespan 加权为目标，自动完成拉丝（Drawing）→ 捻股（Stranding）→ 合绳（Roping）工序排程与设备分配。
- **滚动排产**：支持按订单数上限求解近期订单（秒级响应），也可全量求解。
- **Excel / CSV 导入**：自动清洗空行空列、千分位数字与日期格式，脏数据行跳过后汇总反馈；可选上传自定义设备产能表。
- **异常注入与沙盘推演**：模拟设备故障、插单等扰动，生成多套重排方案并对比延期、换型、扰动任务数。
- **单订单改进**：针对延期订单给出专项优先 / 加班赶工 / 增开机台等改进方案。
- **可视化驾驶舱**：交互式甘特图（依赖连线、换型块、冲突检测）、KPI 指标下钻、ECharts 图表、Three.js 3D 车间看板。
- **AI Copilot**：DeepSeek Function Calling 做意图识别与方案路由，写操作需前端二次确认；未配置密钥时自动回退为离线规则模式。

## 技术栈

| 层 | 技术 |
| --- | --- |
 后端 | Python 3.12+、FastAPI、OR-Tools CP-SAT、pandas、openpyxl、uvicorn |
| 前端 | React 19、TypeScript、Vite、Zustand、ECharts、Three.js（@react-three/fiber）、xlsx |
| AI | OpenAI SDK 兼容 DeepSeek API（可选） |

## 目录结构

```
shenghu-smartplan/
├── src/                    # 后端
│   ├── api/v1/             # FastAPI 路由：schedule、copilot
│   ├── core/config.py      # 求解权重、参数、数据文件路径
│   ├── data/loader.py      # Excel 读取、校验与清洗
│   ├── scheduler/          # CP-SAT 建模、解码、换型矩阵、解释器
│   └── schemas/models.py   # Pydantic 模型
├── frontend/               # 前端
│   └── src/
│       ├── api/            # 后端接口封装
│       ├── components/     # 甘特图、3D 车间、驾驶舱面板
│       ├── store/          # Zustand 状态
│       └── pages/          # 答辩演示页
├── tests/                  # pytest 后端测试
├── requirements.txt
└── conftest.py
```

## 快速开始

### 1. 启动后端

需要 Python 3.12+。

```powershell
pip install -r requirements.txt
python -m uvicorn src.api.v1.schedule:app --host 0.0.0.0 --port 8000
```

**数据文件（二选一）：**

- 默认从项目上级目录读取 `../订单信息.xlsx` 与 `../产品额定（平均值）.xlsx`（相对项目根目录，即 `config.py` 中的 `CONFIG.order_file` / `CONFIG.capacity_file`，可自行修改路径）；
- 或不放置数据文件，启动后在前端「导入 Excel/CSV」弹窗中上传订单表，产能表留空则使用系统内置产能数据。
- 订单导入模板可从接口下载：`GET http://localhost:8000/api/v1/schedule/template/orders`。

**AI 助手（可选）：** 在项目根目录创建 `.env`：

```
DEEPSEEK_API_KEY=你的密钥
```

未配置时 Copilot 自动使用离线规则匹配，不影响排产核心功能。

### 2. 启动前端

需要 Node.js 20.19+（或 22.12+）。

```powershell
cd frontend
npm install
npm run dev
```

打开 http://localhost:5173 。Vite 已将 `/api` 代理到 `http://localhost:8000`，无需额外配置跨域。

## 接口一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/schedule/template/orders` | 下载订单导入模板（.xlsx） |
| POST | `/api/v1/schedule/run` | 执行排产（JSON 传 `limit_orders`，或 multipart 上传订单/产能文件） |
| POST | `/api/v1/schedule/simulate` | 异常注入沙盘推演，返回多套方案 |
| POST | `/api/v1/schedule/remediate` | 单个延期订单的改进方案 |
| POST | `/api/v1/copilot/chat` | AI 助手对话（Function Calling 路由） |

完整交互式文档见 http://localhost:8000/docs 。

## 测试

```powershell
# 后端
pytest

# 前端
cd frontend
npm test          # 单次运行
npm run test:watch
```

## 常用脚本（前端）

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动开发服务器（5173） |
| `npm run build` | 类型检查后构建生产包到 `dist/` |
| `npm run preview` | 本地预览生产构建 |
| `npm run typecheck` | 仅执行 TypeScript 类型检查 |
