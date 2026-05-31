# Windows 安装指南（使用 Qwen TTS）

本文档说明如何在 Windows 上安装并运行 Podcast Reader 桌面应用，TTS 引擎使用 Qwen（而不是 macOS 默认的 Kokoro）。Qwen 需要 NVIDIA CUDA GPU，没有 CPU 兜底。

## 1. 前置条件

| 项 | 要求 |
| --- | --- |
| 操作系统 | Windows 10 / 11 x64 |
| 显卡 | NVIDIA CUDA 兼容 GPU（驱动版本支持 CUDA 12.1+） |
| 显存 | 建议 ≥ 8 GB |
| 网络 | 安装依赖时需要 |
| 磁盘 | ≥ 10 GB 空闲（含 Qwen 权重） |

确认显卡可用：
```powershell
nvidia-smi
```
若命令未识别，先安装最新 NVIDIA 驱动。

## 2. 安装开发工具

按顺序安装：

1. **Visual Studio 2022 Build Tools** —— 勾选 *"使用 C++ 的桌面开发"* 工作负载。Tauri 的 Rust 编译需要 MSVC 链接器。
2. **WebView2 运行时** —— Windows 11 已自带；Windows 10 请从微软官网下载 *Evergreen Bootstrapper*。
3. **Rust（stable）**
   ```powershell
   winget install Rustlang.Rustup
   rustup default stable
   ```
4. **Node.js 20+ 与 pnpm 10+**
   ```powershell
   winget install OpenJS.NodeJS.LTS
   npm install -g pnpm@10
   ```
5. **Python 3.12**
   ```powershell
   winget install Python.Python.3.12
   ```
6. **Git 与 Git LFS**
   ```powershell
   winget install Git.Git
   git lfs install
   ```

## 3. 克隆代码库

```powershell
git clone https://github.com/cassiarota/podcast.git
cd podcast
git lfs pull   # Windows 不强制需要 Kokoro 权重，但 LFS 拉取无副作用
```

## 4. 放置 Qwen 模型（关键步骤）

应用通过**绝对路径**加载 Qwen 模型，路径硬编码在 `desktop/sidecar/engine_qwen.py`：

```
D:\models\Qwen3-TTS-12Hz-1.7B-CustomVoice
D:\models\Qwen3-TTS-Tokenizer-12Hz
```

请确保上述两个目录存在且包含完整模型文件。如果你的盘符不是 `D:`，请：
- 将模型放在 D 盘对应位置，或
- 修改 `desktop/sidecar/engine_qwen.py` 中的 `MODEL_DIR` 和 `TOKENIZER_DIR`，重新构建。

**不要**把 Qwen 权重拷贝到本仓库目录里 —— 安装包不打包权重，运行时按路径读取。

## 5. 创建 Python TTS 服务环境

```powershell
cd desktop\sidecar
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
```

安装依赖（**注意 PyTorch 必须用 CUDA 版本**）：

```powershell
pip install --upgrade pip
pip install --index-url https://download.pytorch.org/whl/cu121 torch
pip install -r ..\..\windows\sidecar-env\requirements.txt
```

或者直接运行已经写好的脚本：

```powershell
cd ..\..\windows\sidecar-env
.\activate.ps1
```

验证 CUDA 在 Python 端可用：
```powershell
python -c "import torch; print('cuda:', torch.cuda.is_available()); print('device:', torch.cuda.get_device_name(0))"
```
应输出 `cuda: True` 和你的显卡名称。

## 6. 安装前端依赖

```powershell
cd ..\..\desktop
pnpm install
```

## 7. 开发模式运行

```powershell
cd desktop
pnpm tauri dev
```

首次启动会编译 Rust 后端，约 3–5 分钟。窗口打开后：

- 主界面是一个空书架。点击 **+ Import a book** 导入 `.txt` 或 `.epub` 文件。
- 进入阅读页后，**点击页面中部**显示底部控制栏；**左/右** 三分之一区域翻页。
- 点击控制栏的 **▶ Play** —— 此时（**只有**此时）Tauri 会启动 Python TTS 子进程并懒加载 Qwen 模型。

