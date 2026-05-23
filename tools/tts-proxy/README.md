# edge-tts 代理 — 沙雕动画配音「终极解」

给「熊猫头工坊」沙雕动画提供**真·微软 Azure Neural 语音**（晓晓 / 云健 / 云希 / Aria…），
国内秒通、免费、稳定一致，彻底取代时好时坏的 youdao/baidu。

## 为什么要它

- youdao/baidu 免费 TTS 在 **Netlify 海外云 IP** 被反爬/限流 → 生产端配音「时好时坏 / 失效」。
- 微软 edge-tts（Edge 浏览器「朗读」用的同一服务）**全球可用、不挑 IP**，只要正确算 `Sec-MS-GEC` token
  （`edge-tts` 库已内置）→ 拿真 Neural 音色，稳定。
- 把它跑在你自己的节点（BWH VPS），前端配一个 URL 就切过去。`edge-tts --voice zh-CN-XiaoxiaoNeural`
  本地实测 17KB 真语音，无 403。

## 接口（已对齐前端 `fetchTTSFromProxy`）

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/v1/audio/speech` | OpenAI 兼容，body `{input, voice, response_format}` → `audio/mpeg`（前端首选） |
| `GET` | `/?text=&voice=&voiceName=&rate=&pitch=` | 根路径带 query（前端 fallback） |
| `GET` | `/healthz` | 健康检查 `{"ok":true}` |
| `GET` | `/voices` | 列可用中文/英文 Neural 音色 |

`voice` 直接传 edge 音色全名（`zh-CN-XiaoxiaoNeural` 等）；前端 voicelib 的 `azureName` 已经是全名，开箱即用。

---

## 部署 A：BWH VPS + Caddy 自动 HTTPS（推荐，最省事）

**前提**：一个 BWH（或任意）Linux VPS + 一个子域名 A 记录解析到 VPS 公网 IP + 放行 80/443。

```bash
# 1) 装 Docker (Debian/Ubuntu)
curl -fsSL https://get.docker.com | sh

# 2) 把本目录 (tools/tts-proxy) 传到 VPS, 比如:
#    scp -r tools/tts-proxy root@<BWH_IP>:/opt/tts-proxy
cd /opt/tts-proxy

# 3) 配置
cp .env.example .env
nano .env        # 至少把 TTS_DOMAIN 改成你的子域名, 建议填 ALLOWED_ORIGINS

# 4) 起服务 (首次 build 几分钟)
docker compose up -d --build

# 5) 验证 (Caddy 自动签证书, 头一两次可能要等 ~30s)
curl https://<你的域名>/healthz          # 应 {"ok": true}
curl -X POST https://<你的域名>/v1/audio/speech \
  -H 'Content-Type: application/json' \
  -d '{"input":"家人们谁懂啊","voice":"zh-CN-XiaoxiaoNeural"}' --output test.mp3
# test.mp3 能播 = 成功
```

日常运维：`docker compose logs -f tts` 看日志、`docker compose pull && docker compose up -d --build` 更新、`docker compose down` 停。

---

## 部署 B：不想开 80/443 / 没域名 → Cloudflare Tunnel

VPS 不暴露端口，CF 给你 HTTPS（还隐藏源站 IP）：

```bash
# 只跑 tts 服务 (把 compose 里 caddy 删掉, tts 改 ports: ["5000:5000"]), 或直接:
docker run -d --restart unless-stopped -p 127.0.0.1:5000:5000 \
  -e ALLOWED_ORIGINS='https://xiongmaotou.work' --name tts $(docker build -q .)

# 装 cloudflared, 登录你的 CF 账号, 建 tunnel 指向 http://localhost:5000
cloudflared tunnel --url http://localhost:5000        # 快速临时域名
# 或正式: cloudflared tunnel create xmw-tts && 配 config.yml 绑你的子域名
```
拿到 `https://xxx.trycloudflare.com`（临时）或你绑的子域名当代理 URL。

---

## 部署 C：edge-tts 从本机被限流（少见）→ 走 NX 机场

edge-tts 一般不挑 IP；万一你的 VPS IP 被微软限了，让容器出站走你的 NX 机场 http 代理：
在 `docker-compose.yml` 的 `tts.environment` 里加（NX 客户端需在宿主开个 http 入站，或用机场给的 http 代理地址）：
```yaml
    environment:
      HTTPS_PROXY: http://<nx-host>:<port>
      HTTP_PROXY: http://<nx-host>:<port>
```

---

## 接到前端（两种方式）

**方式 1（推荐，全站生效）— Netlify 构建期环境变量：**
Netlify 站点 → Site settings → Environment variables → 加
`VITE_TTS_PROXY_URL = https://<你的域名>` → 重新 deploy。
之后**所有用户**的配音都走真 Azure 语音（youdao/baidu 自动退居备份）。

**方式 2（本地/个人）— 应用内设置：**
沙雕动画 → 配音 tab → 「⚙️ / 💡 更多」里填代理 URL（存 IndexedDB，仅本浏览器）。适合本机 dev 测试。

> 前端逻辑：配了代理就**优先走代理**（真 Neural 音色），代理失败自动回退 youdao/baidu，绝不因代理挂了而无声。

---

## 安全 / 防滥用

公网开放的 edge-tts 代理可能被别人扫到白嫖你的带宽。建议：
- **填 `ALLOWED_ORIGINS`**（只放行你的站点 Origin）—— 挡浏览器滥用。
- 需要更硬：`TTS_API_KEY` + 前端附带 key，或在 Cloudflare 前面套 **Cloudflare Access**。
- `MAX_TEXT_LEN` 限长已默认 300。

## 故障排查

| 现象 | 排查 |
|---|---|
| `/healthz` 不通 | `docker compose logs tts` 看是否起来；防火墙/安全组放行端口 |
| HTTPS 证书签不下来 | 域名 A 记录是否指向本机；80/443 是否被占/被墙；`docker compose logs caddy` |
| 返回 502 edge-tts failed | edge-tts 出站被限 → 试部署 C 走机场；或换音色名 |
| 浏览器 CORS 报错 | `ALLOWED_ORIGINS` 写错（要带 `https://`、无尾斜杠、无空格） |
| 配音没变（还是 youdao 音色） | Netlify 环境变量没生效要**重新 deploy**；或前端代理 URL 没存上 |
