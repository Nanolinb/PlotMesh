import { Router } from 'express';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
    displayName: 'OpenAI GPT',
  },
  claude: {
    apiUrl: 'https://api.anthropic.com/v1/messages',
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    modelName: 'claude-3-5-sonnet-20241022',
    envName: 'ANTHROPIC_API_KEY',
    displayName: 'Anthropic Claude',
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

router.post('/chat', async (req, res) => {
  try {
    const { model, messages, stream = false, temperature = 0.7 } = req.body;

    const config = MODEL_CONFIG[model];
    if (!config) {
      return res.status(400).json({ error: `不支持的模型: ${model}` });
    }
    if (!config.apiKey) {
      return res.status(500).json({ error: `模型 ${model} 的 API Key 未配置，请点击工具栏的「API 配置」按钮填写` });
    }

    let headers = {};
    let body = {};

    if (model === 'claude') {
      headers = {
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      };
      body = { model: config.modelName, messages, stream, max_tokens: 4096 };
    } else {
      headers = {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      };
      body = { model: config.modelName, messages, stream, temperature };
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
