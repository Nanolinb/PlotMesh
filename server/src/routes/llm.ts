import { Router, Request, Response } from 'express';
import axios from 'axios';
import type { AxiosResponse } from 'axios';

const router = Router();

// 模型配置 - 从环境变量读取 API Key
const MODEL_CONFIG: Record<string, { apiUrl: string; apiKey: string; modelName: string }> = {
  'hunyuan': {
    apiUrl: 'https://api.hunyuan.cloud.tencent.com/hyllm/v1/chat/completions',
    apiKey: process.env.HUNYUAN_API_KEY || '',
    modelName: 'hunyuan-turbo'
  },
  'deepseek': {
    apiUrl: 'https://api.deepseek.com/v1/chat/completions',
    apiKey: process.env.DEEPSEEK_API_KEY || '',
    modelName: 'deepseek-chat'
  },
  'glm': {
    apiUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    apiKey: process.env.GLM_API_KEY || '',
    modelName: 'glm-4'
  },
  'gpt': {
    apiUrl: 'https://api.openai.com/v1/chat/completions',
    apiKey: process.env.OPENAI_API_KEY || '',
    modelName: 'gpt-4o'
  },
  'claude': {
    apiUrl: 'https://api.anthropic.com/v1/messages',
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    modelName: 'claude-3-5-sonnet-20241022'
  }
};

interface LLMRequestBody {
  model: string;
  messages: Array<{ role: string; content: string }>;
  stream?: boolean;
  temperature?: number;
}

router.post('/chat', async (req: Request, res: Response) => {
  try {
    const { model, messages, stream = false, temperature = 0.7 }: LLMRequestBody = req.body;

    const config = MODEL_CONFIG[model];
    if (!config) {
      res.status(400).json({ error: `不支持的模型: ${model}` });
      return;
    }
    if (!config.apiKey) {
      res.status(500).json({ error: `模型 ${model} 的 API Key 未配置` });
      return;
    }

    // 根据不同模型构建请求
    let apiUrl = config.apiUrl;
    let headers: Record<string, string> = {};
    let body: Record<string, unknown> = {};

    if (model === 'claude') {
      headers = {
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      };
      body = {
        model: config.modelName,
        messages: messages.map(m => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content
        })),
        stream,
        max_tokens: 4096
      };
    } else {
      headers = {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      };
      body = {
        model: config.modelName,
        messages,
        stream,
        temperature
      };
    }

    if (stream) {
      // 流式返回
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const response: AxiosResponse = await axios.post(apiUrl, body, {
        headers,
        responseType: 'stream'
      });

      response.data.pipe(res);
    } else {
      // 非流式返回
      const response = await axios.post(apiUrl, body, { headers });
      res.json(response.data);
    }
  } catch (error: any) {
    console.error('LLM API Error:', error.response?.data || error.message);
    res.status(500).json({
      error: error.response?.data || error.message
    });
  }
});

export default router;
