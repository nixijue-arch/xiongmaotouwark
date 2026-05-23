#!/usr/bin/env python3
"""
edge-tts 代理服务 — 给「熊猫头工坊」沙雕动画配音用 (真 Azure Neural 语音, 国内秒通免费).

为什么需要它:
  - youdao/baidu 免费 TTS 在 Netlify 海外云 IP 被限流/反爬 → 生产端配音时好时坏.
  - 微软 edge-tts (Edge 浏览器朗读用的同一服务) 全球可用、不挑 IP, 只要正确算 Sec-MS-GEC token
    (edge-tts 库已内置处理) → 拿真·晓晓/云健等 Neural 音色, 稳定一致.

暴露两套接口 (客户端 fetchTTSFromProxy 先 POST 后 GET, 两个都支持):
  1. POST /v1/audio/speech   (OpenAI 兼容)  body: {input, voice, response_format, speed?}
  2. GET  /?text=..&voice=..&voiceName=..&rate=..&pitch=..   (根路径带 query)
  另外 GET /healthz 健康检查; GET /voices 列可用音色.

返回 audio/mpeg (mp3), 带 CORS 头 (浏览器跨域 fetch).

依赖: aiohttp, edge-tts   (见 requirements.txt / Dockerfile)
环境变量:
  PORT             监听端口 (默认 5000)
  TTS_API_KEY      可选, 设了就要求请求带 ?key=<KEY> 或 Authorization: Bearer <KEY> (防滥用)
  ALLOWED_ORIGINS  可选, 逗号分隔白名单 (如 https://xiongmaotou.work,http://localhost:3000); 设了则只放行这些 Origin
  MAX_TEXT_LEN     单次最大字符 (默认 300)
"""
import os
import asyncio
import logging

import edge_tts
from aiohttp import web

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("tts-proxy")

PORT = int(os.environ.get("PORT", "5000"))
API_KEY = os.environ.get("TTS_API_KEY", "").strip()
ALLOWED_ORIGINS = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o.strip()]
MAX_TEXT_LEN = int(os.environ.get("MAX_TEXT_LEN", "300"))

DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural"
# OpenAI 标准音色名 → edge 音色 (客户端其实直接传 edge 名, 这里只是兜底/兼容)
OPENAI_TO_EDGE = {
    "alloy": "en-US-AriaNeural", "echo": "en-US-GuyNeural", "fable": "en-GB-SoniaNeural",
    "onyx": "en-US-ChristopherNeural", "nova": "zh-CN-XiaoxiaoNeural", "shimmer": "zh-CN-XiaoyiNeural",
}


def resolve_voice(v: str | None) -> str:
    """把传入的 voice 归一成合法 edge 音色名; 看不懂就用默认晓晓."""
    if not v:
        return DEFAULT_VOICE
    v = v.strip()
    # 形如 zh-CN-XiaoxiaoNeural / en-US-AriaNeural (含 locale + Neural) → 直接用
    if v.endswith("Neural") and v.count("-") >= 2:
        return v
    low = v.lower()
    if low in OPENAI_TO_EDGE:
        return OPENAI_TO_EDGE[low]
    # 形如 XiaoxiaoNeural (没 locale) → 默认按 zh-CN 补 (绝大多数中文场景)
    if v.endswith("Neural"):
        return f"zh-CN-{v}"
    return DEFAULT_VOICE


def fmt_rate(raw) -> str:
    """rate: 客户端传 0 / 数字百分比 / 已是 '+10%' 字符串 → 归一成 edge 的 '+N%'."""
    if raw is None or raw == "" or raw == 0 or raw == "0":
        return "+0%"
    s = str(raw)
    if s.endswith("%"):
        return s if (s[0] in "+-") else f"+{s}"
    try:
        n = int(float(s))
        return f"{'+' if n >= 0 else ''}{n}%"
    except ValueError:
        return "+0%"


def fmt_pitch(raw) -> str:
    if raw is None or raw == "" or raw == 0 or raw == "0":
        return "+0Hz"
    s = str(raw)
    if s.endswith("Hz"):
        return s if (s[0] in "+-") else f"+{s}"
    try:
        n = int(float(s))
        return f"{'+' if n >= 0 else ''}{n}Hz"
    except ValueError:
        return "+0Hz"


def cors_headers(req: web.Request) -> dict:
    origin = req.headers.get("Origin", "*")
    allow = origin if (not ALLOWED_ORIGINS or origin in ALLOWED_ORIGINS) else (ALLOWED_ORIGINS[0])
    return {
        "Access-Control-Allow-Origin": allow if ALLOWED_ORIGINS else "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin",
    }


def check_auth(req: web.Request) -> bool:
    if not API_KEY:
        return True
    key = req.query.get("key", "")
    auth = req.headers.get("Authorization", "")
    if auth.lower().startswith("bearer "):
        key = auth[7:].strip() or key
    return key == API_KEY


