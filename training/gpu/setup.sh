#!/usr/bin/env bash
# 在 CUDA 机器上运行（Ubuntu + NVIDIA 驱动 + Python 3.12）
set -euo pipefail
cd "$(dirname "$0")/../.."
python3 -m venv training/.venv
source training/.venv/bin/activate
pip install --upgrade pip
# 按 CUDA 版本选择；CUDA 12.x 一般用 cu121/cu124
pip install torch --index-url https://download.pytorch.org/whl/cu124
pip install -r training/requirements.txt
python - <<'PY'
import torch
print('torch', torch.__version__, 'cuda', torch.cuda.is_available())
if torch.cuda.is_available():
    print('gpu', torch.cuda.get_device_name(0))
PY
