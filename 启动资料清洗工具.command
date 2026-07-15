#!/bin/zsh

set -e

cd "$(dirname "$0")"

echo "正在检查 Node.js 环境..."
if ! command -v node >/dev/null 2>&1; then
  echo "未检测到 Node.js。请先安装 Node.js LTS 版本：https://nodejs.org/"
  echo "安装完成后，再双击本文件启动。"
  read -k 1 "?按任意键退出..."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "未检测到 npm。请确认 Node.js 是否安装完整。"
  read -k 1 "?按任意键退出..."
  exit 1
fi

if [ ! -f ".env" ]; then
  echo "未发现 .env，正在从 .env.example 创建..."
  cp ".env.example" ".env"
  echo "请先打开 .env，填写 API_KEY，然后重新双击本文件。"
  open -a TextEdit ".env" || true
  read -k 1 "?按任意键退出..."
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "未发现依赖环境，正在安装依赖..."
  npm install --cache "./.npm-cache"
else
  echo "依赖环境已存在。"
fi

PORT_VALUE=$(grep -E "^PORT=" ".env" | tail -n 1 | cut -d "=" -f 2)
if [ -z "$PORT_VALUE" ]; then
  PORT_VALUE=3000
fi

URL="http://localhost:${PORT_VALUE}"

echo "正在启动本地服务：${URL}"
(sleep 2 && open "$URL") &
npm start
