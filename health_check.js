const fs = require('fs');
const axios = require('axios');
const path = require('path');
const schedule = require('node-schedule');
// 配置日志
const winston = require('winston');
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({
            format: 'YYYY-MM-DD HH:mm:ss'
        }),
        winston.format.printf(info => {
            return `${info.timestamp} ${info.level}: ${info.message}`;
        })
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({
            filename: path.join('logs', 'api-check.log'),
            maxsize: 5 * 1024 * 1024,
            maxFiles: 5
        })
    ]
});

async function checkApiUrls() {
    try {
        const configPath = path.join(__dirname,'config', 'config.js');
        const configWastePath = path.join(__dirname,'config', 'config_waste.js');

        // 读取配置文件
        let config = require(configPath);
        let configWaste = [];

        if (fs.existsSync(configWastePath)) {
            configWaste = require(configWastePath);
        }

        const validUrls = [...config];
        const stillWasteUrls = [];
        const backToValidUrls = [];

        // 检查 config_waste.js 中的 URLs
        const wasteChecks = configWaste.map(async (cfg) => {
            try {
                const response = await axios.get(`${cfg.apiUrl}/v1/models`, {
                    headers: {
                        'Authorization': `Bearer ${cfg.apiKey}`
                    },
                    timeout: 10000
                });

                // 检查返回数据格式
                if (response.data &&
                    response.data.data &&
                    Array.isArray(response.data.data) &&
                    response.data.data.length > 0 &&
                    response.data.data.every(model => model.id && typeof model.id === 'string')) {

                    backToValidUrls.push(cfg);
                    logger.info(`废弃 URL ${cfg.apiUrl} 重新可用`);
                    return true;
                } else {
                    throw new Error('返回数据格式不符合预期');
                }
            } catch (error) {
                logger.warn(`废弃 URL ${cfg.apiUrl} 仍然不可用：${error.message}`);
                stillWasteUrls.push(cfg);
                return false;
            }
        });

        // 等待所有检查完成
        await Promise.all(wasteChecks);

        // 更新 config.js（加入重新可用的 URL）
        const updatedConfig = [
            ...validUrls,
            ...backToValidUrls
        ];

        fs.writeFileSync(
            configPath,
            `module.exports = ${JSON.stringify(updatedConfig, null, 2)};`
        );

        // 更新 config_waste.js（移除重新可用的 URL）
        const updatedConfigWaste = stillWasteUrls;

        fs.writeFileSync(
            configWastePath,
            `module.exports = ${JSON.stringify(updatedConfigWaste, null, 2)};`
        );

        logger.info('API URL 检查完成');
        logger.info(`重新可用的 URL: ${backToValidUrls.length}`);
        logger.info(`仍然不可用的 URL: ${stillWasteUrls.length}`);
    } catch (error) {
        logger.error(`检查过程出现错误：${error.message}`);
    }
}

// 立即执行一次
checkApiUrls();

// 定期执行（每小时执行一次）
const job = schedule.scheduleJob('0 * * * *', function(){
    logger.info('开始定时检查 API URLs');
    checkApiUrls();
});

// 额外的错误处理
process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
});

logger.info('API URL 监控服务已启动');

module.exports = {
    checkApiUrls
  };
  