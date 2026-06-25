# LetsPaste

LetsPaste 是一个基于 Go + React 的 Pastebin 程序，支持注册登录、后台开关匿名 Paste、代码高亮、Markdown、访问密码、阅后即焚、自动过期销毁，以及管理员管理用户和所有 Paste。

## Docker 一键部署

```bash
cp .env.example .env
docker compose up -d --build
```

默认访问地址：

```text
http://localhost:8088
```

默认管理员账号来自 `.env`：

```text
admin / changeme123
```

生产环境请务必修改 `JWT_SECRET` 和 `ADMIN_PASSWORD`。

也可以直接拉取单镜像运行：

```bash
docker run -d \
  --name letspaste \
  -p 8088:8080 \
  -v letspaste_data:/data \
  -e JWT_SECRET=replace-with-a-long-random-secret \
  -e ADMIN_USERNAME=admin \
  -e ADMIN_PASSWORD=changeme123 \
  widayn/letspaste:latest
```

## GitHub Actions 发布到 Docker Hub

仓库已包含 `.github/workflows/docker-publish.yml`。在 GitHub 仓库的 Settings -> Secrets and variables -> Actions 中添加：

```text
DOCKERHUB_USERNAME=你的 Docker Hub 用户名
DOCKERHUB_TOKEN=你的 Docker Hub Access Token
```

之后 push 到 `main` / `master` 或推送 `v*.*.*` tag 时，会发布单镜像：

```text
docker.io/widayn/letspaste
```

## 本地开发

启动后端：

```bash
cd backend
go run ./cmd/server
```

启动前端：

```bash
cd frontend
npm install
npm run dev
```

Vite 开发服务器会把 `/api` 代理到 `http://localhost:8080`。

## 功能

- 用户注册、登录、JWT 鉴权
- 管理员初始化、用户管理、Paste 管理
- 后台开关匿名 Paste
- 公开 Paste、私密 Paste、我的 Paste
- 代码高亮和 Markdown 渲染
- Paste 访问密码
- 阅后即焚
- 按分钟设置自动销毁时间
- SQLite 持久化，Docker volume 保存数据
