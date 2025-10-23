# 使用Node.js官方镜像作为基础镜像
FROM node:16-alpine

# 设置工作目录
WORKDIR /app

# 复制package.json和package-lock.json文件
COPY package*.json ./

# 安装依赖
RUN npm install --production

# 复制所有文件到工作目录
COPY . .

# 设置环境变量
ENV NODE_ENV=production

# 暴露应用端口（假设应用使用3000端口）
EXPOSE 3000

# 创建启动脚本 - 使用busybox自带的ntpd功能进行时间同步
RUN echo '#!/bin/sh\n\n# 执行时间同步（使用busybox的ntpd）\necho "正在同步系统时间..."\nbusybox ntpd -q -p time1.aliyun.com\n\n# 启动应用\necho "启动应用程序..."\nnpm start' > /app/start.sh && \
    chmod +x /app/start.sh

# 使用启动脚本启动容器
CMD ["/app/start.sh"]