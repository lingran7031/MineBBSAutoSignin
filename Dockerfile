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

# 启动应用
CMD ["npm", "start"]