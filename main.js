const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");
let config = require("./config/config.js");
const logger = require("./logger");
const fs = require('fs');
const path = require('path');
const util = require('util')
//const check_util = require('./health_check.js');

// 确保日志目录存在
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

const app = express();
const port = 8001;

app.use(bodyParser.json());

// 数据结构来存储模型信息
let availableModels = []; // 可用模型列表
let duplicateModels = {}; // 重复模型及其对应的服务
let uniqueModels = {}; // 唯一模型及其对应的服务
// 添加请求计数器
const requestCounter = {};

// 初始化模型信息
async function initModels() {
  const modelSet = new Set(); // 使用 Set 来自动处理重复项

  for (const service of config) {
    try {
      logger.info(`Initializing models from service: ${service.apiUrl}`);
      const response = await axios.get(`${service.apiUrl}/v1/models`, {
        headers: {
          Authorization: `Bearer ${service.apiKey}`,
        },
      });

      const data = response.data;
      console.log(data.data);
      if (data.data && Array.isArray(data.data)) {
        data.data.forEach((model) => {
          if (modelSet.has(model.id)) {
            // 处理重复模型
            if (!duplicateModels[model.id]) {
              // 如果是第一次检测到重复，则需要将之前在uniqueModels中的数据迁移到duplicateModels
              if (uniqueModels[model.id]) {
                duplicateModels[model.id] = [uniqueModels[model.id]];
                delete uniqueModels[model.id];
              } else {
                duplicateModels[model.id] = [];
              }
            }
            duplicateModels[model.id].push({
              apiUrl: service.apiUrl,
              apiKey: service.apiKey,
            });
            logger.info(`Added duplicate model: ${model.id} for service: ${service.apiUrl}`);
          } else {
            // 处理唯一模型
            modelSet.add(model.id);
            uniqueModels[model.id] = {
              apiUrl: service.apiUrl,
              apiKey: service.apiKey,
            };
            logger.info(`Added unique model: ${model.id} for service: ${service.apiUrl}`);
          }
        });
      }
    } catch (error) {
      logger.error(`Error fetching models from ${service.apiUrl}: ${error.message}`);
      console.error(
        `Error fetching models from ${service.apiUrl}:`,
        error.response ? error.response.data : error.message
      );
    }
    await new Promise(resolve => setTimeout(resolve, 7000));
  }

  availableModels = Array.from(modelSet);
  logger.info("Initialization completed. Available models: " + availableModels.join(", "));
  console.log("Available models:", availableModels);
  console.log("Duplicate models:", duplicateModels);
  console.log("Unique models:", uniqueModels);
}



