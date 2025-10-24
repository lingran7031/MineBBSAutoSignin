#!/bin/sh

export TZ=Asia/Shanghai

# 复制时区文件
cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime

# 显示配置信息用于调试
echo "时区设置: $TZ"
echo "时区文件已复制"
echo "当前时间: $(date)"
echo "时区: $(date +%Z)"

# 执行时间同步（可选）
echo "正在同步时间..."
busybox ntpd -q -p time1.aliyun.com 2>/dev/null || echo "NTP同步失败，使用系统时间"

# 再次显示时间
echo "最终时间: $(date)"

# 启动应用
npm start