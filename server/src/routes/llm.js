/**
 * server/src/routes/llm.js · LLM 网关路由
 * ---------------------------------------------------------------
 * 统一接管 5 家厂商的 OpenAI 风格 chat 接口，对前端只暴露 /api/llm/chat。
 * 这样做的好处：
 *   1. API Key 只放在服务端 .env，前端永远拿不到
 *   2. 前端只关心 model/messages/temperature，不必关心 baseURL / 鉴权方式
 *   3. 切换/新增厂商时只需改后端，画布不变
 *
 * 端点列表：
 *   GET  /api/llm/config          返回每个厂商是否已配置 Key（不返回 Key 本身）
 *   POST /api/llm/config          写入 / 更新某个厂商的 Key（持久化到 server/.env）
 *   POST /api/llm/chat            统一调用：{ model, messages, temperature, stream }
 *
 * 流式：前端目前用 stream:false，等以后做"打字机效果"再开启 SSE。
 */
import { Router } from 'express';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

// 模型配置 - 从环境变量读取 API Key（运行时可通过 /config 覆盖）
const MODEL_CONFIG = {
  hunyuan: {
    apiUrl: 'https://api.hunyuan.cloud.tencent.com/hyllm/v1/chat/completions',
    apiKey: process.env.HUNYUAN_API_KEY || '',
    modelName: 'hunyuan-turbo',
    envName: 'HUNYUAN_API_KEY',
    displayName: '腾讯混元',
  },
  deepseek: {
    apiUrl: 'https://api.deepseek.com/v1/chat/completions',
    apiKey: process.env.DEEPSEEK_API_KEY || '',
    modelName: 'deepseek-chat',
    envName: 'DEEPSEEK_API_KEY',
    displayName: 'DeepSeek',
  },
  glm: {
    apiUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    apiKey: process.env.GLM_API_KEY || '',
    modelName: 'glm-4',
    envName: 'GLM_API_KEY',
    displayName: '智谱 GLM',
  },
  gpt: {
    apiUrl: 'https://api.openai.com/v1/chat/completions',
    apiKey: process.env.OPENAI_API_KEY || '',
    modelName: 'gpt-4o',
    envName: 'OPENAI_API_KEY',
    displayName: 'OpenAI GPT（文本/图片AI）',
  },
  claude: {
    apiUrl: 'https://api.anthropic.com/v1/messages',
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    modelName: 'claude-3-5-sonnet-20241022',
    envName: 'ANTHROPIC_API_KEY',
    displayName: 'Anthropic Claude',
  },
  kimi: {
    // Kimi (Moonshot) 走 OpenAI 兼容协议
    apiUrl: 'https://api.moonshot.cn/v1/chat/completions',
    apiKey: process.env.MOONSHOT_API_KEY || '',
    modelName: 'moonshot-v1-8k',
    envName: 'MOONSHOT_API_KEY',
    displayName: 'Kimi (Moonshot，文本/图片AI)',
  },
  qwen: {
    // 通义千问 DashScope OpenAI 兼容端点
    apiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    apiKey: process.env.DASHSCOPE_API_KEY || '',
    modelName: 'qwen-plus',
    envName: 'DASHSCOPE_API_KEY',
    displayName: '通义千问 (Qwen)',
  },
};

// 返回每个模型是否已配置 API Key（不返回 key 本身，做好安全边界）
router.get('/config', (_req, res) => {
  const result = Object.entries(MODEL_CONFIG).map(([key, cfg]) => ({
    id: key,
    name: cfg.displayName,
    modelName: cfg.modelName,
    envName: cfg.envName,
    configured: !!cfg.apiKey,
    // 仅暴露 key 的前 4 后 4，方便用户确认是不是自己填的那把
    masked: cfg.apiKey ? cfg.apiKey.substring(0, 4) + '****' + cfg.apiKey.substring(cfg.apiKey.length - 4) : '',
  }));
  res.json({ models: result });
});

