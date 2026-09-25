# ==================================================
# Escort 示範站 — Docker 映像
# 適用於支援容器部署的平台（Fly.io、Koyeb、Render Docker 等）
# 本專案零依賴，因此不需要 npm install
# ==================================================
FROM node:20-alpine

# 時區設為台灣，讓後台的「更新時間」顯示正確
ENV TZ=Asia/Taipei
RUN apk add --no-cache tzdata && \
    cp /usr/share/zoneinfo/Asia/Taipei /etc/localtime && \
    echo "Asia/Taipei" > /etc/timezone

WORKDIR /app

# 只複製執行所需的檔案（資料與上傳檔刻意不進映像，由平台在執行時產生）
COPY server.js package.json ./
COPY index.html detail.html guide.html admin.html ./
COPY css ./css
COPY js ./js

# 資料與上傳檔的預設位置（掛載持久化磁碟時用 DATA_DIR / UPLOAD_DIR 覆寫）
RUN mkdir -p /app/data /app/uploads

# 以非 root 使用者執行（安全性）
RUN chown -R node:node /app
USER node

ENV NODE_ENV=production
# 平台通常會自行指定 PORT，這裡提供預設值
ENV PORT=3000
EXPOSE 3000

# 健康檢查（Render / Fly.io 也可用 HTTP 檢查 /api/health）
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]