// 获取服务的函数
const getServiceForModel = (function () {
  const roundRobinIndex = {};

  return function (modelId) {
    if (uniqueModels[modelId]) {
      return uniqueModels[modelId];
    }

    if (duplicateModels[modelId]) {
      // 如果索引不存在则初始化为0
      roundRobinIndex[modelId] ??= 0;

      const serviceArray = duplicateModels[modelId];
      // 直接使用当前索引
      const service = serviceArray[roundRobinIndex[modelId]];

      // 更新索引，确保永远在数组长度范围内
      roundRobinIndex[modelId] = (roundRobinIndex[modelId] + 1) % serviceArray.length;

      return service;
    }

    return null;
  };
})();
const validateApiKey = (req, res, next) => {
  // 从请求头中获取Authorization
  const authHeader = req.headers.authorization;

  // 检查Authorization头是否存在
  if (!authHeader) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'API密钥缺失'
    });
  }

  // 提取API密钥
  // 如果包含'Bearer '，则去掉前缀
  // 如果不包含，则直接使用整个头部值
  const apiKey = authHeader.startsWith('Bearer ')
    ? authHeader.split(' ')[1]
    : authHeader;

  // 验证API密钥
  const VALID_API_KEY = 'sk-text@159357';

  if (apiKey !== VALID_API_KEY) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'API密钥不正确'
    });
  }

  // 如果验证通过，继续处理请求
  next();
};
app.use(validateApiKey);
// 添加响应时间计算中间件
app.use((req, res, next) => {
  req.startTime = Date.now();
  next();
});
app.get("/op/restart", async (req, res) => {
  try {
    // ... 重载配置 ...
    availableModels = [];
    duplicateModels = {};
    uniqueModels = {}; 

    //await check_util.checkApiUrls();  // 假设是异步函数
    await initModels();              // 假设是异步函数

    res.status(200).json({ success: "restart ok" });
  } catch (error) {
    logger.error(`Restart failed: ${error.message}`);
    res.status(500).json({ error: "Restart failed" });
  }
});
/*app.get("/op/restart", (req, res) => {
  delete require.cache[require.resolve('./config/config.js')];
  config = require("./config/config.js");
  availableModels = [];
  duplicateModels = {};
  uniqueModels = [];
  check_util.checkApiUrls();
  initModels();
  res.status(200).json({ success: "restart ok" });
});*/
// /v1/models 路由
app.get("/v1/models", (req, res) => {
  logger.info(`GET /v1/models called from ${req.ip}`);
  res.json({ data: availableModels.map((id) => ({ id })) });
});

// /v1/chat/completions 路由
app.post("/v1/chat/completions", async (req, res) => {
  const { model, messages, stream } = req.body;
  const service = getServiceForModel(model);
  // 更新请求计数器
  requestCounter[model] = (requestCounter[model] || 0) + 1;
  if (!service) {
    logger.error(`Model not found: ${model}`);
    return res.status(400).json({ error: "Model not found" });
  }

  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  logger.info(`[${requestId}] New request - Model: ${model}, Service: ${service.apiUrl}`);
  logger.info(`[${requestId}] Message count: ${messages.length}, Stream: ${stream}`);

  try {
    const response = await axios.post(`${service.apiUrl}/v1/chat/completions`, {
      model,
      messages,
      stream
    }, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${service.apiKey}`,
      },
      responseType: stream ? 'stream' : 'json'
    });
    const duration = Date.now() - req.startTime;
    if (stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      response.data.pipe(res);
      response.data.on('end', () => {
        logger.info(`[${requestId}] Stream completed - Duration: ${duration}ms`);
      });

      response.data.on('error', (error) => {
        logger.error(`[${requestId}] Stream error: ${error.message}`);
      });
    } else {
      res.json(response.data);
      logger.info(`[${requestId}] Request completed - Duration: ${duration}ms`);
    }
  } catch (error) {
    const duration = Date.now() - req.startTime;
    logger.error(`[${requestId}] Error - Duration: ${duration}ms, Error: ${error.message}`);
    if (error.response) {
  const errorSummary = {
    status: error.response.status,
    dataType: typeof error.response.data,
    dataPreview: util.inspect(error.response.data, {
      depth: 2,
      maxArrayLength: 3,
      breakLength: 80
    })} 
    logger.error(`[${requestId}] Response error (${error.response.status}): ${util.inspect(errorSummary)}`);
    }else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});
// 添加状态监控端点
app.get("/status", (req, res) => {
  res.json({
    uptime: process.uptime(),
    timestamp: Date.now(),
    modelStats: requestCounter,
    availableModels: availableModels.length,
    uniqueModels: Object.keys(uniqueModels).length,
    duplicateModels: Object.keys(duplicateModels).length
  });
});
// 优雅关闭处理
process.on('SIGTERM', () => {
  logger.info('Received SIGTERM. Performing graceful shutdown...');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('Received SIGINT. Performing graceful shutdown...');
  process.exit(0);
});

// 启动服务器
initModels().then(() => {
  app.listen(port, () => {
    console.log(`AI proxy server listening at http://127.0.0.1:${port}`);
  });
});
