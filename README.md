# LetsPaste

LetsPaste 是一个基于 Go + React 的 Pastebin 程序，支持助记码登录、后台开关匿名 Paste、代码高亮、Markdown、访问密码、阅后即焚、自动过期销毁，以及管理员管理用户和所有 Paste。

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

后台入口：

```text
http://localhost:8088/admin
```

生产环境请务必修改 `JWT_SECRET` 和 `ADMIN_PASSWORD`。

普通用户无需用户名和密码。前台点击“助记码登录”后可以生成助记码，助记码就是后续登录凭据，请妥善保存。登录后可在“用户信息”里修改助记码；管理员可在同一页面修改管理员密码。手动输入的新凭据只要求非空，不限制字符数；留空时系统会自动生成新的登录凭据。

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

## 自动更新部署

项目提供 `docker-compose.auto-update.yml`，使用 Watchtower 自动拉取并重启 `widayn/letspaste:latest`。

```bash
cp .env.example .env
docker compose -f docker-compose.auto-update.yml up -d
```

默认每 300 秒检查一次新镜像。可在 `.env` 中调整：

```text
WATCHTOWER_POLL_INTERVAL=300
DOCKER_API_VERSION=1.40
```

这个编排启用了 Watchtower label 过滤，只会更新带有 `com.centurylinklabs.watchtower.enable=true` 标签的 LetsPaste 容器。

如果 Watchtower 日志出现 `client version 1.25 is too old`，说明 Docker API 版本协商失败。把 `.env` 里的 `DOCKER_API_VERSION` 设置为错误信息里提示的最低版本即可；例如提示 `Minimum supported API version is 1.44` 时，设置：

```text
DOCKER_API_VERSION=1.44
```

## GitHub Actions 发布到 Docker Hub

仓库已包含 `.github/workflows/docker-publish.yml`。在 GitHub 仓库的 Settings -> Secrets and variables -> Actions 中添加：

```text
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
- 普通用户助记码登录
- 独立 `/admin` 后台入口
- 管理员初始化、用户管理、Paste 管理
- 后台开关匿名 Paste
- 公开 Paste、私密 Paste、我的 Paste
- 代码高亮和 Markdown 渲染
- Paste 访问密码
- 阅后即焚
- 按分钟设置自动销毁时间
- SQLite 持久化，Docker volume 保存数据