def check_origin(req: web.Request) -> bool:
    if not ALLOWED_ORIGINS:
        return True
    origin = req.headers.get("Origin", "")
    # 浏览器一定带 Origin; 非浏览器(curl)没 Origin → 也放行 (方便健康检查/调试), 滥用防护靠 API_KEY
    return (not origin) or (origin in ALLOWED_ORIGINS)


async def synth(text: str, voice: str, rate: str, pitch: str) -> bytes:
    """调 edge-tts 合成, 收集全部 audio 分片为 mp3 bytes."""
    communicate = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
    buf = bytearray()
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            buf.extend(chunk["data"])
    return bytes(buf)


def err(req, status, msg):
    return web.json_response({"error": msg}, status=status, headers={**cors_headers(req), "Cache-Control": "no-store"})


async def handle_tts(req: web.Request, text: str, voice: str, rate: str, pitch: str):
    if not check_origin(req):
        return err(req, 403, "origin not allowed")
    if not check_auth(req):
        return err(req, 401, "missing/invalid key")
    text = (text or "").strip()
    if not text:
        return err(req, 400, "text required")
    if len(text) > MAX_TEXT_LEN:
        return err(req, 413, f"text too long (max {MAX_TEXT_LEN})")
    voice = resolve_voice(voice)
    try:
        audio = await asyncio.wait_for(synth(text, voice, rate, pitch), timeout=20)
    except asyncio.TimeoutError:
        return err(req, 504, "edge-tts timeout")
    except Exception as e:  # noqa: BLE001
        log.warning("edge-tts fail voice=%s err=%s", voice, e)
        return err(req, 502, f"edge-tts failed: {e}")
    if len(audio) < 512:
        return err(req, 502, f"edge-tts returned tiny audio ({len(audio)}B)")
    log.info("ok voice=%s len=%d text=%.20s", voice, len(audio), text)
    return web.Response(
        body=audio, status=200,
        headers={
            **cors_headers(req),
            "Content-Type": "audio/mpeg",
            "X-TTS-Voice": voice,
            # 浏览器按完整 URL 缓存 (POST 不缓存, GET 会) → 同文案重复秒回
            "Cache-Control": "public, max-age=86400",
        },
    )


async def post_speech(req: web.Request):
    try:
        data = await req.json()
    except Exception:  # noqa: BLE001
        return err(req, 400, "invalid json body")
    text = data.get("input") or data.get("text") or ""
    voice = data.get("voice") or DEFAULT_VOICE
    speed = data.get("speed")
    rate = fmt_rate(int((float(speed) - 1) * 100) if speed not in (None, "", 1, "1") else 0)
    return await handle_tts(req, text, voice, rate, "+0Hz")


async def get_root(req: web.Request):
    # 根路径带 ?text= → 当 TTS 接口 (客户端 GET fallback 打的就是 base?text=...)
    if req.query.get("text"):
        text = req.query.get("text", "")
        voice = req.query.get("voice") or req.query.get("voiceName") or DEFAULT_VOICE
        return await handle_tts(req, text, voice, fmt_rate(req.query.get("rate")), fmt_pitch(req.query.get("pitch")))
    return web.json_response(
        {"service": "edge-tts-proxy", "ok": True, "endpoints": ["POST /v1/audio/speech", "GET /?text=&voice=", "GET /healthz", "GET /voices"]},
        headers=cors_headers(req),
    )


async def get_tts(req: web.Request):
    text = req.query.get("text", "")
    voice = req.query.get("voice") or req.query.get("voiceName") or DEFAULT_VOICE
    return await handle_tts(req, text, voice, fmt_rate(req.query.get("rate")), fmt_pitch(req.query.get("pitch")))


async def healthz(req: web.Request):
    return web.json_response({"ok": True}, headers=cors_headers(req))


async def list_voices(req: web.Request):
    # 列常用中文/英文 Neural 音色 (给前端做音色面板参考)
    try:
        vs = await edge_tts.list_voices()
        cn = [v["ShortName"] for v in vs if v["ShortName"].startswith(("zh-CN", "zh-HK", "zh-TW", "en-US", "en-GB"))]
        return web.json_response({"voices": sorted(cn)}, headers=cors_headers(req))
    except Exception as e:  # noqa: BLE001
        return err(req, 502, f"list_voices failed: {e}")


async def options(req: web.Request):
    return web.Response(status=204, headers=cors_headers(req))


def make_app() -> web.Application:
    app = web.Application(client_max_size=1 * 1024 * 1024)
    app.router.add_route("OPTIONS", "/{tail:.*}", options)
    app.router.add_post("/v1/audio/speech", post_speech)
    app.router.add_get("/", get_root)
    app.router.add_get("/tts", get_tts)
    app.router.add_get("/healthz", healthz)
    app.router.add_get("/voices", list_voices)
    return app


if __name__ == "__main__":
    log.info("edge-tts-proxy on :%d  (auth=%s, origins=%s, maxlen=%d)",
             PORT, "on" if API_KEY else "off", ALLOWED_ORIGINS or "*", MAX_TEXT_LEN)
    web.run_app(make_app(), host="0.0.0.0", port=PORT)