// 更新某个模型的 API Key（运行时生效 + 持久化到 .env）
router.post('/config', (req, res) => {
  try {
    const { model, apiKey } = req.body || {};
    if (!model || !MODEL_CONFIG[model]) {
      return res.status(400).json({ error: `不支持的模型: ${model}` });
    }
    const key = typeof apiKey === 'string' ? apiKey.trim() : '';
    MODEL_CONFIG[model].apiKey = key;

    // 持久化到 server/.env（保留其它行，只覆盖对应 KEY）
    const envPath = path.join(__dirname, '../../.env');
    let envText = '';
    try { envText = fs.readFileSync(envPath, 'utf8'); } catch {}
    const envName = MODEL_CONFIG[model].envName;
    const line = `${envName}=${key}`;
    if (new RegExp(`^${envName}=.*$`, 'm').test(envText)) {
      envText = envText.replace(new RegExp(`^${envName}=.*$`, 'm'), line);
    } else {
      envText = envText ? (envText.replace(/\s*$/, '') + `\n${line}\n`) : `${line}\n`;
    }
    try {
      fs.writeFileSync(envPath, envText);
    } catch (e) {
      console.warn('[llm/config] write .env failed:', e.message);
    }

    res.json({ success: true, configured: !!key });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function extractImageCandidates(providerBody) {
  const candidates = [];
  const seen = new Set();
  const add = (kind, value, mime = '') => {
    if (typeof value !== 'string' || !value.trim()) return;
    const normalized = value.trim();
    const key = `${kind}:${normalized.slice(0, 160)}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ kind, value: normalized, mime });
  };
  const visit = (value, depth = 0, field = '') => {
    if (depth > 5 || value == null) return;
    if (typeof value === 'string') {
      const text = value.trim();
      if (/^data:image\//i.test(text)) add('data-url', text);
      else if (/^https?:\/\//i.test(text)) add('url', text);
      else if (/^(?:b64_json|base64|data)$/i.test(field) && /^[A-Za-z0-9+/=\s]+$/.test(text)) add('base64', text);
      for (const match of text.matchAll(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+/g)) add('data-url', match[0]);
      for (const match of text.matchAll(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g)) add('url', match[1]);
      if ((text.startsWith('{') || text.startsWith('[')) && text.length < 2_000_000) {
        try { visit(JSON.parse(text), depth + 1, field); } catch {}
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1, field));
      return;
    }
    if (typeof value === 'object') {
      if (value.b64_json) add('base64', value.b64_json, value.mime || value.mime_type || '');
      if (value.base64) add('base64', value.base64, value.mime || value.mime_type || '');
      if (typeof value.url === 'string') add('url', value.url, value.mime || value.mime_type || '');
      Object.entries(value).forEach(([key, child]) => visit(child, depth + 1, key));
    }
  };

  visit(providerBody?.data || [], 0, 'data');
  const message = providerBody?.choices?.[0]?.message;
  visit(message?.images || [], 0, 'images');
  visit(message?.content || '', 0, 'content');
  return candidates;
}

async function imageCandidateToBuffer(candidate) {
  if (!candidate) return null;
  if (candidate.kind === 'data-url') {
    const match = candidate.value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/i);
    if (!match) return null;
    return { buffer: Buffer.from(match[2].replace(/\s+/g, ''), 'base64'), mime: match[1] };
  }
  if (candidate.kind === 'base64') {
    return { buffer: Buffer.from(candidate.value.replace(/\s+/g, ''), 'base64'), mime: candidate.mime || 'image/png' };
  }
  if (candidate.kind === 'url') {
    const imageResponse = await fetch(candidate.value, { signal: AbortSignal.timeout(120000) });
    if (!imageResponse.ok) throw new Error(`下载生成图片失败（HTTP ${imageResponse.status}）`);
    const mime = String(imageResponse.headers.get('content-type') || candidate.mime || '').split(';')[0];
    if (mime && !mime.startsWith('image/')) throw new Error(`图片地址返回了非图片内容：${mime}`);
    const buffer = Buffer.from(await imageResponse.arrayBuffer());
    if (buffer.length > 20 * 1024 * 1024) throw new Error('生成图片超过 20 MB 限制');
    return { buffer, mime: mime || 'image/png' };
  }
  return null;
}

router.get('/image-config', (_req, res) => {
  res.json({
    providers: {
      openai: {
        configured: !!MODEL_CONFIG.gpt.apiKey,
        model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1',
      },
      kimi: {
        configured: !!MODEL_CONFIG.kimi.apiKey,
        model: process.env.KIMI_IMAGE_MODEL || 'kimi-k3',
      },
    },
  });
});

/**
 * 图片生成网关：统一保存 provider 返回的图片到 server/uploads，画布只持久化相对 URL。
 * - 无参考图：OpenAI Images generations
 * - 有参考图：OpenAI Images edits（支持 imageInput 的一张或多张参考图）
 */
router.post('/image', async (req, res) => {
  try {
    const provider = req.body?.provider === 'kimi' ? 'kimi' : 'openai';
    const providerConfig = provider === 'kimi' ? MODEL_CONFIG.kimi : MODEL_CONFIG.gpt;
    const apiKey = providerConfig.apiKey || '';
    if (!apiKey) {
      return res.status(500).json({
        error: provider === 'kimi'
          ? 'Kimi API Key 未配置，请在「API 配置」中填写 Kimi Key'
          : 'OpenAI API Key 未配置，请在「API 配置」中填写 OpenAI GPT Key',
      });
    }

    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt) return res.status(400).json({ error: '图片 Prompt 不能为空' });

    const referenceImages = (Array.isArray(req.body?.images) ? req.body.images : [])
      .map((image, index) => ({ ...image, __sourceIndex: index }))
      .sort((left, right) => (Number(left?.promptNumber || Number.MAX_SAFE_INTEGER) - Number(right?.promptNumber || Number.MAX_SAFE_INTEGER)) || (left.__sourceIndex - right.__sourceIndex))
      .slice(0, 4);
    const strength = Math.max(0, Math.min(1, Number(req.body?.strength ?? 0.65)));
    const transparent = req.body?.transparent === true;
    const requestedModel = String(req.body?.model || '').trim();
    const model = requestedModel || (provider === 'kimi'
      ? (process.env.KIMI_IMAGE_MODEL || 'kimi-k3')
      : (process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1'));
    const allowedSizes = new Set(['1024x1024', '1024x1536', '1536x1024', 'auto']);
    const size = allowedSizes.has(req.body?.size) ? req.body.size : '1024x1024';
    const baseUrl = String(process.env.OPENAI_IMAGE_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
    const referenceGuide = referenceImages
      .map((image, index) => {
        const order = Number(image?.promptNumber || index + 1);
        const weight = Math.max(0, Math.min(1, Number(image?.weight ?? 1)));
        return `参考图 #${order} 权重 ${weight.toFixed(1)}`;
      })
      .join('；');
    const effectivePrompt = referenceImages.length
      ? `${prompt}\n\n参考图遵循强度：${Math.round(strength * 100)}%。${referenceGuide ? ` ${referenceGuide}。` : ''}` +
        (strength >= 0.8
          ? '尽量严格保持高权重参考图的主体、构图和视觉特征，并按编号顺序理解参考优先级。'
          : strength >= 0.45
            ? '保留高权重参考图的核心视觉特征，同时允许根据 Prompt 重新设计；按编号顺序理解参考图。'
            : '参考图仅用于松散启发，以 Prompt 为主进行创作；高权重图片影响更大。')
      : prompt;

    let response;
    if (provider === 'kimi') {
      const content = [];
      for (const image of referenceImages) {
        const filename = path.basename(String(image?.filename || image?.url || ''));
        if (!filename) continue;
        const fullPath = path.join(__dirname, '../../uploads', filename);
        if (!fs.existsSync(fullPath)) continue;
        const buffer = await fs.promises.readFile(fullPath);
        if (buffer.length > 20 * 1024 * 1024) continue;
        const mime = String(image?.mime || 'image/png');
        content.push({
          type: 'image_url',
          image_url: { url: `data:${mime};base64,${buffer.toString('base64')}` },
        });
      }
      const outputInstruction = `请生成并返回一张图片。构图：${size}；${transparent ? '优先透明背景 PNG。' : '使用正常不透明背景。'}请在最终响应中直接返回可下载的图片，不要只描述图片。`;
      content.push({ type: 'text', text: `${effectivePrompt}\n\n${outputInstruction}` });
      response = await fetch(process.env.KIMI_IMAGE_API_URL || providerConfig.apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content }],
          stream: false,
        }),
        signal: AbortSignal.timeout(180000),
      });
    } else if (referenceImages.length) {
      const form = new FormData();
      form.append('model', model);
      form.append('prompt', effectivePrompt);
      form.append('size', size);
      form.append('output_format', 'png');
      form.append('background', transparent ? 'transparent' : 'opaque');

      let validCount = 0;
      for (const image of referenceImages) {
        const filename = path.basename(String(image?.filename || image?.url || ''));
        if (!filename) continue;
        const fullPath = path.join(__dirname, '../../uploads', filename);
        if (!fs.existsSync(fullPath)) continue;
        const buffer = await fs.promises.readFile(fullPath);
        if (buffer.length > 20 * 1024 * 1024) continue;
        const mime = String(image?.mime || 'image/png');
        const blob = new Blob([buffer], { type: mime });
        form.append(referenceImages.length > 1 ? 'image[]' : 'image', blob, image?.name || filename);
        validCount++;
      }
      if (!validCount) return res.status(400).json({ error: '没有找到可用的参考图片，请重新上传图片' });

      response = await fetch(`${baseUrl}/images/edits`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: AbortSignal.timeout(180000),
      });
    } else {
      response = await fetch(`${baseUrl}/images/generations`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          prompt: effectivePrompt,
          size,
          output_format: 'png',
          background: transparent ? 'transparent' : 'opaque',
          n: 1,
        }),
        signal: AbortSignal.timeout(180000),
      });
    }

    const providerBody = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = providerBody?.error?.message || providerBody?.error || `图片生成失败（HTTP ${response.status}）`;
      return res.status(response.status >= 400 && response.status < 500 ? response.status : 502).json({ error: message });
    }

    const candidates = extractImageCandidates(providerBody);
    if (!candidates.length) {
      return res.status(502).json({
        error: provider === 'kimi'
          ? 'Kimi K3 未返回可识别的图片。当前 Kimi API/账号可能只开放图片理解，或该网关未启用图片输出。'
          : '图片服务未返回图片数据',
      });
    }

    const resolvedImage = await imageCandidateToBuffer(candidates[0]);
    const imageBuffer = resolvedImage?.buffer;
    if (!imageBuffer?.length) return res.status(502).json({ error: '图片服务返回了空图片' });

    const uploadDir = path.join(__dirname, '../../uploads');
    await fs.promises.mkdir(uploadDir, { recursive: true });
    const filename = `image-ai-${Date.now()}-${randomUUID().slice(0, 8)}.png`;
    await fs.promises.writeFile(path.join(uploadDir, filename), imageBuffer);

    const image = {
      filename,
      name: `${String(req.body?.name || 'AI生成图片').replace(/[\\/:*?"<>|]/g, '_')}.png`,
      mime: 'image/png',
      url: `/uploads/${filename}`,
    };
    const output = `__PM_IMAGES__\n${JSON.stringify([image])}\n__PM_FILE__\n<documents>\n<document filename="${image.name.replace(/"/g, '&quot;')}">\n[AI 生成图片，图片资源见 __PM_IMAGES__]\n</document>\n</documents>`;
    return res.json({ ok: true, provider, model, images: [image], output });
  } catch (error) {
    console.error('Image API Error:', error?.message || error);
    return res.status(500).json({ error: error?.message || '图片生成失败' });
  }
});