打开任务管理器，应当看到一个 `python.exe` 是 Tauri 应用的子进程。

## 8. 验证清单

逐项确认（也是 `windows/README.md` 中的英文清单）：

- [ ] 应用启动后，任务管理器**没有** `python.exe` 进程。证明启动时不加载模型。
- [ ] 点击播放后，`python.exe` 出现。
- [ ] 第一次合成时 VRAM 跳升一次（Qwen 加载）；之后调用很快。
- [ ] 同一页第二次播放：瞬间播放，无新音频生成，文件来自 `%APPDATA%\com.podcast.reader\audio_cache\`。
- [ ] 把 `D:\models\Qwen3-TTS-12Hz-1.7B-CustomVoice` 暂时改名 → 应用应返回 `model_path_missing` 错误并展示具体路径。
- [ ] 在无 CUDA 的机器上 → 应用应返回 `cuda_missing`。
- [ ] 闲置 60 秒后，子进程日志输出 `unloaded`，VRAM 回落。

## 9. 打包安装程序（MSI）

```powershell
cd desktop
pnpm tauri build --target x86_64-pc-windows-msvc
```

输出位置：
```
desktop\src-tauri\target\release\bundle\msi\Podcast Reader_0.1.0_x64_en-US.msi
```

MSI 包含应用本体和 Python 子进程启动脚本，**不**包含 Qwen 权重。在干净的 Windows 虚拟机上安装后，必须在该机器的 `D:\models\` 下放置 Qwen 模型，否则首次播放会报 `model_path_missing`。

## 10. 常见问题

### `cuda_missing`
- 检查 `nvidia-smi` 是否能识别显卡。
- 在 venv 内运行：
  ```powershell
  python -c "import torch; print(torch.cuda.is_available())"
  ```
  若为 `False`，说明安装的是 CPU 版 PyTorch。卸载后重装：
  ```powershell
  pip uninstall -y torch
  pip install --index-url https://download.pytorch.org/whl/cu121 torch
  ```

### `model_path_missing`
错误体里会附带具体缺失的路径列表。确认两个目录都存在：
```powershell
Test-Path D:\models\Qwen3-TTS-12Hz-1.7B-CustomVoice
Test-Path D:\models\Qwen3-TTS-Tokenizer-12Hz
```

### `torch_not_installed` / `qwen_tts_not_installed`
说明 Tauri 启动的 Python 解释器没在你创建的 venv 里。Rust 侧 `desktop/src-tauri/src/sidecar.rs` 的 `which_python` 函数优先选择 `desktop/sidecar/.venv\Scripts\python.exe`。确认该路径存在；若你把 venv 建在别处，请把 `.venv` 软链或复制到该位置。

### 子进程一直未就绪
查看 Tauri 控制台日志，搜索 `sidecar`。常见原因：
- 端口 `38219` 被占用 → 重启电脑或修改 `DEFAULT_PORT`。
- Python 进程启动后立刻退出 → 单独运行 `python desktop/sidecar/main.py --port 38219 --audio-cache .\cache --engine qwen` 查看真实报错。

### 没有 NVIDIA GPU 怎么办？
当前版本**不支持** Qwen 在 CPU 上运行。可以参考 `macos/README.md` 切换到 Kokoro 引擎（性能略低但 CPU 可跑）；不过这需要修改 `desktop/sidecar/engine_qwen.py` 或在 `sidecar.rs` 的 `engine_for_platform` 中把 Windows 也指向 Kokoro，并补充 Kokoro 的 Python 依赖。

## 相关文档

- `windows/README.md` —— 英文版构建说明与验证清单。
- `docs/reader-app-plan.md` —— 完整产品与技术方案。
- `desktop/sidecar/engine_qwen.py` —— Qwen 引擎实现，模型路径硬编码在此。
- `desktop/src-tauri/src/sidecar.rs` —— 子进程生命周期管理。
