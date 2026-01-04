FROM node:20-bullseye

RUN apt-get update && apt-get install -y \
    ffmpeg \
    curl \
 && rm -rf /var/lib/apt/lists/*

RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
  -o /usr/local/bin/yt-dlp \
 && chmod +x /usr/local/bin/yt-dlp

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

COPY . .
EXPOSE 8080
CMD ["npm", "start"]