router.post('/chat', async (req, res) => {
  try {
    // v2.1：tools / tool_choice 为 Agent 节点的 function calling 透传（OpenAI 兼容厂商）
    const { model, customModelName, messages, stream = false, temperature = 0.7, tools, tool_choice } = req.body;

    const config = MODEL_CONFIG[model];
    if (!config) {
      return res.status(400).json({ error: `不支持的模型: ${model}` });
    }
    if (!config.apiKey) {
      return res.status(500).json({ error: `模型 ${model} 的 API Key 未配置，请点击工具栏的「API 配置」按钮填写` });
    }

    // v1.5.3：前端可以传 customModelName 覆盖默认 modelName
    // —— 这样新厂商出新模型版本不必改后端代码
    const effectiveModelName =
      typeof customModelName === 'string' && customModelName.trim()
        ? customModelName.trim()
        : config.modelName;

    let headers = {};
    let body = {};

    if (model === 'claude') {
      headers = {
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      };
      body = { model: effectiveModelName, messages, stream, max_tokens: 4096 };
    } else {
      headers = {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      };
      body = { model: effectiveModelName, messages, stream, temperature };
      // Agent 节点：透传 OpenAI 风格 function calling（不支持的厂商会忽略，自动退化为纯文本回答）
      if (Array.isArray(tools) && tools.length) {
        body.tools = tools;
        if (tool_choice) body.tool_choice = tool_choice;
      }
    }

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      const response = await axios.post(config.apiUrl, body, { headers, responseType: 'stream' });
      response.data.pipe(res);
    } else {
      const response = await axios.post(config.apiUrl, body, { headers });
      res.json(response.data);
    }
  } catch (error) {
    console.error('LLM API Error:', error.response?.data || error.message);
    res.status(500).json({
      error: error.response?.data?.error?.message || error.response?.data?.error || error.message,
    });
  }
});

export default router;
