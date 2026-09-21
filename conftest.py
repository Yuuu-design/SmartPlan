"""确保测试时 src 包可被导入。"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
